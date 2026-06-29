# ST-05 — Resident Recall Daemon (design proposal)

> Status: **DESIGN — gated on user go/no-go + Codex premortem.** Not yet implemented.
> Branch `snapshot/ccv3-system-update`. Companion: [`NEXT-SESSION-PLAN.md`](./NEXT-SESSION-PLAN.md) Phase 2.
> Recon: read-only 4-lens workflow (2026-06-29), all facts below cite verified file:line.

## Goal (USABLE floor)

Bring the per-prompt memory recall hot-path under the **≤3s** target. Today
`memory-awareness.checkDbMemory` spawns `uv run python recall_learnings.py --json`
on every prompt (timeout 12s hybrid / 5s text-only; typical ~5.8–7.5s, worst ~13.5s).

## Where the time goes (recon)

The embedding is **already fast** — `recall_learnings.py` routes the query embed
through the resident BGE daemon (TCP), ~35–110ms. The eliminable tax is the
**subprocess boot**, paid on EVERY call:

| Cost | ~time | Resident path eliminates? |
|------|-------|---------------------------|
| `uv` resolve + CPython boot | ~1–3s | **Yes** |
| top-level imports (asyncpg, dotenv, …) | ~0.3–0.5s | **Yes** |
| `asyncpg.create_pool()` (2 conns + init_pgvector) per call | ~0.2–0.5s | **Yes** (pool held open) |
| query embed (daemon TCP) | ~35–110ms | reduced to in-process (~0, model already hot) |
| RRF SQL fetch | ~5–30ms | unchanged |
| decay/sort/JSON | <5ms | unchanged |

Net: a resident recall path removes ~1.5–3.5s of pure overhead per call, leaving
~tens of ms of real query work → comfortably under 3s.

## Architecture today (verified)

- **Daemon** `opc/scripts/core/embedding_daemon.py`: `socketserver.ThreadingTCPServer`,
  127.0.0.1 + OS-assigned port, 4-byte big-endian length-prefixed JSON frames,
  `TCP_NODELAY`. Ops: `embed` / `embed_batch` / `ping` / `shutdown` (embed-only).
  Model `BAAI/bge-large-en-v1.5` @ 1024 (INVARIANT; dim validated at load,
  `embedding_daemon.py:140-144`). `model.encode` serialized by `_EMBED_CALL_LOCK`
  (not thread-safe). Discovery file `~/.claude/run/ccv3-embedding.json`
  `{pid,port,started_at,model,dim}` written **after** warmup; `ping.ready` is the
  authoritative readiness gate.
- **Recall** `recall_learnings.py`: hybrid RRF = embed → pgvector cosine
  (`VECTOR_MIN_COSINE=0.55`) ⨝ Postgres FTS → RRF fusion → threshold → exp decay.
  Shared SQL `db/memory_service_pg.py:build_rrf_sql()`. DB via **asyncpg** pool
  (`db/postgres_pool.py`, process-singleton, min2/max10). `--json` shape:
  `{results:[{id,score,base_score,decay_weight,final_score,age_days,session_id,content,created_at, rerank_score?, valid_from?, valid_until?}], _meta?}`.
- **TS client** `shared/embedding-client.ts`: `readDaemonInfo` / `isDaemonReady`
  (file → PID-alive → TCP `ping`) / `embedText` (4-byte frames) / `ensureDaemonRunning`
  (detached spawn w/ filesystem spawn-mutex). `resolveUvPath` + repoRoot walker are
  test-seamed + reusable.
- **Hot-path** `memory-awareness.ts`: `main()` probes `isDaemonReady()` (1500ms) →
  mode hybrid|text-only → `checkDbMemory()` spawns uv (line 186) → seam at **line 567**
  `const [db, dbTimedOut] = checkDbMemory(...)`. `topScoreRaw` (576) + `emitBraintrustScore`
  (639) read `mergedRaw`, independent of recall mechanism → **emit invariant safe**.

## Design — extend the embedding daemon (NOT a sibling)

### 1. Python: new `recall` op in `embedding_daemon.py`
- On startup (after model warmup) spin a **background asyncio event loop in a daemon
  thread**; lazily create + hold the asyncpg pool there (reuse `db/postgres_pool.get_pool()`).
  Set `recall_ready=true` only once the pool is live.
- Handler `{cmd:'recall', query, k, mode}`:
  - Embed the query **in-process** with the daemon's already-loaded model (skip the
    TCP self-call) — see seam #2.
  - `fut = asyncio.run_coroutine_threadsafe(do_recall(query_vector, query, k, mode), loop)`;
    `result = fut.result(timeout=RECALL_TIMEOUT_S)`.
  - Return `{ok:true, results:[…identical --json shape…], _meta:{…}, elapsed_ms}`.
  - Any error/timeout → `{ok:false, error}` (client falls back; never hangs).
- `ping` response gains `recall_ready: bool` so the client can route precisely.

### 2. Python: `query_vector` seam in `recall_learnings.py`
- Add `query_vector: Optional[list[float]] = None` to `search_learnings_hybrid_rrf`
  (and the vector-only path). If provided, **skip** `_embed_query_with_daemon` — use it
  directly. Pure addition; the CLI path passes `None` and is unchanged. This lets the
  daemon embed with its resident model and avoid a second `EmbeddingService` load
  (which would cost the 30–45s cold model load — the trap to avoid).
- Factor `do_recall(...)` as a thin async wrapper returning the same dict the `--json`
  serializer builds (reuse the serializer block, `recall_learnings.py:1813-1864`).

### 3. TS: `recallViaDaemon(query, k)` in `shared/embedding-client.ts`
- Mirror `embedText`: TCP connect to discovery-file port, send 4-byte-framed
  `{cmd:'recall', query, k, mode:'hybrid'}`, recv framed `{ok, results, _meta}`.
  Budget ~2500ms; on `!ok` / timeout / unreachable return `null`.
- Returns the same `LearningResult[]` shape `checkDbMemory` yields.

### 4. TS: route the hot-path (`memory-awareness.ts` line 567)
- When `daemonReady && recall_ready`: `const r = recallViaDaemon(query, 3)`; if non-null
  use it (set `dbTimedOut=false`); **else** fall back to existing `checkDbMemory(uv)`.
- When daemon down: unchanged text-only `uv` path.
- `db`/`dbTimedOut` types unchanged → mergeResults/floor/topScoreRaw/emit/logRecallFire
  all untouched. **No recall regression, emit invariant intact.**

## Premortem risk register (to harden in /premortem + Codex pass)

| # | Risk | Mitigation |
|---|------|-----------|
| R1 | **Stale DB connections** in a days-long pool (Postgres server-side close) | asyncpg auto-reconnect + per-call retry-once on `ConnectionDoesNotExist`/`InterfaceError`; pool `max_inactive_connection_lifetime` |
| R2 | **Cold-start race** — recall op hit before pool ready | gate on `recall_ready`; `{ok:false}` → uv fallback (no hang) |
| R3 | **Multi-session concurrency** on one daemon | threaded server + asyncpg max10; embed still serialized by `_EMBED_CALL_LOCK` (queues, not breaks); recall timeout bounded |
| R4 | **BGE model/dim invariant** | unchanged — recall reuses the resident model; no second load; dim still validated at load |
| R5 | **Second model load trap** | the `query_vector` seam (design #2) is the explicit guard against `EmbeddingService` re-loading the model inside the daemon |
| R6 | **asyncio-loop-in-thread hang** | bounded `fut.result(timeout=…)`; loop owns the pool exclusively; never block the socketserver thread indefinitely |
| R7 | **Result parity drift** vs `uv` path | reuse the SAME Python functions + serializer; add a parity test: daemon recall vs `recall_learnings.py --json` for identical query/k must match results (ids + ordering) |
| R8 | **Corpus staleness** | NON-ISSUE — daemon holds the connection, not rows; live DB queried each call |
| R9 | **Fallback regression** | keep `uv --text-only` + uv-hybrid paths fully intact; daemon recall is additive-with-fallback |
| R10 | **Windows transport** | same 4-byte-frame TCP path the embed op already uses + ships on Windows |

## Verification gates (definition of done)
- Warm hot-path **≤3s** (measure `memory-awareness` end-to-end with daemon up).
- Recall **quality identical** to the `uv` RRF path (R7 parity test green).
- Emit invariant **4/4**; `MEMORY MATCH` still fires.
- Daemon survives `store_learning.py` writing new rows mid-session (R8: new learning recalled without restart).
- Fallback verified: kill daemon mid-session → recall silently falls back to uv, no error surfaced.

## Sequencing
`/plan` (this doc) → `/premortem` (Codex adversarial pass on this doc) → user go/no-go →
implement (TDD, Python + TS) → verify gates → commit/sync/push. Prereq for ST-03 + ST-10.
After ST-05, re-baseline memory hit-rate (SG-01).
