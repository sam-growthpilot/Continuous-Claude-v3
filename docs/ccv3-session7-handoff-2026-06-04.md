# CCv3 Session 7 Handoff — Embedding-Daemon Fix Shipped; Bus-Bias Lift Is the Open Question

**Date:** 2026-06-04
**Branch:** `main` @ `3a398236` (PR #7 merged into `fork/main`)
**Outcome:** SUCCEEDED — daemon warmth root-caused + fixed + merged. One substantive open question (bus-bias lift) + carried ops follow-ups.

---

## TL;DR for the next session

The intermittent "memory not warmed → slow recall" daemon bug is **fixed and merged** (PR #7). The daemon now warms reliably (~200 ms vs 25–166 s cold) and persists across reboots via a scheduled task. **The one thing that needs a fresh decision: the bus-bias hybrid-recall lift did NOT reproduce its documented numbers when measured warm — it's +7.0% top-score / flat hit-rate, not the +33.6% / 63→88% the prior docs claim.** That's the highest-value next investigation.

---

## What shipped this session (PR #7, `3a398236`)

**Root cause (not the handoff's prediction).** The SESSION-6 handoff guessed a ping/threading/timeout bug. All of that was already correct. The real bug was a **Node-vs-Python discovery-path rendezvous mismatch**:

- `embedding_daemon.py` used Python `tempfile.gettempdir()` → honors `TMPDIR` (Claude session sets `TMPDIR=...\Temp\claude`).
- `embedding-client.ts` (the hook spawner) used Node `os.tmpdir()` → honors `TEMP` (`...\Temp`), **ignores `TMPDIR`**.
- They read/wrote **different** discovery + lock files. The hook spawner never saw the daemon it started → re-spawned endlessly (thundering herd of modelless husk daemons). Recall fell back to a 25–166 s cold in-process embed depending on which side of the split it landed.
- Bonus bug: `start-embedding-daemon.ps1` had a 3/5-arg `Join-Path` that **crashes on Windows PowerShell 5.1** (the scheduled-task shell) — which is why the managed launcher never ran and the daemon was only ever started ad-hoc by hooks.

**The fix.** Anchored discovery + both lock files to an environment-independent path **`~/.claude/run/`** — Node `os.homedir()`, Python `Path.home()`, PowerShell `$HOME` all resolve to `USERPROFILE` identically on Windows (verified: all four agree). Files changed:
- `opc/scripts/core/embedding_daemon.py` — `_canonical_run_dir()`; `DAEMON_INFO_PATH` + `DAEMON_LOCK_PATH` under `~/.claude/run/`.
- `.claude/hooks/src/shared/embedding-client.ts` — `RUN_DIR` via `homedir()`; `mkdir` before spawn-lock; also fixed an `embedText` double-timer (2×timeout → single).
- `scripts/bus-quality-gate.mjs` — `daemonWarm()` probes the canonical path.
- `scripts/start-embedding-daemon.ps1` — PS 5.1 `Join-Path` fix; `{"op"}`→`{"cmd"}`; require `ok:true`; `$stream.ReadTimeout`; partial-header logging.
- `scripts/install/uninstall-embedding-daemon-task.ps1` — canonical path; scheduled task `CCv3-Embedding-Daemon`.
- `opc/tests/unit/test_embedding_daemon_paths.py` — NEW regression test locking in env-independence.
- B.4b flipped `deferred → DONE` in `docs/ccv3-ws2-phaseB-plan-2026-06-02.md` (was already merged in PR #6).

**Verification done:** 21 pytest green; `tsc` clean; emit audit 4/4; scheduled task registered (State: Ready); hybrid gate WARM + KEEP ENABLED + READ-ONLY PASS (576→576, 0 writes); cross-model `/review` (critic + codex-adversary) — both findings (embedText double-timer, PS1 read-timeout) fixed; `/premortem` run pre-implementation.

**Memory:** root cause stored as learning `966936ef`.

---

## Current system state (verified)

| Thing | State |
|-------|-------|
| Branch | `main` @ `3a398236` (in sync with `fork/main`) |
| Daemon | warm, pid was 352152, port 59534, model BAAI/bge-large-en-v1.5, ~1528 MB. Discovery at `~/.claude/run/ccv3-embedding.json`. |
| Scheduled task | `CCv3-Embedding-Daemon` registered, at-logon +30 s, run level Limited |
| Warm recall | `embed_used_daemon:true`, ~200 ms (was 25,544 ms cold) |
| Docker postgres | up; `archival_memory` 576 rows |
| Pre-existing uncommitted (NOT mine) | `ROADMAP.md`, `opc/scripts/core/store_learning.py`, plus untracked docs/dirs — left untouched all session |

**Reproduce / health one-liner** (from `$CLAUDE_OPC_DIR`):
```
PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "context bus" --k 2 --json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(d._meta)'
```
Want: `embed_used_daemon:true`, low `embed_elapsed_ms`.

---

## Next session — prioritized

### P1 — Bus-bias lift investigation (the real open question)
The warm hybrid quality gate (`node scripts/bus-quality-gate.mjs hybrid`) reported **+7.0% mean top-score and FLAT hit-rate (69%→69%)** — the verdict held at KEEP ENABLED (no rollback threshold tripped), but this is far below the documented **+33.6% top-score / 63→88% hit-rate** from PR #5. Possible explanations to chase:
- **Corpus drift** — the lift was measured at 569–574 rows; now 576. Small, probably not the cause alone.
- **Case set** — the 13 cases in `bus-quality-gate.mjs` (8 `repr` + 5 `STRG`) may not match whatever was measured for +33.6%.
- **The original baseline run state is unverified** — it may have been measured cold-but-mislabeled, or on a different case set, or pre-some-change. The +33.6% number lives in `docs/ccv3-ws2-phaseB-plan-2026-06-02.md` and PR #5; trace its provenance.
- **Decision to make:** is the bus-bias feature earning its keep? Keep / tune the focus-term weighting / roll back. This is a quality question, separate from the daemon warmth fix that's now solid.
- Recorded honestly in `docs/ccv3-ws2-phaseB-plan-2026-06-02.md` follow-up (3).

### P2 — Verify daemon survives a REAL reboot (quick, do after next restart)
The scheduled task is registered but only verified ad-hoc (I started the daemon manually; it survived the launcher process exit). Codex flagged a Windows job-object detach concern. **After the next reboot**, confirm `~/.claude/run/ccv3-embedding.json` appears within ~60 s and a recall is warm. If it doesn't: check `~/.claude/logs/embedding-daemon-launcher.log` and whether the spawned `uv run` child outlives the task's `powershell.exe`.

### P2 — Ops: full `vitest run` hangs (carried)
Full parallel `vitest run` hangs on a pre-existing Windows daemon/socket suite (unrelated to embedding). Use the relevant subset meanwhile. Candidate fix: a hard per-test timeout on that suite.

### P3 — Ops: post-commit forward-sync race (carried)
Async post-commit sync (repo → `~/.claude/`) races; the active hook `dist/*.mjs` can be stale right after a hook commit. Until fixed, after any hook `.ts` commit: rebuild, `sha256sum` repo-vs-active, `cp` if stale, run `bash scripts/audit-braintrust-emits.sh` (expect 4/4). I followed this ritual all session.

### Larger arc — WS-2 Phase B activation (when ready)
Phase B shipped **INERT**: the `/code-intel` facade is a manual CLI; the enforcer is default-OFF, warn-only. Future work (E1 elephant): actual routing-through-the-facade payoff + enforcement teeth → then Phase C (codegraph) → D (memory bridge, needs a GIN index) → E (observability). See `docs/ccv3-ws2-phaseB-plan-2026-06-02.md` and the v3 design `~/.claude/plans/we-have-recently-done-refactored-storm.md`.

---

## Guardrails (unchanged, still apply)
- **Do NOT change the BGE model or dim** — `archival_memory` is bound to 1024-dim.
- **Push `fork` (Rev4nchist), never `origin` (parcadei).**
- **Edit repo files, not `~/.claude/`** (forward-sync is the only auto direction). The pre-commit build-forget guard blocks staging a hook `.ts` without the rebuilt `.mjs`; legitimate `SKIP_BUILD_GUARD=1` only when `git diff HEAD` on dist is genuinely empty (comment-only change).
- **Cross-model `/review` + `/premortem`** for concurrency/socket/path code — both paid off this session.

## Key references
- This PR: https://github.com/Rev4nchist/Continuous-Claude-v3/pull/7 (merged `3a398236`)
- Prior handoff: `docs/ccv3-ws2-phaseB-SESSION6-HANDOFF-2026-06-04.md` (note: its daemon root-cause theory was WRONG — see above; its `$TEMP` path references are pre-fix historical)
- Phase B plan + warm-gate caveat: `docs/ccv3-ws2-phaseB-plan-2026-06-02.md`
- Root-cause learning: archival_memory id `966936ef`
