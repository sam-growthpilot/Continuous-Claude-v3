# Memory System Handoff — 2026-05-21

**Status:** SUCCEEDED — daemon hardening (`d0b0614` + `f9ca075`) shipped to `fork/main`. Phase 5 verification GREEN across all 7 criteria. **Deep audit run 2026-05-21 evening: CONDITIONAL GO → unconditional GO after 5 P0 fixes landed. memory-cleanup-round-1 closed.**

**Trigger for next session:** Nothing pending on memory hardening hot path. If the same symptoms recur (recall slow, `kept_after_floor:0` rate climbs), first diagnostic is host memory pressure — see "Re-verification (2026-05-21 afternoon)" below. Known sharp edges + P1/P2 follow-ups tracked in `docs/memory-system-audit-followup-2026-05-21.md`.

**Branch:** `main` (pushed to `fork`)
**Last commit:** `f9ca075`

---

## Re-verification (2026-05-21 afternoon) — GREEN ✅

After a clean Claude Code restart (no code changes), Phase 5 was re-run end-to-end.

| Criterion | Status | Evidence |
|-----------|--------|----------|
| 1. Hook fires on memory-relevant prompt | ✅ | User prompt for the GREEN re-check got `MEMORY MATCH (1 results)` in the system reminder; subsequent prompt got `MEMORY MATCH (2 results)` |
| 2. jsonl healthy: `daemon_ready` + `mode=hybrid` + `kept_after_floor>0` | ✅ | Direct hybrid recall returned 5 hits in **967 ms** (embed via daemon **132 ms**); top scores `0.016, 0.014, 0.012` — all above the `HYBRID_FLOOR=0.01` |
| 3. No visible cmd.exe windows during prompts | ✅ | `windowsHide:true` from commit `b3b8177` intact |
| 4. Exactly ONE daemon process (supervisor + worker pair) | ✅ | PID 27376 supervisor + PID 27244 worker; discovery file at `$TEMP/ccv3-embedding.json` points to worker. Not an orphan — the supervisor/worker pair is the normal Python `--daemon` double-fork. |
| 5. Smoke recall fast | ✅ | **856 ms** text-only, **967 ms** hybrid (vs 12–17 s timeouts yesterday) |
| 6. 6 MCPs reconnected | ✅ | nia, serena, context7, next-devtools, playwright, shadcnspace-mcp all back via auto-recovery from `~/.mcp.json` |
| 7. /memory-stats / recall returning quality hits | ✅ | Top hits include `task-11-embedding-daemon-decision` and `phase2-reranker-decision` — both directly relevant to the query |

### Root cause of yesterday's "PARTIAL" — confirmed in retrospect

Yesterday's RED state was driven entirely by host memory exhaustion (0.3 GB free out of 32 GB). The BGE-large model was paged out to `pagefile.sys`, so every cold subprocess invocation took 41 s on major page faults. After the Claude Code restart, free RAM climbed to 14 GB and the daemon refaulted itself into resident memory (RSS jumped 334 MB → 1533 MB on first hybrid query). No code changes were needed.

### Daemon warm-up window (operational caveat, not a bug)

First memory-relevant prompt after a fresh session **may** see `daemon_ready:false` and fall to text-only mode if the daemon hasn't finished refaulting the model yet. The cold-load is ~35 s on warm-pagecache machines but can stretch longer when the model is being read from `pagefile.sys`. The TEXT_ONLY_FLOOR (`0.05`) is conservative — short / generic prompts may return `kept_after_floor:0` during this window because real hits cluster around `0.04–0.048`. Once the daemon is warm and `mode:"hybrid"` activates, the lower 0.01 floor keeps them.

### Status of the three fix options from yesterday's handoff

- **Option A (free RAM, no code):** Effectively in place after the restart. Durable so long as host RAM stays > 2 GB free.
- **Option B (bump hook timeout 12s → 30s):** Not needed for the GREEN case. Keep in pocket if paging returns and operational discipline isn't enough.
- **Option C (host-memory-pressure probe + fallback):** Not justified by current data. Revisit only if Option A proves brittle in practice.

### Open follow-ups (not blockers, ship-ready)

1. **Text-only floor calibration (optional):** Lowering `TEXT_ONLY_FLOOR` from `0.05` to `~0.03` would catch borderline hits during the daemon warm-up window. Trade-off: more noise when the daemon is unreachable for non-warm reasons. Not urgent — daemon-warm path already covers the common case.
2. **memory-recall.jsonl rotation oddity:** The file ended this session with only 8 entries (all from 2026-05-19 pageindex queries), but earlier in the same session had ~50+ entries including 2026-05-21 user-prompt hooks. Something rewrites or filters the log. Worth tracing if anyone wants reliable telemetry. Not a blocker — the hook itself works. **Update (2026-05-21 evening): did not reproduce in audit Phase 2d — 78 lines monotonic over 30s.**

---

## Deep Audit (2026-05-21 evening) — Unconditional GO ✅

Ran a 5-reviewer parallel audit (principal-reviewer, critic, profiler, arbiter, scribe) + 4 live behavioral probes (Phase 2a–2d) to validate the system before declaring it production-ready. Verdict: **CONDITIONAL GO → unconditional GO after 5 P0 fixes landed** in this commit.

**Synthesis file:** `.claude/cache/agents/review-agent/synthesis-2026-05-21.md`
**Filed-issues + deferred work:** `docs/memory-system-audit-followup-2026-05-21.md`

### Live audit gates (all PASS)

- **2a Recall quality:** 8/10 hand-picked queries hit (gate ≥ 7). Top scores 0.014–0.033 above the 0.01 hybrid floor. Semantically relevant matches.
- **2b Latency distribution (5 warm runs):** p95 total 1958 ms (gate < 5000 ms); p95 embed 129 ms; very consistent.
- **2c Failure modes (live induced):**
  - Daemon kill → text-only fallback 1.3 s ✓; hybrid in-process fallback 10.85 s ⚠ (close to 12 s hook ceiling)
  - Rerank: hook-irrelevant (hook never passes `--rerank`) ✓
  - DB ACCESS EXCLUSIVE lock 15 s → recall blocked 13.3 s then completed when released. A 12 s hook would have SIGKILL'd cleanly (no partial-result path; observable via `db_subprocess_timed_out`).
- **2d Telemetry:** `memory-recall.jsonl` monotonic over 30 s (78 lines stable). Rotation oddity from yesterday did not reproduce.

### P0 fixes that shipped (this commit)

| # | File:line | Fix | Why |
|---|-----------|-----|-----|
| 1 | `recall_learnings.py:226` | `EMBED_DAEMON_PING_TIMEOUT_S` 0.2 → 1.5 | TS-side pings at 1.5 s; Python re-pinged at 0.2 s. Asymmetry was the architectural-cause of the historical 86 % `kept_after_floor:0` pattern. |
| 2 | `rerank.py:442` | `ping_daemon` default kwarg 0.2 → 1.5 | Bug A fixed the call site (`d0b0614`) but missed the default. Future callers would silently regress. |
| 3 | `embedding_daemon.py:656` | `_run_bench` undefined `n` → `len(times)` | Every `--bench` invocation crashed with NameError. The latency verification gate was broken. |
| 4 | `memory-awareness.ts:534` | Add stderr trace to `main().catch()` | Silent error swallow = invisible production degradation. |
| 5 | `recall_learnings.py:1-26` | Rewrite stale docstring | Was pre-Phase-1 (still said Voyage-primary). Misleads any agent reading it. |

### 2 BLOCKERs filed as known sharp edges (do not block GO)

Both have explicit triggers + recovery runbooks in `memory-system-audit-followup-2026-05-21.md`:

- **BLOCKER-1** — Spawn race in `_check_existing_daemon` (Python-side gap). TS-side lockfile mutex closes the common path; gap is real but rare. Trigger: concurrent cold-starts. Recovery: identify orphan PID, single-targeted kill.
- **BLOCKER-2** — No host-memory-pressure defense. Yesterday's RED was this exact mode. P0 fix #1 (ping asymmetry) removes the primary trigger; residual sensitivity to free-RAM < 2 GB remains. Recovery: free RAM, daemon refaults itself.

### Deferred work (tracked in audit-followup doc)

- P1 follow-ups: sequential local+DB checks (parallel-ize for ~30-50 % latency win), stale-discovery-file cleanup, dedup-error stderr, etc.
- P2 architectural items: exclusive-lockfile primitive, host-RAM probe, partial-result path on 12 s SIGKILL.
- P3 cosmetics: count-field inflation, docstring nits.

### What this means for ongoing work

Memory recall is **safe to rely on day-to-day**. Two operational notes:

1. **Watch host RAM.** If free < 2 GB sustained, expect degraded recall. First move on any regression is freeing memory, not editing code.
2. **The `_check_existing_daemon` guard works for the common case but isn't bulletproof.** Don't try to "fix" supervisor/worker process pairs — they're normal.

memory-cleanup-round-1 story is permanently closed.

---

## What got verified yesterday (the daemon work)

The 27-commit memory hardening push is live on `fork/main`:

| Commit | What it ships |
|--------|---------------|
| `f9ca075` | Clean 42/42 reranker eval — verdict reconfirmed `opt-in` (NDCG +107%, p95 35s, 0 timeouts) |
| `d0b0614` | Bug A (rerank ping timeout 0.2s→1.5s) + Bug B (eval_recall sys.path bootstrap) |
| `7c95ca5` | Embedding daemon refuses to start if another instance is alive |
| `c7412df` | Test suite mocks spawn — stops real daemon launches during vitest |
| `b3b8177` | `windowsHide: true` on Node spawn — no visible cmd windows |
| `0a2d4e1` | Daemon-spawn cascade fix (ping cleanup + cross-process mutex) |
| `0b59faa` | memory-awareness.ts restored from `d47b970` linter revert |

Decision doc `docs/phase2-reranker-decision-2026-05-18.md` has the clean-run addendum.

---

## Phase 5 verification — RED with reframed findings

The fresh-session verification report (sent back from a separate CC session) showed:

| Criterion | Status |
|-----------|--------|
| Hook fires on memory-relevant prompt | ✅ |
| jsonl entry is healthy (mode=hybrid, daemon_ready=true, kept_after_floor>0) | ❌ — `db_subprocess_timed_out:true` 52% / 24h, `kept_after_floor:0` 86% |
| No new cmd.exe windows | ✅ |
| Exactly ONE embedding daemon process | ❌ (initially — see below) |
| Smoke recall (text-only, <2s expected) | ⚠️ 19.6s |
| /memory-stats hit rate | 4% (2 of last 50 with kept_after_floor>0) |
| 6 MCPs reconnected | ❌ all 6 still absent |

### Correction: the "orphan daemon" was a misread

What looked like a duplicate-spawn race (PIDs 619160 and 626524 at the same creation timestamp) is actually **the normal Python `--daemon` supervisor/worker pair**:

- PID 619160 = supervisor (parent process)
- PID 626524 = worker (child); writes the discovery file at `$TEMP/ccv3-embedding.json`

The `_check_existing_daemon` guard from `7c95ca5` did its job. Discovery file is consistent. **No kill needed.** The next session should NOT try to "fix" this.

---

## The real story: host memory exhaustion (root-caused 2026-05-21)

### Evidence (✓ VERIFIED)

| Measurement | Value |
|-------------|-------|
| Free physical RAM | 0.3 GB out of 31.73 GB |
| Committed memory | 54.53 GB against 83.73 GB commit limit (65% commit; ~22 GB beyond physical) |
| Embedding daemon working set | 7.7 MB resident, **2.8 GB paged** (BGE-large model paged out) |
| `vmmemWSL` (Docker/WSL backend) | 415 MB resident, 3.26 GB paged |
| Cold `import scripts.core.recall_learnings` | **41.2 s** (vs ~2.5 s warm) |
| Warm text-only recall | 2.7–3.2 s |
| Warm hybrid recall | 3.8 s → 9.8 s → 17.1 s (high variance = paging contention) |

### Why this regressed without a code change

Today's commits did NOT touch `recall_learnings.py`, `memory-awareness.ts`, or the daemon. The eval at ~19:30 UTC ran fine because the daemon was warm-resident. Between then and the fresh-session Phase 5 check at ~02:50 UTC, the host pushed past commit ceiling and the kernel paged out the BGE-large model to `pagefile.sys`. Every hook fire now triggers major page faults.

### Hypotheses ruled out

| # | Hypothesis | Verdict |
|---|------------|---------|
| 1 | PG connection pool saturation | ✗ Ruled out — 5 idle + 1 active out of `max_connections=100`; no `idle in transaction` |
| 2 | Subprocess cold-start regressed (code) | ✗ Cause is paging, not code (cold 41s vs warm 2.5s on identical command) |
| 3 | Orphan daemon contention | ✗ Not an orphan — supervisor/worker pair |
| 4 | PG vacuum / index maintenance | ✗ No active queries other than the diagnostic probe |
| 5 | Hook-time env differs from eval-time | ? Partially — same env, but the box happens to be under more pressure at hook-call time |
| 6 | HuggingFace cache I/O | ✗ Model loaded once and resident in pagefile, no recent cache writes |

---

## Three fix options (pick one or defer)

### Option A — Operational only (no code) — `0 LOC, 0 commits`

Free physical memory. Close browser tabs, idle VS Code instances, large Docker workloads. The daemon refaults on first use and warm queries drop to ~3-4 s. Use this when you trust yourself to keep RAM headroom above ~2 GB.

**Tradeoff:** No durability. The problem recurs the next time the box gets loaded.

### Option B — Bump hook timeout — `~1 LOC, 1 commit, ~5 min`

`.claude/hooks/src/memory-awareness.ts:226` — bump the subprocess timeout from `12000` to `30000`. Catches the warm-but-paged case (~17 s observed). Stays well under UserPromptSubmit's 60 s budget.

**Tradeoff:** Recall on a paged-out daemon takes 17+ s of UserPromptSubmit time. The user sees a slow first prompt.

### Option C — Both: timeout bump + host-memory-pressure probe — `multi-file, ~30 min`

Option B + a new helper that reads `Win32_OperatingSystem.FreePhysicalMemory` (or `/proc/meminfo` on Unix), and when host commit ratio > 80%, silently drops `hybrid` to `text-only` with `embed_fallback_reason: "host_memory_pressure"` in the jsonl. Daemon isn't asked to refault when the box is already trashing.

**Tradeoff:** Better long-term, but multi-file change and a new code path to maintain. Probably not worth it if memory pressure is uncommon for the user.

### Recommendation

**Option A first** (free RAM, see if it sticks). If pressure recurs frequently, **Option B**. **Option C only if** the pattern is chronic and the kept_after_floor finding (below) turns out to be a deeper rework anyway.

---

## Separate finding worth its own session: `kept_after_floor:0` rate

Even when `recall_learnings.py` returns successfully, **86% of returns have `kept_after_floor:0`** — meaning the score floor (TEXT_ONLY_FLOOR=0.05, HYBRID_FLOOR=0.01) filters every result out. The recall is finding things, then throwing them away.

Likely causes (untested):
- Floors are too aggressive for short / generic prompts (e.g. "what did we ship today?")
- The hybrid RRF scores are scoring lower than the HYBRID_FLOOR for valid hits
- The query expansion in memory-awareness.ts is producing low-quality embeddings on short queries

**Action for next session:** Pull a sample of 10 jsonl entries with `kept_after_floor:0`, get the raw recall_learnings.py output (without floor) for the same queries, and see whether the floor or the recall is the problem. This is a 1-2 hour investigation that affects user-facing memory quality much more than the latency issue.

---

## 6 MCPs still absent

After the fresh CC restart, none of `nia`, `serena`, `context7`, `next-devtools`, `playwright`, `shadcnspace-mcp` reconnected. Probably a stuck `npx` cold-start cascade. Try one more CC restart. If still dead, audit `~/.mcp.json` `cmd /c` wrappers — Windows requires `command: "cmd"` + `args: ["/c", "npx", ...]` (per `.claude/rules/windows-platform.md`).

---

## Don't-touch list for next session

- **Do not** kill PID 619160 thinking it's an orphan — it's the daemon supervisor.
- **Do not** revisit `_check_existing_daemon` in `embedding_daemon.py` thinking it has a race — it doesn't.
- **Do not** assume today's commits (`d0b0614`, `f9ca075`) regressed anything DB-side — they didn't.
- **Do not** mass-kill any python.exe processes. The daemon-cascade is fixed; targeted single-PID inspections only.

---

## Resume in next session (if a regression surfaces)

memory-cleanup-round-1 is closed. If recall starts misbehaving again, in order:

1. **Check host RAM first** — `powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory, TotalVisibleMemorySize"`. If free < 2 GB, that's the root cause. Free RAM (close browser tabs / VS Code / Docker workloads) — daemon refaults and recall returns to ~1 s.
2. **Check daemon resident memory** — `Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*embedding_daemon*' }`. Worker RSS should be ~1.5 GB when warm; if it's ~300 MB the model is still paging in.
3. **Run a hybrid recall directly** to bypass the hook and see real latency: `cd opc && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "<test>" --k 5`. Healthy = ~800-1000 ms hybrid.
4. Only if 1-3 are healthy and recall is still slow, dig further. Possible follow-ups documented in "Re-verification" §Open follow-ups above.

---

## Closing note

Memory hardening is complete. Daemon side is solid, eval reconfirmed `opt-in`, commits pushed to `fork/main`, Phase 5 verified GREEN end-to-end after a clean restart. The session that turned this RED → GREEN proved out an operational reality worth keeping: **the entire system is sensitive to host memory pressure, and the first move on any recurrence is freeing physical RAM, not editing code.**
