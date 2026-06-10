# Deep-Review Checkpoint (2026-06-10, spend-limit interrupt)

**State:** WF-0 complete (committed 8723034). WF-1 PARTIAL: 15/29 dimensions done -> 147 findings salvaged to findings/ (committed d643eaa). Monthly spend limit halted: D5b, D6a/b, D7a-d, D8a-c, D9, D10a-c, 3 critics, gap-fill.
**Review SHA:** 86b8f60 (post-merge main; PRs #8/#9/#10 merged). Telemetry snapshot + exclusion manifest + seeds in harvest/.

## Resume (when budget returns)
1. Re-run the 14 failed dimensions as a NEW workflow — briefs are in the saved script (see WF1-STATE.json) — then critics + gap-fill.
2. WF-2 adversarial verification over ALL findings (content-match at SHA 86b8f60; S0/S1 split -> KEEP-AND-FLAG arbitration; reachability on every CONFIRM).
3. WF-3 synthesis + 2 mandatory codex passes -> report + backlog -> G-C ratification -> Phase 4 quick wins via /ralph.

## Immediate flags (unverified single-reader findings, but evidence-cited)
- D2a-01: navigator-safety AUTO-APPROVES destructive Bash (rm -rf, git push --force, DROP TABLE) — permission-prompt bypass. Consider deregistering the hook NOW (settings.json, Node atomic write) ahead of the fix arc.
- D5a-01: junk-creator NAMED — agent-error-capture.ts shells out store_learning with unsanitized agent error output.
- D2d-01: roadmap contamination root cause — guard is a registered-projects allowlist; unregistered foreign projects invisible.
- D2b-05: smart-search-router writes to POSIX /tmp -> C:	mp grows unbounded since January.
- D2b-01: 5 hooks registered under matcher Agent while the live tool matches Task (dead routing).
- D2b-03: agent-recall-injector 0-for-78 lifetime memory yield.