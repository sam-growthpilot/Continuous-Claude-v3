---
date: 2026-07-05
component: observability
component_name: Braintrust Observability
verdict: adopt
headline: The two-layer score architecture holds up against the mid-2026 frontier — adopt two cheap upgrades (a judge-debiasing recipe audit per the April-2026 "Judging the Judges" findings, and a trace-derived regression eval set with score gates to evolve the emit-invariant guard), WATCH Claude Code's native OTel trace beta as a possible fix for the 60.7% correlation-null problem, and deliberately SKIP server-side online scoring because it would break the no-API-key subscription-CLI judge model.
sources: 11
---

# Braintrust Observability — Next-Evolution Proposal (2026-07-05)

## 1. Where CCv3 is today

Two-layer design (`docs/architecture/subsystems/braintrust.md` — note: the manifest's pointer to `.claude/hooks/src/shared/braintrust-client.ts` is stale; the helper is `braintrust-score.ts`):

- **Layer 1 — deterministic scores, live in the hook path.** Four TS emit sites (`memory-awareness.ts`, `telemetry-tracker.ts`, `ralph-task-monitor.ts`, `hook-health-monitor.ts`) plus Python `store_learning.py` emit 7 score dimensions via `await emitBraintrustScore(...)` in `.claude/hooks/src/shared/braintrust-score.ts:182`. The helper is fail-open (never throws), 2s AbortController timeout, POSTs to `/v1/project_logs/{project_id}/feedback`, and silently no-ops unless `TRACE_TO_BRAINTRUST=true` + `BRAINTRUST_API_KEY` are set (`braintrust-score.ts:186-197`).
- **Layer 2 — LLM judges, offline and sampled.** `opc/scripts/core/judge_session.py` runs 3 judges (`factuality`, `closedqa` via `claude -p --model sonnet`; `plan_rubric` via `codex exec` for cross-model lift) on a deterministic 35% sample (`sha256(session_id) % 100 < 35`), judged once per trace (not per span — a deliberate 10-50x quota saver), with idempotent feedback ids (`sha256(session_id:judge)`), scheduled daily 06:15 via Windows Task Scheduler `CCv3-Judge-Batch` (`docs/braintrust-online-scoring-recipe.md`; `StartWhenAvailable` fixed in BACKLOG FH-03, `docs/system-update/BACKLOG.md:138`).
- **No API keys in the judge path.** Both backends authenticate via subscription OAuth; the recipe doc explicitly records that there is *no* Braintrust UI scoring rule because a server-side rule cannot shell out to local subscription CLIs (`docs/braintrust-online-scoring-recipe.md:3-14`).
- **The emit invariant.** `scripts/audit-braintrust-emits.sh` greps for exactly-`await emitBraintrustScore(` one-liners, `INVARIANT_4=4`, plus a context-bus export-surface guard — a presence tripwire born from the ~8x May-2026 regression (root cause: rogue Ralph loop + asymmetric sync, fixed `ddc0641`; `docs/architecture/subsystems/braintrust.md:70-104`).

**Known limitations (already on the books):**
- `agent_task_success` is dead — registered on the defunct `Agent` matcher while the live tool emits `Task` (`docs/system-update/CURRENT-STATE.md:40`).
- 7 competing `getSessionId` schemes produce **60.7% correlation-null** — scores that can't be joined to their session/trace (`docs/system-update/CURRENT-STATE.md:40`; fix is BACKLOG ST-02, `docs/system-update/BACKLOG.md:59`).
- `closedqa` skips nested Task spans (`nested_subagent_no_correlation`) — sub-agent correlation deferred (`docs/architecture/subsystems/braintrust.md:130-132`).
- Telemetry joinability / consumer metrics are a whole deferred arc (SG-04, `docs/system-update/BACKLOG.md:97`).

## 2. Frontier scan

Verification notes: every arXiv abstract below was fetched directly this session and states what is attributed to it. The Claude Code monitoring page, the two Braintrust scoring pages, and the eval-driven-development article were fetched and quote-verified this session. The three OpenTelemetry sources were confirmed reachable by the research agent with content drawn from search extraction of JS-rendered pages — marked `[search-derived]`.

1. **Claude Code natively exports OTel traces (beta).** `https://code.claude.com/docs/en/monitoring-usage` — with `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` + `OTEL_TRACES_EXPORTER`, Claude Code exports "spans that link each user prompt to the API requests and tool executions it triggers" under a span hierarchy `claude_code.interaction` → `claude_code.llm_request` / `claude_code.hook` / `claude_code.tool` (verified quotes). A `claude_code.hook` span exists — hook executions appear in the harness's own trace tree.
2. **Braintrust online scoring rules.** `https://www.braintrust.dev/docs/evaluate/score-online` — rules "automatically evaluate production traces as they arrive" with a **sampling rate** ("Percentage of logs to evaluate (e.g., 10% for high-volume apps)") and a **SQL filter clause** over input/output/metadata; span- or trace-scoped (verified quotes). Overview at `https://www.braintrust.dev/foundations/online-scoring` (verified).
3. **Eval-driven development / eval gates.** `https://www.braintrust.dev/articles/eval-driven-development` — "Production traces that reveal new edge cases get added to golden sets"; "Eval gates are automated checks in the deployment pipeline that block a change if its evaluation scores fall below defined thresholds"; native GitHub Action that "runs eval suites on every pull request" (verified quotes).
4. **Judge debiasing beats judge scale.** arXiv 2604.23178, "Judging the Judges: A Systematic Evaluation of Bias Mitigation Strategies in LLM-as-a-Judge Pipelines" (Apr 2026) — nine debiasing strategies × five judge models; style bias dominant; "Gemini 2.5 Flash with the Combined Budget strategy reaches the highest agreement of any configuration we tested (71.0%, kappa=0.549) at ~$0.001 per evaluation, about 15x cheaper than the best frontier setup (Claude Sonnet 4, 69.5%, ~$0.015)" (abstract fetched, quoted).
5. **Judge panels: simple aggregation usually wins.** arXiv 2606.01034, "A Finite-Calibration Regime Map for LLM Judge Panels" (Jun 2026) — under finite human-label budgets, "scalar/reliability aggregation wins 16 of 20 real dataset–budget cells" with a seven-judge pool; judge outputs are often additive/redundant (abstract fetched, quoted).
6. **Step-level judging of tool-using agents is fragile.** arXiv 2604.16706, "Evaluating Tool-Using Language Agents: Judge Reliability, Propagation Cascades, and Runtime Mitigation in AgentProp-Bench" (Apr 2026) — substring-based judging agrees with humans at chance level (kappa=0.049) and judgment errors cascade (~62% probability of reaching an incorrect conclusion) (abstract fetched).
7. **Orientation survey.** arXiv 2411.15594, "A Survey on LLM-as-a-Judge" — actively revised survey of judge biases/mitigations/meta-evaluation (title and topic verified; contents not independently re-read this session).
8. **OTel GenAI semconv: real but still experimental.** `https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/` — defines `invoke_agent` / `execute_tool` span shapes; still Development status `[search-derived]`. First-party momentum: `https://opentelemetry.io/blog/2026/genai-observability/` (reachable; content `[search-derived]`). Version ground truth: `https://github.com/open-telemetry/semantic-conventions/releases`. Notably, Claude Code's beta traces use its own `claude_code.*` span names, not `gen_ai.*` conventions.

Not verified at vendor source (excluded from recommendations): specific 2026 feature claims for Langfuse / Arize Phoenix / LangSmith / AgentOps, and Braintrust "Loop"/human-review-queue details beyond the article quote above.

## 3. Gap analysis

**Where we are ahead or unusual:**
- The **fail-open emit contract + invariant tripwire** (`audit-braintrust-emits.sh`) is a defense the field doesn't generally have — it exists because of a real self-inflicted regression class, and it works (sync exclusion + pre-flight gate closed the amplifier).
- **Trace-level (not span-level) judging** matches the frontier warning exactly: AgentProp-Bench shows step-level judging of tool agents is chance-level without ensembles and cascades errors — our quota-driven "judge once per trace" choice is independently validated.
- **Cross-model judging** (codex grades Claude-authored plans) is a pattern the calibration literature endorses (self-preference bias mitigation) and few harnesses implement.
- **Deterministic sampling + idempotent feedback ids** mirror what Braintrust's server-side sampling does, implemented client-side.

**Where we are behind:**
- **Scores are orphaned from trajectories.** 60.7% of correlation attempts are null (CURRENT-STATE.md:40). The frontier ties every score to a full trace; we POST feedback against span ids derived from 7 inconsistent session-id schemes. Claude Code's native OTel trace beta now offers a harness-authoritative trace tree (including hook spans) we are not using.
- **The audit gate checks emit *presence*, not score *behavior*.** Eval-driven development's pattern — versioned eval set from real traces + score-threshold gates on change — is a stronger regression net than grepping for `await emitBraintrustScore(`. We have the capture (session traces, judged sessions) and the scheduler; we lack the versioned set and the score gate.
- **Judge prompts have never been debias-audited.** The rubrics are hand-written and faithful to autoevals semantics, but nothing controls for verbosity/style bias, which 2604.23178 finds dominant — and it shows recipe matters ~15x more than model tier.
- **One of four deterministic signals is dead** (`agent_task_success`, Agent-matcher) — a known fix, listed for completeness.

**Where the frontier direction does NOT fit us:**
- Server-side online scoring rules assume API-billed scorer calls. Our judge economics are subscription-OAuth CLIs by design; the recipe doc already records why a UI rule can't work. The frontier feature is real; our constraint is deliberate.

## 4. Recommendations

| # | Item | Verdict | Rationale |
|---|------|---------|-----------|
| R1 | **Debias-audit the 3 judge rubrics** (verbosity/style controls, explicit score anchors, order-invariance where two artifacts are compared; keep Sonnet — mid-tier + recipe beats frontier + naive per 2604.23178) | **ADOPT** | Cheapest reliability win available; touches only prompts in `judge_session.py` + the recipe doc; no new infra, no new spend. |
| R2 | **Trace-derived regression eval set + score gate** — promote ~10-20 real judged sessions (mix of known-good and known-bad) into a versioned fixture set; a scheduled/CI runner re-judges them and fails on score-threshold regression, complementing (not replacing) the presence-grep invariant | **ADOPT** | Closes the "presence ≠ behavior" gap using the eval-gates pattern (Braintrust EDD article). We already have capture, sampler, idempotent POSTs, and a scheduled runner to extend. Keep the set small — judge quota is subscription-bounded. |
| R3 | **Spike Claude Code's native OTel trace beta** — enable `CLAUDE_CODE_ENABLE_TELEMETRY=1` + `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` on this machine, export to a local OTLP collector, and assess whether `claude_code.interaction`/`claude_code.hook` span ids give a harness-authoritative join key | **WATCH** (bounded spike, no rebuild) | Could dissolve the 60.7% corr-null problem at the source and give `closedqa` the sub-agent correlation it skips today — but the feature is beta, Windows behavior is unproven, and rebuilding the emit path on it now would couple us to a moving target. Spike first; adopt only if the join key is stable. |
| R4 | **Migrate judges to Braintrust server-side online scoring rules** | **SKIP** | Breaks the no-API-key subscription-CLI judge model that `docs/braintrust-online-scoring-recipe.md` deliberately documents; deterministic scores are computed from hook-local state (recall logs, task state) a server-side rule cannot see. Our client-side sampler already replicates the feature's cost control. |
| R5 | **Recode emits to OTel GenAI `gen_ai.*` semconv attribute names now** | **SKIP** | Semconv agent spans are still Development status `[search-derived]`, and Claude Code itself ships `claude_code.*` names, not `gen_ai.*`. Re-evaluate when the semconv stabilizes (check the releases page). |
| R6 | **Judge panels / ensembles** | **WATCH** | Single judges are adequate at our volume. If a panel is ever added, use simple reliability-weighted aggregation — it wins 16/20 finite-label regimes (2606.01034) — and never move to per-span judging (2604.16706 cascade findings validate the current trace-level choice). |

## 5. Integration approach

**R1 — Judge debias audit (effort S, risk low):**
- Files: `opc/scripts/core/judge_session.py` (the three rubric prompts), `docs/braintrust-online-scoring-recipe.md` (record the debias controls per judge).
- Changes: add explicit 0-1 score anchors with behavioral descriptions; instruct judges to ignore length/style ("score substance, a longer answer is not a better answer"); for `plan_rubric`, require per-criterion sub-scores before the aggregate (structured-output demand already exists).
- Verification: `--force` re-judge 5 previously-judged sessions before/after; scores should shift where verbosity was rewarded, stay stable elsewhere. No BACKLOG dependency; independent of ST-02.
- What could go wrong: prompt churn breaks the `unparseable_score` parser — keep the output-format contract byte-identical.

**R2 — Regression eval set + score gate (effort M, risk medium):**
- Files: new `opc/scripts/core/judge_regression.py` (or a `--fixtures` mode on `judge_session.py`); fixture traces under `opc/fixtures/judge-regression/` (session JSON snapshots from `~/.claude/state/braintrust_sessions/`); a scheduled-task or weekly `health-check` hook-in for the gate.
- Ties: complements `scripts/audit-braintrust-emits.sh` (presence) with behavior; feeds SG-04 (telemetry joinability — the fixture set is also a joinability test corpus); reuses the FH-03-hardened scheduled-runner pattern.
- Budget: ~20 fixtures × 3 judges = ~60 subscription-CLI calls per run — run weekly, not per-commit. Dry-run mode for free auditing already exists in the runner.
- What could go wrong: fixture traces embed real session content — screen for secrets before committing; judge nondeterminism causes flaky gates — gate on score *bands* (e.g., mean drop > 0.15) not exact values.
- Sequencing: after R1 (audit the rubric first, then freeze it as the regression baseline).

**R3 — OTel trace spike (effort S for the spike, risk low while read-only):**
- No code changes: set the two env vars + `OTEL_TRACES_EXPORTER=otlp` pointing at a local collector (a stdout/file exporter is enough for the spike), run a normal session, inspect whether `claude_code.interaction` gives one stable id per prompt and whether `claude_code.hook` spans identify our hooks.
- Decision output feeds ST-02 (canonical session id): if the native trace id is stable and joinable, ST-02's canonical `getSessionId` should *adopt or map to it* rather than invent an 8th scheme.
- What could go wrong: beta flag changes semantics between releases; Windows exporter quirks — which is exactly why this is WATCH-spike, not a rebuild.

## 6. Benefits

- **More trustworthy judge scores at zero added spend** (R1): the dominant bias class (style/verbosity) gets controlled in prompts we already run; 2604.23178 indicates recipe, not model tier, is the lever — so no quota increase.
- **A real regression net for the scoring system itself** (R2): today a change can silently make every judge score meaningless while `audit-braintrust-emits.sh` stays green (it only checks the calls exist). A 20-fixture weekly gate catches behavioral drift the presence-grep cannot, using infrastructure that already exists.
- **A path out of the 60.7% correlation-null hole** (R3): if the spike lands, scores finally attach to the harness's own trajectory tree — which also unblocks the deferred sub-agent correlation (`closedqa` nested-span skips) and strengthens SG-04's joinability arc, without maintaining 7 home-grown id schemes.
- **Avoided cost** (R4/R5): no migration to server-side scoring that would convert free subscription judging into API billing, and no coupling to an experimental semconv that Claude Code itself doesn't emit.

## 7. Open questions

1. Does the Claude Code OTel trace beta run cleanly on Windows 11, and is `claude_code.interaction`'s trace/span id stable across the session lifecycle (the R3 spike's core question)?
2. Can Braintrust ingest OTLP traces directly so the native trace and the feedback scores land in one backend? [Speculation — Braintrust OTel ingestion was not verified this session; check first-party docs during the R3 spike.]
3. What is the acceptable flake band for the R2 score gate given judge nondeterminism at temperature defaults — is mean-drop 0.15 over 20 fixtures the right threshold, or should the gate require two consecutive failing runs?
4. Should the dead `agent_task_success` emitter be fixed before R2 freezes a baseline (a 3-signal baseline vs 4)? The matcher fix is already-known work but is not scheduled under any current BACKLOG id.
5. When OTel GenAI semconv agent spans graduate from Development, does Anthropic map `claude_code.*` spans onto `gen_ai.*` — and does that change the R5 SKIP to an adopt?
