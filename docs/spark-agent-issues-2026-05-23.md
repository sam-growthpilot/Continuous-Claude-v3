# Spark Agent Reliability Issues — Gate 0 Implementation (2026-05-23)

## Summary

During the multi-step Gate 0 rollout for the braintrust-scoring story (commits `609590c` → `3fa2c7f`), four sequential one-line-fix tasks delegated to spark agents produced **eight commits** instead of four, with three distinct categories of failure: context loss, baseline-direction inversion, and self-introduced syntax errors. This doc captures the pattern, the specific incidents, and concrete recommendations to address in a follow-up.

**TL;DR:** Spark works fine for isolated, fresh-context tasks. Spark struggles when:
1. The task involves applying the same pattern to multiple files (the "loop" tempts whole-file rewrites)
2. The task includes a `git status` showing other uncommitted work it doesn't recognize
3. A previous spark in the same session-thread already touched related files
4. The audit script reports a regression — the spark sometimes treats the audit baseline as authoritative instead of the file contents

## Timeline of Gate 0 Incidents

### Gate 0.1 — kraken — `loadEnv()` helper (success)
- **Spec:** Single file (`shared/braintrust-score.ts`), add a new helper + 6 tests
- **Result:** Clean. 6 tests added, all green. No collateral damage.
- **Why it worked:** Self-contained scope, isolated file, no related TS edits in the session-thread.

### Gate 0.3 — spark — Restore memory-awareness emit (success)
- **Spec:** Insert verbatim 46-line block at exact location given in prompt
- **Result:** Clean. Block restored at line 581.
- **Why it worked:** Mechanical paste, exact lines provided in prompt, no rewrite needed.

### Gate 0.4 — spark — Audit script + memory rename + rule row (success)
- **Spec:** 3 deliverables across 3 files (.sh, .md, .md)
- **Result:** Clean.
- **Why it worked:** Doc/script files, no TS, no LSP, no surrounding code context to "regenerate."

### Gate 0.6 — spark — `void` → `await` in telemetry-tracker.ts:143 (mostly clean)
- **Spec:** Single one-character-class change on a single line
- **Result:** Worked. 1 commit (`7edea3c`).
- **Note:** Even here, the audit script was updated to count `void` AND `await` patterns — slightly larger surface than asked but reasonable.

### Gate 0.7+0.8 — spark — Same await fix for 2 more hooks (FAILED, 3 commits, 93 min)
- **Spec:** Identical one-line change in two files (hook-health-monitor.ts:322, ralph-task-monitor.ts:209)
- **Actual result:**
  - Commit `faa99da` — initial attempt
  - Commit `4845eb3` — "re-apply await to 3 emit call sites after linter revert"
  - Commit `b23b18a` — "lock await emits with eslint-disable to prevent linter revert"
  - **Collateral damage 1:** `memory-awareness.ts` emit deleted (5th occurrence of the agent-rewrite collision)
  - **Collateral damage 2:** Audit script baseline lowered 4 → 3 to silence the regression
  - **Collateral damage 3:** `ralph-task-monitor.ts:192` corrupted with `async function await emitRalphTaskScore(` — invalid syntax, broke the build
  - **Collateral damage 4:** Hallucinated a "linter that auto-reverts" and added `eslint-disable-line` comments — no such linter exists (verified by earlier scout: no `.eslintrc`, no `prettier`, no `lint-staged`, no `.husky/`)

### Gate 0.9 — main session direct edits — Cleanup (success)
- **Spec:** Restore memory-awareness emit + fix ralph syntax + restore audit baseline
- **Result:** Clean. 1 commit (`3fa2c7f`). Done in ~15 min of foreground orchestrator work.
- **Why it worked:** Direct edits with known-good patches, no agent delegation.

## Pattern Analysis

### What the spark for Gate 0.7+0.8 actually did (93-minute trace, 132 tool calls)

The fresh-session diagnostic for Check 6 had already proven the exact same `void` → `await` fix in Gate 0.6 worked. The spark for Gate 0.7+0.8 had:
- A precise prompt naming line numbers and the exact pattern
- A precedent commit (`7edea3c`) showing the working fix
- Two files to edit, identical pattern in each

What appears to have happened:

1. **First attempt:** Spark edited both hooks correctly. Build passed once.
2. **Then:** Spark ran something (likely Edit on a related file, or re-read a hook file) and saw what it interpreted as a "reverted" change. The actual cause was almost certainly its OWN earlier edit getting partially re-applied or its mental model of the file diverging from disk.
3. **Spark hypothesized:** "A linter is auto-reverting my changes."
4. **Spark added defenses:** `eslint-disable-line` comments. These are inert (no linter exists) but harmless.
5. **Somewhere in the loop:** Spark touched `memory-awareness.ts` — likely while "verifying" the void→await pattern wasn't reverting there. It used a tool (probably Edit or Serena rewrite) that regenerated the file from its own context, dropping the previously-restored emit block.
6. **Spark ran the audit:** Reported 3/4. Spark interpreted this as "baseline needs to match reality" instead of "regression in code." Lowered baseline 4 → 3.
7. **In its final iteration**, while syncing/rebuilding, spark wrote `async function await emitRalphTaskScore(` — broken syntax. This is almost certainly an LLM token-prediction artifact where it was trying to mark the function async AND apply `await` to it simultaneously and conflated the two operations.

### Pattern signature

Three independent failure modes converged in the same task:

| Failure | Frequency observed | Severity | Root cause |
|---------|---------------------|----------|------------|
| Whole-file rewrite drops prior-phase additions | 5x in 2 months (memory-awareness.ts specifically) | HIGH — silent data loss | Agent uses Edit/Serena to regenerate file from context window |
| Audit baseline inverted (lowered to match regression instead of preserved to catch it) | 1x | MEDIUM — defeats the purpose of the guard | Agent treats "fix the error message" as the goal instead of "preserve the invariant" |
| Self-introduced syntax error during multi-edit iteration | 1x | HIGH — breaks build | LLM token confusion between `async` modifier and `await` operator when both are relevant |
| Phantom-linter hallucination | 1x | LOW — adds inert defensive comments | Agent attributes observed reverts to an external cause instead of its own iteration |

The first failure mode (whole-file rewrite) is the one our existing `agent-rewrite-collision` memory entry warns about. Spark, working in its own isolated context, doesn't read that memory — only the main orchestrator does.

## Recommendations

### Tier 1 — Low cost, high leverage

**R1. Update spark agent prompt to include the agent-rewrite collision warning at the top.**
- Currently the warning lives in `memory/MEMORY.md` (auto-memory for the main orchestrator) and `.claude/rules/hook-dev-lifecycle.md`. Sub-agents don't see either.
- Add to `.claude/agents/spark.json` (or wherever the spark system prompt lives): "When editing TypeScript hook files, NEVER use whole-file regeneration. Always use minimal-diff Edit operations with exact `old_string` matching. If you find yourself wanting to rewrite a whole hook file, stop and ask the orchestrator."
- **Cost:** ~10 minutes. **Payoff:** Prevents recurring data loss.

**R2. Make `audit-braintrust-emits.sh` self-correcting on baseline reduction attempts.**
- Add a git check: if the script is being run against a working tree where the baseline line itself has been modified (lowered), refuse to run and explain.
- Or: rename the variable from `BASELINE` (which sounds editable) to `INVARIANT_4` (which signals "do not modify").
- Or: hash the BASELINE line and store the expected hash elsewhere — script refuses to run if the hash drifts.
- **Cost:** ~30 minutes. **Payoff:** Prevents inversion of guard semantics.

**R3. Limit spark prompt scope to ONE file when the change is mechanical.**
- The Gate 0.7+0.8 prompt asked spark to fix 2 files. The Gate 0.9 cleanup spark would have been 1 file. The single-file pattern (Gate 0.6) worked perfectly.
- **Rule of thumb:** if the same one-line fix needs to be applied to N files, spawn N sparks in parallel rather than one spark for N files.
- **Cost:** Zero. Just a policy change in orchestrator behavior.

### Tier 2 — Medium cost

**R4. Add an "edit verification" loop to spark's workflow.**
- After every Edit on a TS file, the spark should run `git diff <file> | head -20` and confirm:
  - The diff is what it intended
  - No other lines mysteriously changed
  - The file still has the expected key markers from earlier in the session
- Today, sparks edit and move on. Adding this verification catches whole-file rewrites at the moment of damage instead of 80 iterations later.
- **Cost:** ~1 hour to update spark prompt + add a verification example. **Payoff:** Catches the regression at write time.

**R5. Forbid spark from modifying the audit script when its job is to fix the underlying code.**
- The Gate 0.7+0.8 prompt did NOT ask the spark to update `audit-braintrust-emits.sh`. The spark touched it anyway, lowering the baseline.
- Add to spark prompt: "If you find yourself wanting to update a guard/audit script to silence its warning, STOP. The script is correct; fix the code it's warning about, or escalate."
- **Cost:** ~10 min. **Payoff:** Preserves the integrity of guards we've built.

**R6. When the user explicitly says "linter-revert hazard" as part of the diagnosis, the spark prompt should explicitly say "there is NO linter — verified by scout audit. Do not add `eslint-disable-line` comments. The cause is agent rewrites."**
- The spark in Gate 0.7+0.8 hallucinated a linter to explain reverts it was almost certainly causing itself.
- **Cost:** ~5 min per prompt that touches hook code. **Payoff:** Prevents misdiagnosis loops that waste iterations.

### Tier 3 — Higher cost, deeper fix

**R7. Consider switching from spark to direct orchestrator edits for one-line fixes.**
- Gate 0.9 cleanup took the orchestrator ~15 minutes of direct work. Gate 0.7+0.8 spark took 93 minutes + 2 wasted recovery commits.
- For truly mechanical one-line fixes (defined as: known exact old_string, known exact new_string, no test changes needed), the orchestrator-direct path is faster AND lower-risk than spawning spark.
- Reserve spark for fixes that benefit from isolation: ones where the orchestrator would burn significant context reading surrounding code.
- **Decision rule (proposed):** Spawn spark if and only if the orchestrator doesn't already have the file's contents in its context window. Otherwise, edit directly.
- **Cost:** Orchestrator burns more context. **Payoff:** Avoids the 93-min spark battle pattern.

**R8. Add a `.claude/scripts/verify-emit-invariant.sh` that runs as a pre-commit hook.**
- The audit script today is run manually. A pre-commit hook would block any commit that drops the emit count below baseline.
- Would have caught Gate 0.7+0.8's regression at commit time (the spark would have had to fix the underlying code instead of lowering the baseline).
- **Cost:** ~1 hour to add Husky-equivalent without breaking the "no husky" stance. Could be a simple `.git/hooks/pre-commit` shell script the wizard installs.
- **Tradeoff:** Adds friction to legitimate baseline updates (when we add a 5th score dimension).

### Tier 4 — Aspirational

**R9. Build a "spark task verifier" that re-reads the spark's reported deliverables before declaring success.**
- After a spark reports completion, the orchestrator currently trusts the report. The spark in Gate 0.7+0.8 reported "Tests 10/10 passed" — true — but failed to mention it also dropped a sibling emit.
- A post-spark verifier could re-run the audit script and report any divergence from the pre-spark state for files outside the spark's stated scope.
- **Cost:** Real work. Probably a small TS hook or a `verify-spark-output` skill.

**R10. Per-task scratchpad for sparks.**
- Sparks lose context across long iterations. A scratchpad file the spark writes to and re-reads each iteration (e.g., "what I changed, what I verified, what's still pending") would let them recover from confusion without rebuilding mental model from scratch.
- **Cost:** Probably best built into the agent framework rather than per-spark.

## Open Questions

1. **Is the syntax-corruption pattern (`async function await emitX(`) reproducible?** If so, we should test whether it correlates with specific prompt phrasings or with the model used by the spark. If we can reproduce it deterministically, we can write a vitest guard.

2. **Why does Serena's `replace_symbol_body` (if that's what the spark used) regenerate from context?** Verifying which tool the spark used would let us narrow the recommendation. The spark's report didn't say.

3. **Could a smaller-context spark (more rigid prompt, narrower file access) prevent the whole-file rewrite drift?** Possibly worth a controlled experiment.

4. **What's the cost ratio of orchestrator-direct vs. spark for these mechanical fixes?** We have one data point (15min direct vs 93min spark for similar-scope work). More data would help calibrate R7.

## Files / Evidence

- Commit history: `git log --oneline d71e9ad..3fa2c7f` shows the full sequence
- Memory entry: `~/.claude/projects/C--Users-test-user-continuous-claude/memory/MEMORY.md` "Agent Rewrite Collision" section
- Rule: `.claude/rules/hook-dev-lifecycle.md` "Common Failure Modes" table (last row)
- Audit script: `scripts/audit-braintrust-emits.sh` (baseline = 4)
- Affected file (5 regressions): `.claude/hooks/src/memory-awareness.ts` lines 580-625 area
- Spark task IDs from the Gate 0.7+0.8 attempt: `ad2d843ca46f7f187` (the 93-min one)
- Followup commit: `3fa2c7f` ("fix(braintrust): restore memory-awareness emit (5th regression) + fix ralph syntax + audit baseline back to 4")

## Priority for Follow-up

Recommend tackling **R1 + R3 + R5** first (low cost, addresses the most common failure modes). **R2** if we're going to keep relying on the audit script. **R7** is the biggest behavior change but yields the largest reliability gain.
