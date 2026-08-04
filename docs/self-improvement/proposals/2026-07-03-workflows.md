---
date: 2026-07-03
component: workflows
component_name: Workflows
verdict: adopt
headline: CCv3's workflow patterns match or lead the mid-2026 frontier (deterministic orchestration, bounded fresh-context loops, adversarial gates) — the real gaps are the dead enforcement wiring already on the books, plus three cheap frontier upgrades (plan-compliance verification, a tool-grounded panel at the merge gate, a journal-resume idempotency audit) and codifying recurring fan-outs as native Workflow-tool scripts.
sources: 11
---
# Workflows — Next-Evolution Proposal (2026-07-03)

## 1. Where CCv3 is today

**Three workflow layers.**

1. **Ralph** — the autonomous PRD-driven dev loop (`.claude/skills/ralph/SKILL.md`). Phases: context loading (0) → optional deep research (0.5) → PRD (1) → task breakdown with tracer-bullet ordering (2) → mandatory adversarial premortem gate (2.5, `SKILL.md:187-196`) → delegation loop where Ralph never implements and every agent must return a `ralph_status` JSON block (3, `SKILL.md:225-230`) → external verification after every agent with failure details passed to a recovery agent, max 3 attempts (3.5, `SKILL.md:234-238`) → independent goal verification by a `plan-reviewer` agent checking PRD acceptance criteria against `git diff` before merge (4.1.5, `SKILL.md:270-280`). State machinery is real and tested: `.ralph/state.json` v2 via `scripts/ralph/ralph-state-v2.py`, checkpoints (`ralph-checkpoint.py`), markdown reconciliation (`ralph-progress-sync.py`), scheduler, and pytest coverage (`scripts/ralph/test_*.py`, listed 2026-07-03). Iteration is bounded 10/30/50 by task size with a structured `<BLOCKED/>` escalation that reports `Completed: X/Y` (`.claude/skills/ralph/references/state-management.md:38-57`), and the fresh-context architecture is explicit doctrine: "Progress doesn't persist in the LLM's context window — it lives in your files and git history" (`state-management.md:77`).

2. **Maestro** — interview-gated multi-step orchestration (`.claude/skills/maestro/SKILL.md`): recon → discovery interview → plan proposal → approval → execute, with claimed hook enforcement at each gate (`SKILL.md:36-40`).

3. **The native deterministic Workflow tool** — harness-provided JS orchestration (`agent()`/`parallel()`/`pipeline()`, schema-forced structured returns, token budgets, journal-based resume). CCv3 has **zero saved workflow scripts** — `.claude/workflows/` does not exist (Glob verified 2026-07-03). All recurring orchestrations (/review fan-out, premortem, Ralph's phase-3 loop) run as *prose-driven skill instructions the orchestrator model must faithfully re-execute each time*.

**Known limitations (already on the books).**
- The workflow enforcement layer is largely dead: `ralph-task-monitor` never fires and `maestro-enforcer` never fired once (registered under matcher `'Agent'` while the live tool emits `'Task'`, D10c-03) — RULES.md asserts C:10 blocking for Maestro that is **false** (`docs/system-update/CURRENT-STATE.md:39`). Only `plan-to-ralph-enforcer` + `plan-exit-tracker` are live. The fix is queued: `QW-04` is the LAST remaining Wave-1 item (`docs/system-update/BACKLOG.md:37,49`), and the 2026-07-01 hooks proposal R1 (ratified direction) supersedes the bare matcher flip with a retarget to native `SubagentStart`/`SubagentStop` events (`docs/self-improvement/proposals/2026-07-01-hooks.md`).
- `ralph-delegation-enforcer` has been soft (log-only) since 2026-04-23 because it cannot distinguish orchestrator from sub-agents on a shared `session_id` (RULES.md → Ralph Mode); the identity fix is ST-02's two-level `session_id + agent_id` (`BACKLOG.md:59`).
- Sub-agents in the delegation loop are memory-blind and return free text outside the one `ralph_status` contract — both already tracked (ST-05/ST-10; agents proposal 2026-07-02 R2 structured-return contracts).

## 2. Frontier scan

All arXiv IDs and URLs below were independently re-verified this session (2026-07-03): each arXiv abs page fetched and title confirmed; each blog URL returned HTTP 200. Claims sourced only from search summaries are marked **[summary-only]**.

1. **Anthropic — Building effective agents** (Dec 2024, still the reference doc; https://www.anthropic.com/engineering/building-effective-agents). The canonical vocabulary: *workflows* (LLMs orchestrated through predefined code paths) vs *agents* (LLMs directing their own process), plus the named composable patterns — orchestrator-workers, evaluator-optimizer — and the guidance to prefer the simplest structure that works.
2. **Anthropic — Building agents with the Claude Agent SDK** (2025-26, https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk). Core loop: gather context → take action → verify work; sub-agents run in isolated context windows and return distilled summaries to the orchestrator.
3. **Orchestration survey** (arXiv 2601.13671, Jan 2026, title verified: "The Orchestration of Multi-Agent Systems: Architectures, Protocols, and Enterprise Adoption"). The shipping topologies reduce to four: graph-based (LangGraph, Microsoft Agent Framework), role-based (CrewAI), handoff-based (OpenAI Agents SDK), hierarchical (Google ADK); frameworks converge on MCP + persistence + observability.
4. **Plan-compliance as a distinct verification axis** (arXiv 2604.12147, Apr 2026, title verified: "Evaluating Plan Compliance in Autonomous Programming Agents"). Whether an agent's actions *followed its stated plan* is a failure mode separate from "did the tests pass" — agents drift from their own approved plan while still producing passing-looking output.
5. **Verify-then-act** (arXiv 2604.10800, Apr 2026, title verified: "Verify Before You Fix: Agentic Execution Grounding for Trustworthy Cross-Language Code Analysis"). An execution-grounded verification pass *before* applying a fix reduces fix-introduced regressions — formalizing verify-then-act over act-then-verify.
6. **Single LLM judges are threshold-unreliable in agentic settings** (arXiv 2606.29920, Jun 2026, title verified: "Can LLM-as-a-Judge Reliably Verify Rubrics in Agentic Scenarios?"). Judging rubric satisfaction over agent trajectories: consistently sub-human/sub-SME agreement — a single judge is weak evidence at a hard pass/fail gate.
7. **Long-horizon coding cliff** (arXiv 2512.18470, Dec 2025, title verified: "SWE-EVO: Benchmarking Coding Agents in Long-Horizon Software Evolution Scenarios" — 48 tasks, avg ~21 files/task; and arXiv 2605.15846, May 2026, title verified: "RoadmapBench: Evaluating Long-Horizon Agentic Software Development Across Version Upgrades", which proposes partial-progress metrics). **[summary-only]:** frontier agents score roughly a third on SWE-EVO of what they score on single-issue SWE-Bench Verified.
8. **The public "Ralph" loop** (https://ghuntley.com/ralph/, Geoffrey Huntley, mid-2025, HTTP 200). Fresh-context re-prompting with progress persisted in files/git and failure output piped back as forcing context ("contextual pressure cooker") until a completion criterion is met.
9. **Checkpointing ≠ durable execution** (https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows, HTTP 200). Graph-checkpoint frameworks save state *between* nodes; they do not make the work *inside* a step (tool call, side effect) atomic or exactly-once on crash/replay. True durable execution (Temporal/DBOS/Restate/Inngest) makes each step individually retriable without double-applying side effects.
10. **DBOS — durable execution as an in-process Postgres library** (https://www.dbos.dev/blog/durable-execution-crashproof-ai-agents, HTTP 200). Workflow/step state stored directly in Postgres from an in-process library — durable-execution semantics without standing up a separate orchestration service.
11. **Formal workflow verification** (arXiv 2606.06523, Jun 2026, title verified: "Lean4Agent: Formal Modeling and Verification for Agent Workflow and Trajectory"; arXiv 2605.25233, May 2026, title verified: "Meta-Agent: From Task Descriptions to Verified Multi-Agent Systems"). Machine-checked properties over agent workflows/trajectories; construct-then-prove multi-agent synthesis.

## 3. Gap analysis

| Dimension | CCv3 today | Frontier | Verdict |
|-----------|-----------|----------|---------|
| Plan-execute-verify loop shape | Ralph phases 0→4.1.5 with premortem + goal verifier; Maestro gated phases | Orchestrator-workers + evaluator-optimizer (source 1); gather→act→verify (source 2) | **Even/ahead** — we implement the named patterns plus gates the reference docs don't require |
| Bounded iteration + escalation | 10/30/50 tiers, retry chain, `<BLOCKED/>` with Completed X/Y | Community convention; benchmarks show the long-horizon cliff Ralph is built for (source 7) | **Ahead** |
| Fresh-context delegation | Explicit doctrine + Task-tool isolation + files/git as the persistence layer | The public Ralph loop (source 8); SDK sub-agent summaries (source 2) | **Even/ahead** — and the "pressure cooker" is already present: failure details are passed to the recovery agent (`SKILL.md:238`) |
| Deterministic vs model-driven control | Deterministic Workflow tool EXISTS but is unused (0 saved scripts); Ralph/Maestro loops are prose the model re-executes | "Workflows = predefined code paths" is the reliability-leader position (sources 1, 3) | **Behind on usage, not capability** — our recurring orchestrations depend on the model faithfully following prose state-machine steps (3.2→3.7) every iteration |
| Enforcement of workflow contracts | maestro-enforcer never fired; ralph-task-monitor dead; delegation enforcer soft; docs overclaim | Frameworks enforce graph transitions in code, not prompts (source 3) | **Behind — already tracked** (QW-04 / hooks-R1 / ST-02); this proposal adds only the workflow-side rescope |
| Verification at the merge gate | Single independent judge (plan-reviewer) + test suite; codex-adversary lives in /review, not in Ralph 4.1.5 | Single judges threshold-unreliable (source 6); tool-grounded verifiers + small diverse panels for hard gates | **Behind** — the one place a lone text judge gates an irreversible action (merge) |
| Plan-compliance verification | Goal verifier checks acceptance criteria (outcome); nothing checks the diff/trajectory against the *approved plan* | New, distinct axis (source 4); verify-then-act grounding (source 5) | **Gap** — cheap to close |
| Partial-progress scoring | Task-level Completed X/Y in BLOCKED output and state.json | Fix-Rate-style fine-grained partial credit (source 7) | **Mostly even** at our scale — task-level is adequate for a single-operator harness |
| Durability of resume | Checkpoint/journal-level: `detect-stale` + `reconcile`, pre/post-task checkpoints; Workflow tool journal resume | "Checkpoints ≠ durable execution" — first replayed step can double-apply side effects (sources 9, 10) | **Unaudited risk** — unknown whether a crash mid-commit double-applies on resume |
| Formal verification of workflows | None (tests + adversarial review) | Lean4Agent / Meta-Agent (source 11) | **Behind, deliberately** — over-engineered for this domain |

## 4. Recommendations

**R1 — Add a plan-compliance check to Ralph's merge gate. ADOPT.**
Ralph 4.1.5 verifies *outcomes* (PRD acceptance criteria vs diff). Source 4 (arXiv 2604.12147) identifies the orthogonal failure: the agent did something that passes, but not what the approved plan said — precisely the drift the premortem-approved plan was supposed to prevent. Extend the 4.1.5 verifier prompt to also grade the diff against the approved task list (`/tasks/tasks-<feature>.md`) and flag off-plan changes (files touched outside the declared file list, tasks marked complete with no corresponding diff). Effort S — a prompt/checklist extension to an existing step plus one section in `references/patterns.md`. Risk: near zero (adds a report, blocks nothing new by itself).

**R2 — Make Ralph's merge gate a small tool-grounded panel instead of a lone text judge. ADOPT.**
Source 6 benchmarks single judges as threshold-unreliable at hard gates; the merge to main is CCv3's one irreversible workflow gate guarded by exactly one text-only judge (plan-reviewer, `SKILL.md:270-280`). The pieces already exist: tests run at 4.1, codex-adversary exists as a distinct cross-model reviewer (`.claude/rules/codex-adversarial.md`), and the agents proposal (2026-07-02 R3) already proposed rubric'd outcome grading. Change: at 4.1.5, require agreement of (a) the test suite (tool-grounded), (b) plan-reviewer (criteria + the R1 plan-compliance check), and (c) codex-adversary in code mode over `git diff main...HEAD` — any FAIL blocks merge. Keep single-judge for cheap per-task verification (3.5) — panel only at the gate, matching the frontier's "panel for irreversible decisions, single judge for cheap passes." Effort S–M (skill edit + one extra spawn per Ralph run). Cost: one Codex call per feature — bounded and consistent with the existing /review posture; `--no-codex` remains the doc-only escape hatch.

**R3 — Audit journal/checkpoint resume for first-replayed-step idempotency. ADOPT (audit-first).**
Sources 9–10 draw the sharpest new line of the period: checkpoint-level resume (which is what `.ralph/state.json` + `detect-stale`/`reconcile` and the Workflow tool's journal are) does not make the step *in flight at crash time* safe to replay. Concrete CCv3 scenario: agent crashes after `git commit` but before `task-complete` is recorded → resume re-runs the task → duplicate/conflicting commit. Audit `ralph-state-v2.py` + `ralph-progress-sync.py` resume paths for this window; where found, make the replayed step idempotent (e.g., check for the task's commit marker in git log before re-spawning — the `ralph_status.commit` field already carries the hash). Effort S for the audit, S–M for fixes. Verdict on adopting a durable-execution engine (Temporal / DBOS): **SKIP for now** — but if the audit finds real double-apply windows, a DBOS-style Postgres step ledger is the lowest-infra fix since Postgres already runs (source 10). [Speculation: the window exists — the audit is what confirms or clears it.]

**R4 — Codify recurring fan-outs as saved native Workflow-tool scripts. ADOPT (start with /review).**
CCv3's stated bet — deterministic orchestration over model-driven routing — matches the frontier's reliability-leader position (sources 1, 3), yet the deterministic engine the harness ships is unused (0 saved scripts, `.claude/workflows/` absent) while /review, /premortem, and Ralph's 3.2→3.7 loop are prose state machines the orchestrator model re-executes from instructions each time. That is exactly the drift class the enforcement hooks kept failing to catch (dead maestro-enforcer; the 3.7 "skipping this causes drift" warning in the skill itself). Start where risk is lowest and the shape is pure fan-out/verify: encode /review Phase 1 (critic ∥ codex-adversary ∥ plan-reviewer → synthesis, with schema-forced findings arrays) as a saved workflow script; the schema option also delivers the agents proposal's R2 structured-return contract mechanically for that path. Effort M. Risk: workflow scripts run headless-deterministic, so keep the human synthesis/judgment step in the skill, not the script.

**R5 — Port Ralph's phase-3 delegation loop into a Workflow script. WATCH.**
The natural follow-on to R4, and the biggest reliability win on paper (mechanized `task-start`/`task-complete`/`sync` instead of prose steps). But Ralph's loop is deeply coupled to Python state tooling, AskUserQuestion checkpoints, and HITL/AFK modes; the Workflow tool is headless by design. Re-evaluate after R4 proves the pattern and after hooks-R1 revives spawn-side telemetry so the loop's actual failure rate is measurable. [Speculation: the prose loop may be failing rarely enough that porting is not worth the coupling cost — measure first.]

**R6 — Rescope the dead workflow-enforcement hooks during the QW-04 / hooks-R1 retarget. ADOPT (rider, not new work).**
When the 2026-07-01 hooks proposal R1 retargets the dead chain to `SubagentStart`/`SubagentStop`, include `maestro-enforcer` and `ralph-task-monitor` in that pass, and in the same change fix the overclaiming docs: RULES.md's false "agents are BLOCKED until interview completes" C:10 assertion and `maestro/SKILL.md:36-40`'s enforcement block should say what actually fires (claim-verification discipline applied to our own docs). Effort XS as a rider on already-planned work.

**R7 — Verify-then-act gate inside the fix loop. WATCH.**
Source 5's execution-grounded pre-fix verification is interesting for the /fix workflow (reproduce-before-patch is already the systematic-debugging skill's doctrine), so the marginal gain over existing practice is unclear. Track; adopt only if fix-introduced regressions show up in session scoring.

**R8 — Fine-grained partial-progress (Fix-Rate-style) metrics. SKIP.**
Ralph's task-level `Completed: X/Y` in the BLOCKED escalation (`state-management.md:44-51`) already gives the operator the decision-relevant signal at single-user scale. Test-level partial credit is benchmark instrumentation, not harness value.

**R9 — Formal workflow verification (Lean4Agent / Meta-Agent). SKIP.**
Construct-then-prove is real frontier motion (source 11) but wildly over-engineered for a personal dev harness whose verification currency is tests + adversarial review. Revisit only if CCv3 workflows ever gate multi-user production actions.

## 5. Integration approach

| Rec | Files / subsystems | BACKLOG tie | Effort | Risk |
|-----|--------------------|-------------|--------|------|
| R1 plan-compliance | `.claude/skills/ralph/SKILL.md` (4.1.5), `references/patterns.md` | complements agents-proposal R3 grading; candidate **SI-NN** | S | Near zero — additive check |
| R2 merge-gate panel | `.claude/skills/ralph/SKILL.md` (4.1.5); reuses codex-adversary agent | rides `.claude/rules/codex-adversarial.md` posture + codex-lift telemetry; candidate **SI-NN** | S–M | +1 Codex call/feature; latency at gate; mitigated by doc-only skip |
| R3 resume idempotency audit | `scripts/ralph/ralph-state-v2.py`, `ralph-progress-sync.py`, `ralph-checkpoint.py` (+ existing pytest suite) | independent; findings may spawn a follow-up item | S audit, S–M fix | Low — audit is read-only; fixes guarded by existing tests |
| R4 /review as Workflow script | new `.claude/workflows/review.js` (or session-persisted script), `.claude/skills/review/SKILL.md` pointer | delivers agents-R2 structured returns for the review path; candidate **SI-NN** | M | Headless determinism vs human synthesis — keep judgment in the skill |
| R5 Ralph loop port | (deferred) | after R4 + hooks-R1 telemetry | L | High coupling — why it's WATCH |
| R6 enforcement rescope + doc truth | `settings.json` ×3, `maestro-enforcer.ts`, `ralph-task-monitor.ts`, RULES.md, `maestro/SKILL.md` | **rider on QW-04 / hooks-proposal R1** — no new arc | XS rider | None beyond the already-planned change |

Sequencing: R6 rides the already-queued QW-04/hooks-R1 work. R1+R2 are one Ralph-skill editing session and should ship together. R3 is an independent audit any session can run. R4 is its own small project; R5/R7 wait on evidence.

What could go wrong: R2's panel could deadlock a merge on a flaky Codex call (mitigate: panel degrades to plan-reviewer + tests with a logged warning when Codex errors); R4 could fork behavior between the skill prose and the script (mitigate: the skill invokes the script — single source of truth); R3's fixes could touch the DELICATE state files Ralph resume depends on (mitigate: the existing `test_ralph_state_v2.py` suite is the regression net).

## 6. Benefits

- **Fewer silently-wrong merges.** R1+R2 close the two verification holes at the one irreversible gate: plan drift that passes tests, and single-judge threshold error. Cost is ~1 extra Codex call per feature.
- **No lost work on crash.** R3 turns "resume probably works" into "resume verified idempotent" — directly protecting AFK Ralph runs, which is the mode where the user isn't watching.
- **Reliability without vigilance.** R4 moves the /review fan-out from "the model re-reads prose and hopefully does the same thing" to a deterministic code path with schema-enforced returns — the exact workflows-vs-agents trade the reference doctrine recommends (source 1).
- **Docs that tell the truth.** R6 ends the state where RULES.md asserts C:10 enforcement that has never fired once — which misleads every future session that reads it.
- **Validated bets, no rework.** The scan confirms the expensive parts already built — bounded fresh-context loops, premortem, delegation, cross-model review — are at or ahead of the frontier. Nothing here is a rebuild.

## 7. Open questions

1. Does the crash-between-commit-and-record window actually exist in `ralph-state-v2.py` resume, or does `reconcile` already detect the orphan commit via `ralph_status.commit`? (R3's first question.)
2. Should the R2 panel be 2-of-3 (majority) or all-must-pass at the merge gate? All-must-pass is safer but makes one flaky judge a hard blocker.
3. Where should saved Workflow scripts live so they sync like skills do — `.claude/workflows/` is not in `SYNC_DIRS` today (`.claude/rules/sync-known-gaps.md` doesn't list it)?
4. How often does Ralph's prose loop actually skip 3.7 sync or mis-order state calls in practice? Spawn-side telemetry (hooks-R1) is what makes R5's port decision evidence-based rather than aesthetic.
5. Is the Workflow tool available in headless `claude -p` runs (the scheduled-task substrate), or interactive-only? Determines whether R4-style scripts can serve the recurring scheduled jobs too.
