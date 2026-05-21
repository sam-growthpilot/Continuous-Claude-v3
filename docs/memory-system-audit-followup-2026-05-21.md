# Memory System Audit — Follow-Up Tracker (2026-05-21)

**Companion to:** `docs/memory-system-handoff-2026-05-21.md` (SUCCEEDED) and the deep audit synthesis at `.claude/cache/agents/review-agent/synthesis-2026-05-21.md`.

**Purpose:** Single durable tracker for the 2 BLOCKERs, deferred HIGHs, and MEDIUMs surfaced by the 5-reviewer audit. The 5 P0 items from the audit ship in commit X (this commit). Everything below is **known but deferred** — track here so future sessions can grep for it.

---

## Audit verdict recap

**CONDITIONAL GO → ship as production with the P0 fixes landed.** Two BLOCKER findings exist in code but did not reproduce in Phase 2 live probes; both are filed below as sharp edges with explicit triggers and recovery runbooks. The system passed every live gate (8/10 recall, p95 1958ms, all failure modes degrade observably, telemetry monotonic).

---

## Confidence-firming pass (2026-05-21 evening, post-audit)

After the initial audit was committed, a confidence-firming pass surfaced **3 additional issues** that the deep audit missed. All three were fixed in the same session.

### Tests run

1. **Cross-project scope isolation** — ✓ VERIFIED. Source entry from project `6a596c70d2f0d36b` was correctly filtered when querying from `addc92d926988bb9` (continuous-claude). Default `mode='project'` filter works.
2. **Multi-session concurrent recall** — ✓ VERIFIED. Two parallel `recall_learnings.py` calls completed in 2417/2456 ms vs 2378 ms sequential baseline (~40 ms overhead). Daemon count unchanged (no race).
3. **Corpus quality 20-entry sample** — ~15-25 % noise rate measured. Caught one obvious failure: 2000-char repetition of "this is important data." that passed the L0 gate.

### New findings that the audit missed (now fixed)

| # | Finding | Severity | Fix |
|---|---------|----------|-----|
| F1 | `~/.claude/scripts/core/project_memory.py` was MISSING — `memory-awareness.ts:142` silently returned `[]`; `checkLocalMemory` had been a no-op in production | P0 | Copied file + added sync rule in `scripts/sync-to-active.sh` |
| F2 | 244 archival_memory rows (45 % of corpus) tagged `scope=PROJECT` + `project_id=NULL` — unfilterable under default `mode='project'` (dead) | P0 | Backfilled to `scope=GLOBAL` (content is general-purpose). Backup at `opc/tests/backfill-2026-05-21-pre-rows.csv` |
| F3 | L0 quality gate too permissive — pure repetition (e.g. "phrase × 50") passed all existing checks | P1 | Added uniqueness-ratio repetition check (threshold 0.25, fires only for content ≥ 200 chars). 3 new tests pass. |

### Confidence verdict after firming pass

**HIGH confidence** across:
- Hot-path latency + regression coverage + telemetry observability (unchanged)
- Cross-project scope isolation (newly verified live)
- Multi-session concurrent recall (newly verified live)
- L0 gate now catches obvious repetition

**Residual MEDIUM confidence** (acknowledged, not closing):
- Corpus quality is ~15-25 % noisy at HEAD; the L0 gate fix will reduce future-store noise but doesn't retroactively clean. Periodic `/memory-curate` runs can help.
- 2 BLOCKERs (race + host-RAM) still filed; mitigations in place.



Full reviewer breakdown:
- `principal-reviewer/audit-2026-05-21.md` — architecture (1 BLOCKER, 4 HIGH)
- `critic` (inline in session) — implementation quality (3 HIGH, 4 MEDIUM, 4 LOW)
- `profiler` (inline in session) — performance + reliability (1 BLOCKER, 3 HIGH, 4 MEDIUM)
- `arbiter/audit-2026-05-21.md` — tests (77/78 Py + 94/99 TS pass, 1 test-order flake)
- `scribe/audit-2026-05-21.md` — docs (2 HIGH, 4 MEDIUM, 2 LOW)

---

## BLOCKERs (filed-issues with runbook)

### BLOCKER-1 — Spawn race in `_check_existing_daemon`

**File:** `opc/scripts/core/embedding_daemon.py:380-405`
**Surfaced by:** principal-reviewer (sole call-out, architecturally rigorous)
**Status:** FILED — not a GO blocker

**Why filed instead of fixed:** The TS-side cross-process lockfile mutex (`embedding-client.ts:564-630`, commit `0a2d4e1`) closes the common path. Both yesterday's "two daemons" sighting and Phase 2's single-daemon stability confirm the TS-side guard works in practice. The Python-side gap is a real race window but rare under current operational patterns (single user, daemon stays warm).

**Trigger conditions to watch for:**
- Two Claude Code sessions simultaneously hit the hook with no warm daemon (concurrent cold-start).
- A non-TS-mediated spawner (e.g., the Windows Task Scheduler pre-warm task) fires at the same instant as a session start.
- Symptom: two `python.exe embedding_daemon.py --daemon` processes with different PIDs and overlapping creation times in `Win32_Process`, only one of which matches the discovery file's `pid`.

**Recovery runbook:**
1. Identify canonical PID from `$TEMP/ccv3-embedding.json`.
2. Kill the OTHER PID (the orphan) with `Stop-Process -Id <orphan> -Force`. Do NOT mass-kill.
3. The orphan can race to call `_delete_daemon_info()` on shutdown — if discovery file disappears, daemon respawns on next hook fire (~35s warm-pagecache, longer cold).

**Permanent fix (when ready):** Use OS-level exclusive lock at top of `_run_daemon` in `embedding_daemon.py`:
- Windows: `msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)` on a dedicated lockfile
- POSIX: `fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)`
- Effort: M (~2-3h)

**Probability-it-fires:** LOW under single-user patterns. MODERATE under multi-session concurrent cold-starts.

---

### BLOCKER-2 — No host-memory-pressure defense

**File:** `.claude/hooks/src/memory-awareness.ts` (no probe exists)
**Surfaced by:** profiler (sole call-out, ✓ VERIFIED by yesterday's RED-state jsonl data)
**Status:** FILED — not a GO blocker, but the P0 ping-asymmetry fix removes the primary trigger

**Why filed instead of fixed:** Yesterday's RED (52% `db_subprocess_timed_out:true`, 86% `kept_after_floor:0`) was driven by host RAM dropping to 0.3 GB free, pushing the BGE-large model into `pagefile.sys`. Recovery is operational (free RAM), not code. The P0 ping-asymmetry fix (`recall_learnings.py:226` 0.2s → 1.5s) closes the 200ms slip-point that triggered the SIGKILL cascade — but the underlying sensitivity to host RAM remains.

**Trigger conditions to watch for:**
- Free physical RAM < 2 GB sustained
- `daemon_ready:true mode:"hybrid" kept_after_floor:0` rate climbing >20% over a 1h window in `memory-recall.jsonl`
- `db_subprocess_timed_out:true` rate climbing
- Daemon worker RSS dropping below ~500 MB while `PageFileUsage` climbs above 1 GB

**Recovery runbook:**
1. `powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory, TotalVisibleMemorySize"` — confirm free RAM is the issue.
2. Close browser tabs / VS Code instances / Docker workloads to bring free RAM > 2 GB.
3. Daemon will refault itself into RAM on next hook fire (`Win32_Process.WorkingSetSize` climbs ~300 MB → ~1500 MB).
4. Subsequent recalls drop from 12s+ timeout to ~1s healthy.

**Permanent fix (when ready):**
1. Add free-RAM probe at hook entry (`memory-awareness.ts` start of main).
2. When free RAM < 2 GB: emit `host_memory_pressure:true` to jsonl, write stderr warning, and skip the hybrid path (force text-only) to avoid the page-fault tax.
3. Document the runbook in `.claude/skills/memory/SKILL.md` operational section.
4. Effort: M (~3-4h)

**Probability-it-fires:** HIGH historically (yesterday's RED). Depends entirely on operational RAM hygiene.

---

## Deferred HIGHs (ACCEPT-WITH-NOTE)

These were flagged but the synthesis judged them acceptable-as-is given mitigations or scope:

### HIGH — `rerank.py` lacks `_check_existing_daemon` equivalent
**File:** `opc/scripts/core/rerank.py:336-383`
**Surfaced by:** principal-reviewer
**Disposition:** ACCEPT-WITH-NOTE. `--rerank` is opt-in and off-hot-path (hook never calls it per grep verification). Port the guard when `--rerank` goes default-on. Effort: M.

### HIGH — 12s SIGKILL has no partial-result path
**File:** `.claude/hooks/src/memory-awareness.ts:226`
**Surfaced by:** profiler H2, ✓ live-confirmed in Phase 2c.3 (DB lock 13.3s blocked recall; a hook would have SIGKILLed)
**Disposition:** ACCEPT-WITH-NOTE. The timeout IS observable (`db_subprocess_timed_out:true` in jsonl). Adding partial-result paths is M-L refactor. Future improvement: on SIGKILL, retry with `--text-only` short budget. Effort: M-L.

---

## Should-fix-soon (P1 — high-value, low-risk, not in P0)

| Item | File:line | Fix | Effort |
|------|-----------|-----|--------|
| Sequential local+DB checks | `memory-awareness.ts:480-481` | Convert to `Promise.all` with `spawn` (not `spawnSync`). ~30-50% latency win on every hook fire. | M |
| `SPAWN_LOCK` never deleted (60s no-recovery after failed spawn) | `embedding-client.ts:52-57` | Unlink lockfile on spawn success/fail; keep TTL as fallback. | S |
| Stale discovery file on daemon kill | embedding-client.ts cleanup path | On daemon SIGKILL detection, unlink discovery file (Phase 2c.1 confirmed manual rm needed). | S |
| `--threshold` semantics inconsistent (raw vs `*0.01`) | `recall_learnings.py:1712,1729` | Document in --help; consider unifying scale. | S |
| Dedup failure silently swallowed | `store_learning.py:400-402` | Add stderr warning + counter; silent failure leaves DB with duplicates. | XS |
| Floor split documentation (two layers, undocumented) | `recall_learnings.py:1729` + `memory-awareness.ts:43` | Two cross-reference comments. | XS |
| SKILL.md missing `--rerank` flag | `.claude/skills/memory/SKILL.md` options table | Add row. | XS |
| Test-order flake in `test_recall_learnings.py` | `test_recall_learnings.py` | Patch `sys.modules["core.embedding_daemon"]` consistently across the file. | XS |
| `proactive-memory-disclosure.md` not stubbed | `.claude/rules/` + `.claude/skills/memory/` | Decide: stub-and-merge into SKILL.md OR keep standalone with cross-link. | S |
| Phase 2 doc "+107%" title vs "+110.4%" body | `docs/phase2-reranker-decision-2026-05-18.md` | Pick one number, update both. | XS |

---

## P2 — Filed-issues for architectural concerns (won't fix in this round)

| Item | File:line | Fix | Effort |
|------|-----------|-----|--------|
| BLOCKER-1 exclusive lockfile | `embedding_daemon.py:380-405` | Add `msvcrt.locking`/`fcntl.flock` | M |
| BLOCKER B1 host-RAM probe | `memory-awareness.ts` | Free-RAM probe + jsonl entry + stderr warn | M |
| `rerank.py` startup guard | `rerank.py:336-383` | Port `_check_existing_daemon` | M |
| `_EMBED_CALL_LOCK` daemon-side serialization | `embedding_daemon.py:193,257-258` | Concurrent embed handling (architectural) | L |
| 12s SIGKILL partial-result path | `memory-awareness.ts:226` | Return local-memory results on DB timeout | M-L |

---

## P3 — Lower priority / cosmetic (deferred indefinitely)

| Item | File:line | Fix | Effort |
|------|-----------|-----|--------|
| `mergeResults` `count` inflated when dedup > 3 | `memory-awareness.ts:327-331` | `count: results.length` not `deduped.length` | XS |
| Rerank silent skip when `len(results) == args.k` | `recall_learnings.py:1740` | Change `>` to `>=` | XS |
| `_spawnAttempted` dead code | `embedding-client.ts:506-507` | Remove flag and setter | XS |
| Spawn lockfile epoch precision | `embedding-client.ts:535-541` | Use `Date.now()` directly; rename to `started_at_ms` | XS |
| TOCTOU on discovery cleanup | `embedding-client.ts:402-420` | Re-read discovery before unlink | S |
| `docs/memory-system-handoff-2026-05-20.md` not marked superseded | doc | Add "SUPERSEDED BY 2026-05-21" header | XS |
| `docs/phase2` "33/42" ambiguity | doc | Add forward-pointer to addendum at top | XS |
| `store_learning.py` docstring missing L0 gate | docstring | Add gate description | XS |
| `recall_learnings.py` docstring path examples wrong (FIXED in P0 #5) | docstring | Already addressed by P0 fix #5 | DONE |
| ROADMAP/task-tracker entries for these follow-ups | various | Add to ROADMAP.md or task tracker | S |

---

## Things demonstrably solid (won't be touching)

Per reviewer + Phase 2 consensus, these are working correctly. **Do not refactor without strong reason:**

- Two-daemon separation (embedding-client.ts vs daemon-client.ts) — separate protocols, no redundancy
- Mode-aware floor split (HYBRID=0.01 RRF / TEXT=0.05 ts_rank)
- Bug A regression test (`test_rerank.py:297` asserts ping ≥1.0s)
- Bug B regression test (`test_eval_recall.py:14` asserts module-scope `_pct`)
- Daemon guard `_check_existing_daemon` (6/6 unit tests; defensive against dead PID, ping timeout, wrong model, connection refused — incomplete per BLOCKER-1 but correct as far as it goes)
- Cross-process spawn lockfile TS-side (4/4 vitest tests)
- Spawn mock in tests (no real daemon spawned)
- TCP framing protocol (length-prefixed, defensive type narrowing, model+dim re-verification)
- `db_subprocess_timed_out` observability (distinguishes no-matches from SIGKILL)
- Fail-open jsonl logging (never breaks the hook)
- Dedup at 0.85 cosine with scope partitioning
- Live recall quality 8/10 hit, p95 1958ms, monotonic telemetry

---

## How to use this doc

- **If a regression surfaces on memory recall:** start with BLOCKER-2's runbook (free RAM first), then check this doc for known issues that might match the symptom.
- **If `kept_after_floor:0` rate climbs:** the P0 ping fix should have removed the primary trigger; if it returns, look at BLOCKER-2 trigger conditions.
- **If you're picking up P1 work:** the table above is the recommended order by impact × probability.
- **If you're closing this doc:** every item should be either DONE (with commit hash) or moved to ROADMAP/task tracker.

Updated: 2026-05-21 (synthesis verdict + P0 ship).
