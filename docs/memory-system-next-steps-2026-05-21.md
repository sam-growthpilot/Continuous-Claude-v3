# Memory System — Next Steps (2026-05-21)

**Status:** Memory-cleanup-round-1 is **closed and locked-in as production** (commit `48a2157`). The hot path works reliably at current scale and across projects. This doc tracks **three known sharp edges** that did not block GO but are worth addressing in a future session.

**Companion docs (all on `fork/main`):**
- `docs/memory-system-handoff-2026-05-21.md` — closure narrative (status: SUCCEEDED)
- `docs/memory-system-audit-followup-2026-05-21.md` — full audit + confidence-firming findings catalog
- `docs/memory-system-visualization.html` — animated walkthrough of the complete system
- `docs/phase2-reranker-decision-2026-05-18.md` — reranker decision + clean-run addendum
- `docs/task-11-embedding-daemon-decision-2026-05-18.md` — embedding daemon decision
- `.claude/cache/agents/review-agent/synthesis-2026-05-21.md` — multi-reviewer audit synthesis

**Recent commit chain on fork/main:**
```
48a2157 fix(memory): confidence-firming pass — sync project_memory, backfill 244 rows, tighten L0 gate
4379630 docs(memory): add animated HTML visualization of the memory system
885f8da fix(memory): P0 audit fixes + close memory-cleanup-round-1
9957b68 chore: gitignore *.bak and untrack codex-adversarial backup
3712579 docs(memory): Phase 5 verified GREEN; close memory-cleanup-round-1
f9ca075 test(memory): clean 42/42 reranker eval — verdict reconfirmed opt-in
d0b0614 fix(memory): raise daemon ping timeout to 1.5s; lift eval_recall core import to module scope
```

---

## TL;DR — what's open

| # | Item | Severity | Effort | Why it's open |
|---|------|----------|--------|---------------|
| 1 | Corpus noise — retroactive cleanup of low-signal entries | MED | M (1-2 hr) | L0 gate now catches NEW repetition, but ~15-25% of HEAD corpus is still noisy |
| 2 | Python-side spawn race (BLOCKER-1) | MED — race window narrow | M (~2-3 hr) | TS lockfile closes common path; Python gap real but rare under current ops |
| 3 | Host-RAM-pressure defense (BLOCKER-2) | HIGH — historical incidents | M (~3-4 hr) | Yesterday's RED was this exact mode; runbook in place but no code probe |
| 3a | Hide daemon console on Windows (quick win) | LOW — UX | XS (~15 min) | Hook-spawn hides; Bash/Task-Scheduler spawns don't — clutter for users with 5-8 terminals |
| 4 | Storage growth / pgvector latency at 5,000+ entries | LOW today, MED later | S-M (~1-2 hr) | Untested; current corpus 545 rows so not yet hot |

None of these are catastrophic. The system works reliably at current scale and under current operational hygiene. These are quality-and-resilience improvements, not bug fixes.

---

## Item 1 — Retroactive corpus cleanup (~15-25 % noise rate)

### Background

The 2026-05-21 confidence-firming pass sampled 20 random rows from `archival_memory`:

| Signal | Count | Examples |
|--------|-------|----------|
| HIGH (directly useful) | ~4 | "Always use Drizzle ORM" (user pref), "Ralph scale hardening unified state" (architecture), "For large refactors use wave-based execution" (pattern) |
| MEDIUM (situationally useful) | ~12 | "Planning: Code Review of X" — auto-extracted plan summaries |
| **NOISE / LOW** | ~4 | "Problem solved after 2 attempts" (test artifact), 2000-char repetition of "this is important data", mid-thought fragments |

Extrapolating: roughly 130-200 of the current ~620 rows (post-backfill) are low-signal. They drag on recall quality (low scores, occasional noise hits) and waste embedding storage.

The L0 gate update in commit `48a2157` (uniqueness-ratio check, threshold 0.25, fires for content ≥ 200 chars) catches **new** repetitive entries at store time. It does NOT clean **existing** rows.

### What's already shipped (no action needed)

- L0 repetition check live (`opc/scripts/core/store_learning.py`, 3 new tests in `test_store_learning_v1_gate.py`)
- 244 NULL-project_id rows backfilled to `scope=GLOBAL` (CSV backup at `opc/tests/backfill-2026-05-21-pre-rows.csv`)
- `memory-recall.jsonl` telemetry exposes `kept_after_floor` — observable signal for "how often does the floor filter everything out"

### Recommended approach

**Use the existing `/memory-curate` skill.** Per `.claude/skills/memory-curate/SKILL.md`, it audits and scores entries, archives low-quality ones via the supersede protocol (sets `valid_until=NOW()` so they stay in the DB for audit but are excluded from default recall).

```bash
/memory-curate
```

Stages:
1. **Sample 50-100 random rows** and manually rate signal/noise (extends the 20-row sample from the audit).
2. **Pattern-match obvious noise classes** — short content like "Problem solved after N attempts", mid-thought captures like "Wait, let me check", planning fragments with no decisions.
3. **Bulk-supersede** matching rows. Use the `/supersede` skill if it's a clear replacement; use a direct UPDATE if it's "no replacement, just stale".
4. **Sanity-check**: rerun the 20-entry random sample after; aim for &lt; 10 % noise.

### Acceptance criteria

- [ ] 20-entry random sample shows ≤ 2 NOISE-tier entries (vs current 4)
- [ ] `kept_after_floor:0` rate in the next 50 hook fires &lt; 30 % (currently ~30-40 % on borderline queries due to noise dragging scores)
- [ ] Backup CSV at `opc/tests/curate-pre-rows-YYYY-MM-DD.csv` for whatever gets superseded
- [ ] Commit message documents the curation pass numbers

### Files / commands to know

- Skill: `.claude/skills/memory-curate/SKILL.md`
- Storage table: `archival_memory` (Postgres, columns: id, session_id, content, scope, project_id, valid_from, valid_until, ...)
- Supersede mechanism: `valid_until` column; exclude from recall via `WHERE valid_until IS NULL OR valid_until > NOW()`
- Query to find candidates: `SELECT id, length(content), left(content, 100) FROM archival_memory WHERE valid_until IS NULL ORDER BY random() LIMIT 50;`

### Effort: M (~1-2 hr including manual scoring + bulk update + verification)

---

## Item 2 — Code-fix the 2 deferred BLOCKERs

### BLOCKER-1: Python-side spawn race in `_check_existing_daemon`

#### Background

The audit (principal-reviewer finding BLOCKER-1) flagged a race window in `opc/scripts/core/embedding_daemon.py:380-405`. The flow:

```
spawner A: _check_existing_daemon() → no daemon → proceed to spawn
spawner B: _check_existing_daemon() → no daemon → proceed to spawn   [SAME INSTANT]
spawner A: bind port → write discovery file (PID=A)
spawner B: bind port → write discovery file (PID=B, overwrites A)
... A still running with no discovery file
... A eventually shuts down, deletes B's discovery file
```

The TS-side lockfile mutex (`embedding-client.ts:564-630`, commit `0a2d4e1`) closes this for hook-driven spawns — two sessions can't both pass the lock. The gap is **non-TS-mediated spawners**: Windows Task Scheduler pre-warm task firing simultaneously with a hook spawn, or direct CLI invocations during a hook fire.

Probability under current ops: LOW (single-user, daemon stays warm). MODERATE if multi-session concurrent cold-starts ever happen.

#### Current mitigation

Runbook in `docs/memory-system-audit-followup-2026-05-21.md`:
1. Identify canonical PID from `$TEMP/ccv3-embedding.json`.
2. Single-targeted `Stop-Process -Id <orphan> -Force` on the non-canonical PID. **Do not mass-kill.**
3. Next hook fire respawns cleanly.

#### Recommended code fix

Add an OS-level exclusive lock at the top of `_run_daemon` BEFORE `_check_existing_daemon`:

```python
# opc/scripts/core/embedding_daemon.py — top of _run_daemon
import os, sys, tempfile, atexit

LOCK_PATH = os.path.join(tempfile.gettempdir(), "ccv3-embedding-daemon.lock")

def _acquire_exclusive_lock():
    """Cross-process exclusive lock. Returns the fd on success or None if
    another daemon already holds it. POSIX uses fcntl.flock; Windows uses
    msvcrt.locking."""
    try:
        fd = os.open(LOCK_PATH, os.O_RDWR | os.O_CREAT, 0o644)
    except OSError as e:
        sys.stderr.write(f"[embed-daemon] lock open failed: {e}\n")
        return None

    if sys.platform == "win32":
        import msvcrt
        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        except OSError:
            os.close(fd)
            return None
    else:
        import fcntl
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(fd)
            return None

    # write PID for debugging
    os.write(fd, f"{os.getpid()}\n".encode())
    os.fsync(fd)
    atexit.register(lambda: (os.close(fd), os.unlink(LOCK_PATH)) if os.path.exists(LOCK_PATH) else None)
    return fd

# In _run_daemon:
def _run_daemon(...):
    lock_fd = _acquire_exclusive_lock()
    if lock_fd is None:
        sys.stderr.write("[embed-daemon] another daemon holds the lock; exiting\n")
        sys.exit(0)
    # ... existing _check_existing_daemon + load + serve ...
```

**Test:** spawn two `embedding_daemon.py --daemon` processes simultaneously; expect exactly one to bind and serve, the other to exit cleanly.

#### Acceptance criteria for BLOCKER-1

- [ ] `_acquire_exclusive_lock` function added, atexit cleanup registered
- [ ] Test added in `opc/tests/unit/test_embedding_daemon_guard.py` that spawns 2 processes via `subprocess.Popen` and verifies only one survives
- [ ] After fix, running 2 daemons in parallel never produces 2 alive workers (verify via `Get-CimInstance Win32_Process`)

#### Effort: M (~2-3 hr)

---

### BLOCKER-2: No host-memory-pressure defense

#### Background

The 2026-05-20 RED state (52% `db_subprocess_timed_out:true` / 86% `kept_after_floor:0`) was driven by host RAM dropping to 0.3 GB free. The BGE-large model (1.5 GB resident) got paged to `pagefile.sys`. Every recall paid ~10× the warm latency on major page faults, blowing past the 12-s hook ceiling.

Recovery is operational: free RAM (close browser tabs / Docker workloads) → daemon refaults itself → recall returns to ~1 s. The P0 ping-asymmetry fix from commit `d0b0614` removed the primary trigger (asymmetric ping timeouts that compounded the issue), but the underlying sensitivity to free-RAM &lt; 2 GB remains.

Probability under typical use: depends entirely on operational discipline. The 2026-05-20 incident is the existence-proof.

#### Current mitigation

Runbook in `docs/memory-system-audit-followup-2026-05-21.md`:
```powershell
# Check free RAM
Get-CimInstance Win32_OperatingSystem |
  Select-Object FreePhysicalMemory, TotalVisibleMemorySize
```
If &lt; 2 GB free: close browser tabs / VS Code instances / Docker workloads. Daemon refaults; subsequent recalls drop from 12-s timeout to ~1 s.

#### Recommended code fix

Two-part defense:

**Part A: Host-RAM probe at hook entry**

Add to `.claude/hooks/src/memory-awareness.ts` (around the start of `main()`, before any spawnSync):

```typescript
// At top of file
const HOST_RAM_FLOOR_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function getFreeRamBytes(): number {
  try {
    if (process.platform === 'win32') {
      // PowerShell one-shot
      const result = spawnSync('powershell', [
        '-NoProfile', '-Command',
        '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory'
      ], { timeout: 1000 });
      const kb = parseInt(result.stdout.toString().trim(), 10);
      return isNaN(kb) ? Infinity : kb * 1024;
    }
    // POSIX: parse /proc/meminfo MemAvailable
    const meminfo = readFileSync('/proc/meminfo', 'utf8');
    const m = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
    return m ? parseInt(m[1], 10) * 1024 : Infinity;
  } catch {
    return Infinity; // fail-open: don't break the hook
  }
}

// In main():
const freeRam = getFreeRamBytes();
if (freeRam < HOST_RAM_FLOOR_BYTES) {
  // Skip hybrid; go text-only. Telemetry sees the reason.
  process.stderr.write(`[memory-awareness] host RAM low: ${(freeRam/1024/1024/1024).toFixed(2)} GB free; forcing text-only\n`);
  forceTextOnly = true;
  embedFallbackReason = 'host_memory_pressure';
}
```

**Part B: Log to jsonl**

Extend the jsonl schema to include `host_memory_pressure: true` and `embed_fallback_reason: "host_memory_pressure"`. `/memory-stats` can then surface "how often did pressure trigger fallback this week?"

#### Acceptance criteria for BLOCKER-2

- [ ] `getFreeRamBytes()` helper in `embedding-client.ts` or `memory-awareness.ts` — Windows + POSIX paths, fail-open on error
- [ ] Hook entry probes RAM; below 2 GB free → forces text-only with `embed_fallback_reason: "host_memory_pressure"`
- [ ] jsonl schema extended with `host_memory_pressure` boolean
- [ ] Tests in `memory-awareness.test.ts` covering: low-RAM → text-only, healthy-RAM → hybrid, probe-error → fail-open to hybrid
- [ ] Synthetic regression: temporarily set HOST_RAM_FLOOR_BYTES to current free RAM × 2, fire a hook, verify text-only fallback + jsonl entry

#### Effort: M (~3-4 hr including tests)

#### Why this matters

The 2026-05-20 incident burned hours on diagnosis because the symptom (recall returning empty) didn't immediately point at host RAM. With this fix, the jsonl tells you exactly what happened, and the system degrades gracefully (text-only is fast and works without the daemon) instead of SIGKILL'ing at 12s with empty results.

---

## Item 3a — Hide the daemon console window on Windows (quick win)

### Background

The user runs 5-8 CLI terminals for Claude Code concurrently. The embedding daemon currently shows a visible `cmd.exe` titled `uv run --project opc python embedding_daemon.py --daemon` whenever it's started by a path that DOESN'T pass `windowsHide: true`.

Two spawn paths exist today:

| Path | Hides window? | Why |
|------|---------------|-----|
| **Hook spawn** via `memory-awareness.ts` → `embedding-client.ts:spawn()` | ✓ YES | Node `spawn` options include `windowsHide: true` (commit `b3b8177`) |
| **Bash background** (`uv run ... &` from a Git Bash terminal) | ✗ NO | Inherits the parent terminal's console behavior; the uv shim opens its own window |
| **Windows Task Scheduler pre-warm** (commit `d47b970`) | depends on the task XML | Probably visible unless `<Hidden>true</Hidden>` is set in the task definition |
| **Direct PowerShell `Process.Start` with `CreateNoWindow=true`** | ✓ YES | The handoff doc's daemon-restart snippet uses this |

The user's visible window is almost certainly a leftover from this session's troubleshooting (Bash background spawn).

### Immediate fix (no code)

Close the window. The daemon dies. The next memory-relevant prompt fires the hook → hook spawns a fresh daemon with `windowsHide: true` → invisible.

- First prompt after closing: ~5-35 s slower (cold-load embedding model from pagecache)
- All subsequent prompts: normal ~1-2 s warm latency, no visible window

If the user wants to be tidy without waiting on a real prompt:
```powershell
# Identify the canonical daemon PID:
Get-Content "$env:TEMP/ccv3-embedding.json" | ConvertFrom-Json | Select-Object pid
# Close the window OR kill that PID:
Stop-Process -Id <pid> -Force
# Then trigger a hook fire by typing any memory-relevant prompt
```

### Durable code fix (recommended — 5-line change)

Make the daemon **hide its own console** on startup so the spawn path no longer matters. Add to `opc/scripts/core/embedding_daemon.py` early in `_run_daemon` (before the model load):

```python
import sys

def _hide_own_console_on_windows():
    """Hide the daemon's console window on Windows so it doesn't clutter the
    taskbar regardless of who spawned us. No-op on POSIX. Fail-open if the
    Win32 API call doesn't work (e.g., daemon launched without a console)."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE
    except Exception:
        pass  # don't break the daemon over a UX nicety

# Call at top of _run_daemon, before any model load:
def _run_daemon(...):
    _hide_own_console_on_windows()
    # ... existing code ...
```

Mirror the same change in `opc/scripts/core/rerank.py` for the reranker daemon (also user-facing under `--daemon`).

### Acceptance criteria

- [ ] `_hide_own_console_on_windows()` added to both `embedding_daemon.py` and `rerank.py`
- [ ] Manual test: spawn from a fresh Bash terminal — daemon starts, console window vanishes within ~1s
- [ ] Hook-spawned daemons continue to work (no regression — they were already invisible)
- [ ] No effect on POSIX (the function early-returns)

### Effort: XS (~15-20 min including test)

### Why not just rely on the existing hook-side `windowsHide`?

Two reasons:
1. **Task Scheduler pre-warm** (commit `d47b970`) runs outside the hook path and may show a window depending on how the task is registered.
2. **Manual restarts** during debugging (the source of today's leftover) won't go through the hook. Self-hide on the daemon side is universal protection.

---

## Item 3 — Storage growth / pgvector latency at scale

### Background

Current corpus: ~620 rows after the 2026-05-21 backfill (245 PROJECT + 376 GLOBAL). The audit ran against this scale and got p95 recall latency 1958 ms warm.

Index: `idx_archival_embedding_hnsw hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64')`. HNSW (Hierarchical Navigable Small World) scales much better than IVFFlat at large N — typically sub-linear query time up to ~millions of vectors.

But:
- Never measured at 5,000 / 10,000 / 50,000 rows
- ef_construction=64 is moderate; may need to bump for large indexes
- pg_trgm + FTS index sizes also grow linearly with content length
- Daemon-side embed serialization (`_EMBED_CALL_LOCK`) doesn't change with corpus size, but multi-session contention does

### Recommended approach

**Option A: Synthetic scale test (preferred for HIGH confidence)**

1. Generate 5,000 synthetic learnings — vary length 200-2000 chars, mix scope project/global, distribute across the 6 learning types.
2. Bulk-insert (use `COPY ... FROM STDIN` for speed; or `store_learning.py` in a tight loop if you want the L0 gate exercised).
3. Run the 42-pair eval (`opc/scripts/core/eval_recall.py --eval-set tests/recall_eval_set.jsonl`) and compare NDCG + latency to today's baseline.
4. Repeat at 10,000 and 50,000.
5. Look for:
   - p95 latency cliff (if it jumps from ~50ms DB to >500ms, that's HNSW saturating)
   - NDCG degradation (precision drops as the embedding space densifies)
   - Daemon memory pressure (more candidate vectors retrieved per query)

**Option B: Real-growth monitoring (lower confidence, lower effort)**

1. Add a `/memory-stats --schema` mode that reports: total rows, GB on disk, p50/p95 query times, dedup rate.
2. Run weekly. Flag when total rows crosses 2,000 / 5,000 / 10,000.
3. At each threshold, re-run the eval and decide if an index tune (ef_construction, m parameter) is needed.

Recommend **Option A** if you're going to add many projects with auto-extraction enabled. **Option B** if growth will be slow.

### Acceptance criteria

- [ ] Baseline established: NDCG + latency at current 620 rows
- [ ] Documented thresholds: at what N does p95 exceed 100ms? 500ms?
- [ ] Index tuning playbook in `docs/memory-system-audit-followup-2026-05-21.md` for when thresholds are hit
- [ ] `/memory-stats` extended with corpus size + growth rate (optional but useful)

### Files / commands to know

- `opc/scripts/core/eval_recall.py` — 42-pair eval (already validated, just re-run at scale)
- `opc/tests/recall_eval_set.jsonl` — eval set
- Schema: `opc/docker/init-schema.sql` (HNSW index definition)
- pgvector tuning docs: https://github.com/pgvector/pgvector#hnsw

### Effort: S-M (~1-2 hr for Option B baseline; ~4-6 hr for Option A full scale test)

---

## Open questions for the user

Before starting any of these:

1. **Item 1 — corpus cleanup approach:** Run `/memory-curate` as-designed (interactive, scoring-driven), OR write a one-shot bulk-supersede script that targets specific noise patterns? The skill might not exist or be untested at scale — check `.claude/skills/memory-curate/SKILL.md` first.

2. **Item 2 BLOCKERs — fix order:** BLOCKER-2 (host-RAM) has historical evidence of firing; BLOCKER-1 (race) has narrow theoretical risk. Suggest: BLOCKER-2 first (highest impact). User may have a preference.

3. **Item 3 — scale test:** Synthetic test now (~4-6 hr) or real-growth monitoring (~1 hr + future revisits)? Depends on whether the corpus is expected to grow fast.

4. **Cross-cut: any interest in a `/memory-health` skill?** Combines: free-RAM probe + daemon liveness + jsonl hit rate + corpus size + dedup rate. Would be a useful weekly check; would also be where the host-RAM probe code lands naturally.

---

## How to resume in a fresh session

1. **`cd C:\Users\david.hayes\continuous-claude`**
2. **Read this doc + `docs/memory-system-audit-followup-2026-05-21.md`** — together they're the complete state.
3. **Quick state check:**
   ```bash
   git log --oneline -5   # expect 48a2157 at HEAD
   docker ps --filter name=continuous-claude-postgres   # expect Up
   docker exec continuous-claude-postgres psql -U claude -d continuous_claude -c \
     "SELECT scope, count(*) FROM archival_memory GROUP BY scope;"
   # Expect: GLOBAL ~376, PROJECT ~245
   ```
4. **Pick an item from the priority queue above** and run the recommended approach.
5. **No new memory regressions expected** — system is at HEAD-stable. The 3 items in this doc are incremental improvements, not bug fixes.

---

## Critical operational notes (carry-forward from prior handoffs)

- **`git push fork main`** — never `origin`. (`origin` = parcadei upstream; we push to `Rev4nchist` fork.)
- **Don't mass-kill `python.exe` processes** — kill orphans by single targeted PID after checking against the discovery file.
- **Don't run `npm test`** — could bypass the spawn mock in `embedding-client.test.ts` and re-trigger the daemon-cascade. Run individual vitest files instead.
- **The supervisor + worker python.exe pair is normal** — Python's `--daemon` flag double-forks. Don't try to "fix" two PIDs at the same creation time.
- **Free RAM is the #1 first-move diagnostic** — if recall slows, check host RAM before touching code. The 2026-05-20 incident burned hours because we didn't look there first.

---

## Closing note

The memory system is at a **good stopping point**. The hot path works, the audit caught the worst issues, the P0 fixes landed, the L0 gate is now stricter, and the cross-project/concurrent paths are verified. The three items in this doc are real but unhurried — none has a clock on it. Pick them up as bandwidth allows; the system will keep working in the meantime.
