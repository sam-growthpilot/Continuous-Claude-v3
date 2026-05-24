# Braintrust Online Scoring Recipe — Gate C / Phase 3b Autoevals

This is the manual UI configuration recipe for the trace-scope online
scoring rule that Phase 3b expects. The runner code lives in
`opc/scripts/core/judge_session.py`. This doc covers the Braintrust UI
side: scope, sample rate, scorers, eligibility, and the env preflight.

## Why trace scope, not span scope

Each judge counts **1 against quota per session** when the rule runs at
**trace scope**. If the same rule ran at **span scope**, each judge would
fire once per matching span — for sessions with many Task spans or many
Bash calls, that's a 10-50x quota multiplier with no improvement in
signal. The deterministic 35% sampler in `judge_session.py` is computed
on the trace's `session_id`, which is also the trace's `root_span_id`.
Sample rate decisions are stable per session, not per span.

## Required environment

Before the rule can usefully run, the local runner and the Braintrust
project need:

| Variable | Where it lives | Purpose |
|---------|----------------|---------|
| `OPENAI_API_KEY` | `opc/.env` | autoevals' default LLM backend. Without it, the runner exits early with an explicit hint. |
| `BRAINTRUST_API_KEY` | `opc/.env` | Posts feedback to `/v1/project_logs/<project_id>/feedback`. |
| `BRAINTRUST_CC_PROJECT_ID` | `opc/.env` | The project the feedback POSTs target. |
| `TRACE_TO_BRAINTRUST` | `opc/.env` | Set to `true` to actually POST. |
| `BRAINTRUST_API_URL` | `opc/.env` (optional) | Defaults to `https://api.braintrust.dev`. |

Verify `OPENAI_API_KEY` is present before the first run:

```bash
cd opc && uv run python -c "import os; print(bool(os.getenv('OPENAI_API_KEY')))"
```

If that prints `False`, add the key to `opc/.env` first. The runner
preflight check will refuse to start without it.

## The three judges

The runner emits one feedback POST per sampled session per judge that
has the required artifacts. Each POST targets the session's root_span_id
so the scores attach at trace level in the Braintrust UI.

| Judge | autoevals class | Input | Output | Skip reason if missing |
|-------|-----------------|-------|--------|-----------------------|
| `factuality` | `Factuality` | user prompt | top recall chunk | `missing_input_or_output` |
| `closedqa` | `ClosedQA` | orchestrator task request | sub-agent final output | `no_task_span` / `nested_subagent_no_correlation` / `missing_input_or_output` |
| `plan_rubric` | `LLMClassifier` (Battle fallback) | user prompt | plan body from `ExitPlanMode` | `missing_input_or_output` |

### Why LLMClassifier and not Battle

`autoevals.Battle` requires an `expected` reference solution to compare
the candidate against. The Gate C plan calls for `expected=None` (we
don't have a reference plan to grade against). With `expected=None`,
Battle has no contract to honor, so the runner falls back to
`LLMClassifier` with a custom three-criteria rubric: **complete,
ordered, verifiable**. Choices map to `good=1.0`, `okay=0.5`, `weak=0.0`.

### Why top-level Task spans only for ClosedQA

The orchestrator-to-sub-agent edge is well-defined (orchestrator says
"do X", sub-agent returns Y, we grade "did Y answer X?"). The
sub-agent-to-nested-tool edge is currently *not* correlated end-to-end
in our Braintrust traces — Phase 4 (sub-agent correlation) is deferred.
If we grade nested Task spans now, we get wrong attribution. The runner
skips nested spans with reason `nested_subagent_no_correlation` and the
ClosedQA judge gets one shot per session at the top-level Task only.

## UI configuration — step by step

1. **Open** the Claude Code project's logs view in Braintrust.
2. **Click** "Online scoring" (or "Automated scoring", depending on
   Braintrust UI version) in the sidebar.
3. **Create rule** with these fields:

   | Field | Value |
   |-------|-------|
   | Name | `cc-trace-scope-judges` |
   | Scope | `trace` *(not span)* |
   | Sample rate | `35%` |
   | Trigger | On trace completion |
   | Scorers | `factuality`, `closedqa`, `plan_rubric` (the three the runner emits) |

4. **Eligibility filter** (optional but recommended) — restrict to
   sessions that actually have:
   - a recall event (`memory-recall.jsonl` row), AND
   - a Task span OR an ExitPlanMode span.

   Without this filter, sampled sessions with no artifacts produce
   harmless skip-reason POSTs but waste rule-execution overhead.

5. **Save the rule.**

## How the runner attaches to the rule

The runner (`opc/scripts/core/judge_session.py`) does **not** itself
trigger the rule. It posts feedback directly via
`/v1/project_logs/<project_id>/feedback` using the same pattern as
Phases 1 and 2 (`emitBraintrustScore`, `_emit_store_quality_score`).
The online rule in the UI is the *alternative* path — it's the
"run the same judges automatically as traces complete" pipeline.

In practice we run BOTH:
- The UI rule covers automated, sampled, continuous scoring on every
  completed trace (35% per session, trace-scope).
- The CLI runner covers ad-hoc backfill and one-off audit:
  `python -m scripts.core.judge_session --session-id <id>` for a
  specific session, or `--scan-since <date>` for a batch.

The feedback id derivation (`sha256(f"{session_id}:{judge_name}")[:16]`)
is the same in both paths, so Braintrust's id-based dedup makes them
safe to overlap.

## Verifying the rule fires

After enabling the rule, kick off a normal Claude Code session that
contains a recall, a Task call, and an `ExitPlanMode`. Wait for the
trace to complete. Then in the Braintrust UI:

1. Open the trace's root span.
2. Look at the **Feedback** panel.
3. You should see up to three scores: `factuality`, `closedqa`,
   `plan_rubric`, each with `score` and a `rationale` in the metadata.

If a judge is missing, check the skip reasons by re-running the CLI in
dry mode for that session:

```bash
cd opc && uv run python -m scripts.core.judge_session \
    --session-id <session-id> --dry-run
```

The output JSON's `skipped` map tells you which judges were skipped and
why.

## Trigger conditions / when to run

| Scenario | UI rule | CLI runner |
|----------|---------|-----------|
| Steady-state automated scoring | Yes (35% sample) | No |
| Backfill historical sessions | No | `--scan-since <iso-date> --max-sessions N` |
| Re-grade a specific session | No | `--session-id <id>` |
| Pre-flight a candidate change to the rubric | No | `--session-id <id> --dry-run` then enable POSTs |
| Quota audit | No | `--dry-run` reports `would_post` counts without firing judges |

## Idempotency and re-runs

Re-running the CLI for the same session yields the same feedback IDs
(`sha256(f"{session_id}:{judge_name}")[:16]`). Braintrust dedups on the
id, so re-running is safe. The UI rule writes IDs the same way when
configured to use deterministic scorers, so the rule and the CLI won't
fight each other.

## Cost / quota notes

- One sampled session = up to three judge calls.
- Each judge call = one chat completion via the configured OpenAI model
  (default `gpt-4o-mini` via autoevals' defaults; override with the
  `model=` kwarg in `judge_session.py` if quota is tight).
- At 35% sampling and ~50 sessions/day, expect ~52 sampled sessions
  per week, ~156 judge calls per week. Adjust the sample rate at the
  rule level if this exceeds budget.

## Distribution review

Defer per the plan: ~1 week after first organic runs, eyeball the score
histograms in the Braintrust UI. If any judge produces near-uniform
`score=1.0` outputs, the prompt or rubric needs sharpening before the
score signal is useful.
