# CCv3 Session 8 Kickoff — Post-Restart Full Daemon-System Test

**Purpose:** First session after a system restart. Goal: prove the embedding-daemon system auto-warms and rendezvous holds end-to-end *through the real reboot path* (scheduled task → launcher → daemon → recall), then move on to the P1 bus-bias lift question.

**Prereq before you start this session:** actually restart the machine (or at minimum log out and back in) so the `CCv3-Embedding-Daemon` scheduled task fires its at-logon trigger. The whole point is to test the cold-boot path, not an ad-hoc start.

---

## Paste this into the fresh session

```
Resume CCv3 after a system restart. FIRST read docs/ccv3-session8-kickoff-2026-06-04.md
in full, then docs/ccv3-session7-handoff-2026-06-04.md for background.

Context: last session fixed the embedding-daemon warmth bug (PR #7, merged to
fork/main @ 3a398236). Root cause was a Node-vs-Python TMPDIR/TEMP discovery-path
mismatch; fixed by anchoring discovery + locks to ~/.claude/run/. A scheduled task
CCv3-Embedding-Daemon (at-logon +30s) was registered but ONLY verified ad-hoc, never
through a real reboot. This session is the real-reboot acceptance test.

Do, in order:
1. Run the POST-RESTART DAEMON TEST PROTOCOL in the kickoff doc (8 checks). Report a
   PASS/FAIL table. The critical one: did the scheduled task auto-warm the daemon at
   ~/.claude/run/ccv3-embedding.json within ~60s of logon WITHOUT any manual start,
   and is there exactly ONE daemon (no husk herd)?
2. If any check FAILS, debug it (it's the P2 item: scheduled-task/job-object detach or
   launcher path). Check ~/.claude/logs/embedding-daemon-launcher.log first.
3. If all PASS, the daemon system is fully verified — record it, then start P1: the
   bus-bias lift investigation (warm gate gave +7.0%/flat-hit, not the documented
   +33.6%/63->88% — trace provenance, decide keep/tune/roll back).

Guardrails: push fork never origin; do NOT change BGE model/dim (1024); edit repo not
~/.claude/; cross-model /review for any concurrency/path code.
```

---

## POST-RESTART DAEMON TEST PROTOCOL (run these, build a PASS/FAIL table)

> Run from the repo root `C:\Users\david.hayes\continuous-claude`. `$CLAUDE_OPC_DIR` should already be set to `.../continuous-claude/opc`.

### Check 1 — Scheduled task fired at logon
```powershell
Get-ScheduledTaskInfo -TaskName 'CCv3-Embedding-Daemon' | Select-Object LastRunTime, LastTaskResult, NextRunTime
```
You should see: a `LastRunTime` shortly after this logon, `LastTaskResult` = `0` (success). If `LastRunTime` is old / result non-zero → the task didn't fire or the launcher errored → go to Check 8 (the log).

### Check 2 — Launcher log shows a fresh managed start (NOT ad-hoc)
```powershell
Get-Content (Join-Path (Join-Path $HOME '.claude') 'logs\embedding-daemon-launcher.log') -Tail 6
```
You should see: a `[<today's date/time>] Spawning embedding daemon ...` line dated to this logon, then a `Daemon spawned (pid=...) - will be ready when C:\Users\david.hayes\.claude\run\ccv3-embedding.json appears.` line. This proves the PS 5.1-compatible launcher actually ran (the bug last session was it crashed before logging).

### Check 3 — Discovery file is at the CANONICAL path (within ~60s of logon)
```powershell
Get-Content (Join-Path (Join-Path (Join-Path $HOME '.claude') 'run') 'ccv3-embedding.json') -Raw
```
You should see: `{"pid": <n>, "port": <n>, "started_at": <epoch>, "model": "BAAI/bge-large-en-v1.5", "dim": 1024}`. If absent after ~60s, the daemon is still loading the model — wait and re-check. If still absent after ~2 min → FAIL (Check 8).

### Check 4 — Daemon process has the MODEL loaded (not a husk)
```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like '*embedding_daemon*' } | Select-Object ProcessId, @{N='MB';E={[int]($_.WorkingSetSize/1MB)}}
```
You should see: exactly the daemon process(es) and the model-loaded one at **~1200-1600 MB**. A process stuck at <40 MB = husk (model never loaded) → FAIL.

### Check 5 — EXACTLY ONE warm daemon (no thundering herd)
The discovery-file pid (Check 3) should match the ~1500 MB process (Check 4). There may be a transient small `uv`/re-exec helper, but there must be only ONE model-loaded daemon. Multiple ~1500 MB daemons = herd regression → FAIL.

### Check 6 — Warm recall through the real code path (the money check)
```
cd "$CLAUDE_OPC_DIR" && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "context bus" --k 2 --json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(d._meta)'
```
You should see: `embed_used_daemon: true` and `embed_elapsed_ms` ~30-300 ms. `embed_used_daemon:false` or `embed_elapsed_ms` in the thousands = the rendezvous failed across the reboot → FAIL (this is the regression we're guarding against).

### Check 7 — Hybrid quality gate reports WARM
```
node scripts/bus-quality-gate.mjs hybrid
```
You should see: `embedding daemon: WARM`, `READ-ONLY ASSERTION ... PASS`, exit 0. (Note: the bias-lift numbers themselves are the P1 question — for THIS check you only care that it says WARM and passes the read-only assertion.)

### Check 8 — (only if something failed) Daemon test suite + log triage
```
cd "$CLAUDE_OPC_DIR" && PYTHONPATH=. uv run pytest tests/unit/test_embedding_daemon_paths.py tests/unit/test_embedding_daemon_guard.py tests/unit/test_embedding_daemon_lock.py -q
```
All 21 should pass. Then read the launcher log (Check 2 path, full) and check whether the `uv run` child outlived the task's `powershell.exe` (the Codex job-object-detach concern). If the daemon dies right after the launcher exits, the spawn in `scripts/start-embedding-daemon.ps1` needs a true-detach flag.

---

## Expected result table (fill this in)

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1 | Task fired at logon | LastTaskResult=0, recent LastRunTime | |
| 2 | Launcher log fresh | "Spawning..." + "Daemon spawned" today | |
| 3 | Discovery at `~/.claude/run/` | valid JSON, model bge-large, dim 1024 | |
| 4 | Model loaded | one process ~1200-1600 MB | |
| 5 | Single daemon | discovery pid == the 1500MB pid, no herd | |
| 6 | Warm recall | `embed_used_daemon:true`, low ms | |
| 7 | Gate WARM | "embedding daemon: WARM", READ-ONLY PASS | |
| 8 | Tests (if needed) | 21 passed | |

**If 1-7 PASS:** the daemon system is fully verified end-to-end through a real reboot. Record it (a one-line memory or a note in the ROADMAP), close the P2 reboot-verify item, then start P1.

**If any FAIL:** that's the P2 work — debug before P1. Most likely failure modes and where to look are in `docs/ccv3-session7-handoff-2026-06-04.md` (P2 section) and the launcher log.

---

## After the daemon test: P1 — Bus-bias lift investigation

The warm hybrid gate (`node scripts/bus-quality-gate.mjs hybrid`) gave **+7.0% top-score / FLAT 69%→69% hit-rate**, far below the documented **+33.6% / 63→88%** (from PR #5). Verdict held KEEP ENABLED, but the bias benefit is modest. Investigate:
- **Trace the +33.6% provenance** — it's cited in `docs/ccv3-ws2-phaseB-plan-2026-06-02.md` and PR #5. Was it measured on a different/smaller corpus, a different case set, or cold-but-mislabeled?
- **Corpus drift** — was 569-574 rows, now 576. Probably not the whole story.
- **Case set** — the 13 cases in `scripts/bus-quality-gate.mjs` (8 `repr` + 5 `STRG`) may differ from the +33.6% run.
- **Decision:** keep / tune the focus-term weighting / roll back the bus-bias. This is a quality call, independent of the now-solid daemon warmth.

---

## Quick reference

| Thing | Value |
|-------|-------|
| Branch / HEAD | `main` @ `a0fdcd3` (post-merge), on `fork/main` |
| Daemon fix PR | #7, merged `3a398236` |
| Canonical paths | discovery `~/.claude/run/ccv3-embedding.json`; locks `ccv3-embedding-daemon.lock` (Py), `ccv3-embedding-spawn.lock` (Node), same dir |
| Scheduled task | `CCv3-Embedding-Daemon`, at-logon +30s, Limited |
| Launcher log | `~/.claude/logs/embedding-daemon-launcher.log` |
| Daemon source | `opc/scripts/core/embedding_daemon.py` (`_canonical_run_dir`) |
| Client | `.claude/hooks/src/shared/embedding-client.ts` (`RUN_DIR`) |
| Launcher / installer | `scripts/start-embedding-daemon.ps1`, `scripts/install-embedding-daemon-task.ps1` |
| Prior handoff | `docs/ccv3-session7-handoff-2026-06-04.md` |
| Root-cause memory | archival_memory id `966936ef` |
| Guardrails | push `fork` not `origin`; don't change BGE model/dim (1024); edit repo not `~/.claude/`; cross-model `/review` for concurrency/path code |

**Uninstall the task** (if ever needed): `pwsh -File scripts/uninstall-embedding-daemon-task.ps1` or `schtasks /delete /tn "CCv3-Embedding-Daemon" /f`.
