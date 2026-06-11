# Deep-Review Checkpoint (2026-06-10, WF-1 COMPLETE)

**State:** WF-0 complete (8723034). **WF-1 COMPLETE across 3 runs:** run #1 15 dims/147 findings (d643eaa, spend limit); run #2 +5 dims + critics + gap-fills (rate-limited); run #3 (wlvqd3qxz, 3 sequential batches of 3) finished the last 9 dims — 9/9, 2.9M tokens, ~3h49m. **Final tally: 33 dimension files (29 dims + 4 gap-fills), 248 findings — S0: 4, S1: 75, S2: 125, S3: 44.** Critics confirm all 111 hook srcs have verdict lines.
**Review SHA:** 86b8f60 (post-merge main; PRs #8/#9/#10 merged). Telemetry snapshot + exclusion manifest + seeds in harvest/. Post-freeze commits touch only review artifacts + the settings.json deregistration (eae979e) — source files unchanged; refuters needing the frozen bytes use `git show 86b8f60:<file>`.

## Next
1. **WF-2 adversarial verification** (launching): mechanical exclusion pre-kill + dedup_keys clustering orchestrator-side → batches ≤8 under wf2/batches/ → S0/S1 dual oppositional refuters (split → KEEP-AND-FLAG → arbitrator must cite counter-evidence) · S2/S3 single ops-realist → reachability evidence on every CONFIRM → verdicts to wf2/WF2-VERDICTS.json → **tiered ledger → GATE G-B**.
2. WF-3 synthesis + 2 mandatory codex passes → report + backlog → G-C ratification → Phase 4 quick wins via /ralph.

## Interim actions taken (user-authorized carve-outs)
- **D2a-01 MITIGATED (2026-06-10, commit eae979e):** navigator-safety hook DEREGISTERED from repo + active settings.json after spot verification (PreToolUse 'allow' on destructive Bash = auto-approve + prompt suppression). Source retained for Phase 4 rewrite (allow→ask or PostToolUse additionalContext). Details: findings/INTERIM-ACTIONS.md.

## Immediate flags (single-reader findings pending WF-2 verification)
- D5a-01: junk-creator NAMED — agent-error-capture.ts shells out store_learning with unsanitized agent error output.
- D2d-01: roadmap contamination root cause — guard is a registered-projects allowlist; unregistered foreign projects invisible.
- D2b-05: smart-search-router writes to POSIX /tmp → C:\tmp grows unbounded since January.
- D2b-01: 5 hooks registered under matcher Agent while the live tool matches Task (dead routing).
- D2b-03: agent-recall-injector 0-for-78 lifetime memory yield.
- NEW D6a-01 (S1): UserPromptSubmit hot path serializes 13 process spawns — ~22-32s worst-case before any prompt is answered.
- NEW D6a-04 (S1): user-confirmation-detector can run a synchronous 60s-timeout execSync store_learning INSIDE the prompt hot path when the user says "fixed"/"it works".
