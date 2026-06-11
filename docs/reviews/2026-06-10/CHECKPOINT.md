# Deep-Review Checkpoint (2026-06-10, after WF-1 completion run #2)

**State:** WF-0 complete (committed 8723034). WF-1 run #1: 15/29 dims, 147 findings (committed d643eaa). WF-1 run #2 (wc46k5ue0, 21 agents, 6.4M tokens, ~161 min): +5 dims (D6a, D6b, D7a, D7c, D10b) + 3 completeness critics (CRITICS.json) + gap-fill GAP1-GAP4 — **9 agents died on transient server-side rate limiting** (not spend limit). Disk tally: **25 dimension files, 196 findings — S0: 4, S1: 60, S2: 92, S3: 36** (+4 unset from gap entries).
**Review SHA:** 86b8f60 (post-merge main; PRs #8/#9/#10 merged). Telemetry snapshot + exclusion manifest + seeds in harvest/.

## Still missing (9 — rate-limited, re-run as smaller low-concurrency workflow)
D5b security:injection-surfaces · D7b lean:skills · D7d lean:scripts+duplication · D8a drift:rules-vs-code · D8b drift:docs-vs-code · D8c drift:skills-vs-behavior · D9 telemetry:interpretation · D10a trace:prompt-journey · D10c trace:agent-spawn-journey
Coverage note: D8 (all 3 readers) and D9 are entirely missing — their coverage manifests CANNOT be marked complete until re-run. D5b partially overlaps WF-3's mandatory Codex security pass but should still run.

## Resume
1. Re-run the 9 missing agents as a NEW workflow at LOW concurrency (~4-5) — rate-limit pressure was the killer. Briefs in the saved workflow scripts (session workflow dir; see WF1-STATE.json).
2. WF-2 adversarial verification over ALL findings on disk (content-match at SHA 86b8f60; S0/S1 split → KEEP-AND-FLAG arbitration; reachability on every CONFIRM). [GATE G-B]
3. WF-3 synthesis + 2 mandatory codex passes → report + backlog → G-C ratification → Phase 4 quick wins via /ralph.

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
