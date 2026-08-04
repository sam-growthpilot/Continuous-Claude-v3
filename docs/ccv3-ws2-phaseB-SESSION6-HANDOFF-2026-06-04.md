# CCv3 — Session 6 Handoff: Embedding-Daemon Ping Bug + Warm Hybrid Quality-Gate Re-run

**Created:** 2026-06-04, end of session 5 (WS-2 Phase B fully landed) · **By:** Opus 4.8 (1M) · **For:** the next (fresh) session.

> **Your job:** the embedding daemon is **alive but its ping is failing**, so every "hybrid" recall silently falls back to a **166-second** in-process embed. Root-cause and fix the ping failure, make the daemon reliably warm (and persistent), THEN re-run the bus-bias hybrid quality gate to re-confirm the **+33.6% top-score / 63→88% hit-rate** lift under a genuinely warm daemon. This doc is self-sufficient.

---

## 0. Orientation — read order
1. **This file** (the map + the daemon diagnosis).
2. `opc/scripts/core/embedding_daemon.py` — the daemon itself (TCP loopback, ping/embed/shutdown protocol, discovery file). **This is where the bug lives.**
3. `opc/scripts/core/recall_learnings.py` §"Task 1.4" block (~L239–350) — the client side: `_embed_query_with_daemon`, `ping_daemon`, `EMBED_DAEMON_PING_TIMEOUT_S = 1.5`, the fallback that pays the 166s tax.
4. `docs/task-11-embedding-daemon-decision-2026-05-18.md` — the original design decision for the daemon.
5. `scripts/start-embedding-daemon.ps1` / `scripts/install-embedding-daemon-task.ps1` — start + persist-as-scheduled-task (NOT currently installed — see §3).
6. `scripts/bus-quality-gate.mjs` — the gate to re-run once the daemon is warm (it already detects + reports daemon WARM/COLD and asserts 0 DB writes).

---

## 1. Current state (verified 2026-06-04)

- **Git:** branch `main` @ **`0a2e75b`** (= merged `fork/main`). **WS-2 Phase B is COMPLETE and merged** — PR #5 (`1295fd4`, bus WRITE+READ+hardening) and PR #6 (`0a2e75b`, Phase 3 facade/enforcer/deploy-guard/eval + B.4b populator). Push target is `fork` (upstream), **never `origin`**.
- **Working tree:** only pre-existing untracked/`M` files (ROADMAP.md, system-visualization/*, `.codex/`, etc.) — leave them.
- **Phase B feature surface is LIVE in active `~/.claude/`:** bus read/write hooks, `/code-intel` facade, the (inert) enforcer, `pruneIntelBus` session-start wiring, and the `bus-tool-populator` (Read/Grep → files_in_play). `CCV3_BUS_OFF=1` kills all bus I/O; fail-open everywhere.

---

## 2. THE BUG — daemon alive, ping fails, 166s fallback (root diagnosis)

The bus-bias quality lift (+33.6%) is real but only materializes on the **hybrid** (vector + FTS) recall path, which needs the BGE embedding daemon to answer the query-embed within the recall budget. **Right now it doesn't**, even though the daemon is up. Evidence captured this session:

| Probe | Result |
|---|---|
| Daemon process (pid 760228) | **ALIVE** — `python`, **1190 MB RAM** (= `BAAI/bge-large-en-v1.5` loaded) |
| Discovery file `$TEMP/ccv3-embedding.json` | **VALID** — `{"pid":760228,"port":58998,"model":"BAAI/bge-large-en-v1.5","dim":1024}` |
| TCP port 58998 | **LISTENING**, `OwningProcess = 760228` (the daemon) |
| Live recall `recall_learnings.py --query ... --json` `_meta` | `embed_used_daemon: **false**`, `embed_fallback_reason: **"ping_failed"**`, `embed_elapsed_ms: **166106**` (166 s!), `embed_provider: "local"` |
| Windows scheduled task (`*mbed*`) | **NONE installed** |
| `~/.claude/logs/embedding-daemon-launcher.log` | **does not exist** (daemon was started ad-hoc, NOT via `start-embedding-daemon.ps1`) |

**Interpretation:** the daemon is healthy and listening, but the client's `ping_daemon()` (timeout **1.5 s**, `EMBED_DAEMON_PING_TIMEOUT_S`) is **failing** — so recall takes the fallback branch and does a full cold in-process `sentence_transformers`+`torch`+bge-large load (~166 s here; the docstring quotes ~30–45 s cold). THIS is the "intermittent not-warmed → text fallback" you've observed: sometimes the ping squeaks under 1.5 s (warm, fast), sometimes it doesn't (→ giant local fallback, or the upstream hook gives up and the gate reports COLD / text-only).

### Candidate root causes (investigate in this order)
1. **Single-threaded socketserver blocking under concurrent recalls.** Check whether the daemon uses `socketserver.TCPServer` (serial) vs `ThreadingTCPServer`. If serial, a ping queues behind any in-flight embed/connection and blows the 1.5 s ping budget. Hooks (`memory-awareness`, `agent-recall-injector`) + the gate can hit it concurrently. **Most likely.** Fix = `ThreadingTCPServer` (or a dedicated fast-path for ping), or raise `EMBED_DAEMON_PING_TIMEOUT_S`.
2. **Ping handshake / frame bug.** Verify `ping_daemon` (embedding_daemon.py ~L716) writes/reads the 4-byte big-endian length prefix + JSON frame exactly as the server expects, and that `sock.settimeout(...)` covers connect AND read. A connect that succeeds but read that hangs → ping_failed.
3. **Ping timeout too tight on this box.** 1.5 s may be marginal under Defender/AV connect latency on loopback. Bump to ~3 s and re-measure. (Cheap test, but treat as a band-aid if #1 is the real cause.)
4. **Stale-discovery vs live-daemon races** (`embedding_daemon.py` ~L351/L397/L530 already discuss two-process / stomped-discovery hazards). Confirm there isn't a SECOND dead daemon whose discovery file the client reads while the live one listens elsewhere. (Here the discovery pid matched the listening pid, so not the issue *today* — but it explains intermittency across reboots.)

### Reproduce the diagnosis (one-liner)
```bash
cd "$CLAUDE_OPC_DIR" && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "context bus" --k 2 --json 2>/dev/null | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(d._meta)'
```
You should see `embed_used_daemon` + `embed_fallback_reason` + `embed_elapsed_ms`. **Goal state:** `embed_used_daemon: true`, `embed_elapsed_ms` ~30–200 ms.

You should be able to run a standalone ping probe too (mirror `ping_daemon`): read the discovery file, connect to `127.0.0.1:<port>`, send the ping frame, time the round-trip. If a hand probe with a 5 s timeout succeeds but the 1.5 s client fails → it's the timeout/concurrency (cause #1/#3).

---

## 3. The fix → then re-run (the actual deliverable)

1. **Root-cause + fix the ping failure** per §2 (likely `ThreadingTCPServer` and/or a saner ping timeout). TDD against `opc/tests/unit/test_embedding_daemon_*.py` (guard + lock tests already exist — extend them with a "ping answers under load" / "ping answers within budget" case). Keep the embed output byte-for-byte identical to `LocalEmbeddingProvider` (1024-dim; the `archival_memory` schema is bound to it — **do NOT change the model or dim**).
2. **Make the daemon reliably warm + persistent.** Run `scripts/start-embedding-daemon.ps1` (logs to `~/.claude/logs/embedding-daemon-launcher.log`) to confirm a clean managed start, and install the **scheduled task** via `scripts/install-embedding-daemon-task.ps1` so the daemon survives reboots (it is NOT installed now — that's why warmth is intermittent). Verify with `Get-ScheduledTask *mbed*`.
3. **Confirm warm:** the reproduce one-liner shows `embed_used_daemon: true` with low ms.
4. **Re-run the hybrid quality gate** (now genuinely warm):
   ```bash
   node scripts/bus-quality-gate.mjs hybrid
   ```
   - It prints `embedding daemon: WARM|COLD`. Require **WARM**.
   - Expect the lift to reproduce: **~+33.6% mean top-score, ~63%→88% hit-rate**, verdict **KEEP ENABLED**, and the **READ-ONLY ASSERTION PASS** (archival_memory row count unchanged — was 574 at last run).
   - For contrast, text-only (`node scripts/bus-quality-gate.mjs`) ran COLD this phase and reproduced the documented **−12.9%** (bias gated off there — correct).
5. **Record the result** (warm hybrid numbers + daemon-fix commit) and update `docs/ccv3-ws2-phaseB-plan-2026-06-02.md` Build Progress / the "deferred B.4b → DONE" note.

---

## 4. How the daemon works (carry-forward facts)
- **Model:** `BAAI/bge-large-en-v1.5`, 1024-dim. Loaded once; hot `encode` is ~30–100 ms vs ~30–45 s cold import. **The whole point of the daemon is to amortize that import.** Schema-bound — never change model/dim without a full re-embed migration.
- **Transport:** TCP loopback `127.0.0.1`, OS-assigned port, `TCP_NODELAY`, 4-byte big-endian length prefix + JSON UTF-8 frame (mirrors the Phase-2 rerank daemon).
- **Discovery:** `$TEMP/ccv3-embedding.json` = `{pid, port, model, dim, started_at}`, written **after** the model finishes loading.
- **Client routing** (`recall_learnings.py`): only used when `provider == "local"` AND ping returns `ready:true` within 1.5 s; otherwise in-process fallback. `--text-only` skips embedding entirely (no daemon dependency) — the deterministic, daemon-free path.
- **`_meta` fields** to read: `embed_used_daemon`, `embed_fallback_reason`, `embed_elapsed_ms`, `embed_provider` (surfaced by recall when `--json`).

---

## 5. Hard guardrails
- **Edit repo files, not `~/.claude/`** (forward-sync is the only auto direction). If you touch `.claude/hooks/src/*.ts`, rebuild dist + hash-verify active + `cp` if stale + run `bash scripts/audit-braintrust-emits.sh` (4/4). The daemon fix is Python (`opc/scripts/core/`) so the hook-deploy ritual likely doesn't apply — but the **pre-commit build-forget guard is now LIVE** (Phase 3.0): if you DO stage a hook `.ts`, you must stage the rebuilt `.mjs` or the commit is blocked (escape: `SKIP_BUILD_GUARD=1`).
- **Test gate = the relevant subset**, not the full `vitest run` (it hangs on a pre-existing Windows daemon/socket suite — unrelated to the embedding daemon). For Python daemon work use `opc/tests/unit/test_embedding_daemon_*.py` via `uv run pytest`.
- **Cross-model `/review` (critic + codex-adversary)** before committing the daemon fix — concurrency/socket code is exactly where the cross-model lift pays off.
- **Push `fork`, never `origin`.** Work on a feature branch off `main`, open a PR, same CodeRabbit gate as #5/#6.
- **Don't kill the live daemon (pid 760228) carelessly** — if you restart it, the model reload is ~30–45 s; the gate's first hybrid call will be slow until warm.

---

## 6. One-line status
WS-2 Phase B is fully merged (PR #5 + #6). The only open item is the **embedding-daemon ping failure**: daemon alive + port listening + model loaded, but `ping_daemon()` fails the 1.5 s budget → recall falls back to a 166 s in-process embed. Root-cause (likely single-threaded socketserver and/or tight ping timeout), fix + persist (scheduled task), then re-run `node scripts/bus-quality-gate.mjs hybrid` warm to re-confirm +33.6%.

---

## 7. Kickoff prompt (paste into the fresh session)

Resume CCv3. FIRST read this handoff in full:
docs/ccv3-ws2-phaseB-SESSION6-HANDOFF-2026-06-04.md
WS-2 Phase B is fully merged (PR #5 `1295fd4` + PR #6 `0a2e75b` on fork/main; never origin).

The one open task: the BGE embedding daemon is ALIVE (pid was 760228, port 58998 listening,
1190MB = model loaded) and its discovery file is valid, BUT a live recall reports
`embed_used_daemon:false, embed_fallback_reason:"ping_failed", embed_elapsed_ms:166106` —
the 1.5s `ping_daemon()` is failing, so recall pays a ~166s cold in-process embed. No
scheduled task is installed and there's no launcher log (daemon started ad-hoc).

Do, in order: (1) reproduce via
`cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "context bus" --k 2 --json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(d._meta)'`
(2) root-cause the ping failure in opc/scripts/core/embedding_daemon.py — prime suspect is a
single-threaded socketserver blocking the ping under concurrent recalls (fix: ThreadingTCPServer
and/or raise EMBED_DAEMON_PING_TIMEOUT_S in recall_learnings.py); verify the ping frame protocol;
TDD against opc/tests/unit/test_embedding_daemon_*.py. (3) start + PERSIST the daemon via
scripts/start-embedding-daemon.ps1 + scripts/install-embedding-daemon-task.ps1 (scheduled task).
(4) confirm warm (`embed_used_daemon:true`, low ms), then re-run `node scripts/bus-quality-gate.mjs hybrid`
and confirm WARM + ~+33.6% top-score / 63→88% hit-rate + READ-ONLY ASSERTION PASS (0 DB writes).
(5) record the warm numbers + flip the plan doc's "deferred B.4b → DONE". Do NOT change the BGE
model/dim (archival_memory schema is bound to 1024-dim). Cross-model /review the daemon fix; push
to fork on its own PR; never origin.
