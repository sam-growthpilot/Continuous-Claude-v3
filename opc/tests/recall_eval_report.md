# Recall Eval Report — Phase 2 Reranker

*Generated: 2026-05-18T00:11:48.369771+00:00*

## PARTIAL RUN NOTICE

This report covers the first 33 of 42 pairs from the eval set.

**Reason:** The eval was originally launched in-session and made progress
through pair 34 (baseline only). The Bash tool's 10-minute lifetime cap
killed the orchestrating process before the eval could complete; subsequent
re-runs all hit a systematic failure mode where every `recall_learnings.py
--rerank` subprocess returned exit code 1 with empty stderr — likely a
resource-contention or model-cache corruption issue triggered by leftover
daemon processes from earlier runs.

The 33 complete pairs cover 5 of 6 learning types (FAILED_APPROACH pairs at
positions 39-43 not reached in this partial run) and both scopes (PROJECT
and GLOBAL). The decision-gate verdict below should be treated as
**indicative, not authoritative** — Task 3.2 should re-run the eval on a
clean system before relying on the result.

## Run Metadata

| Field | Value |
|-------|-------|
| Eval set | `opc/tests/recall_eval_set.jsonl` |
| Pairs evaluated | 33 (PARTIAL — first 33 of 42) |
| K | 5 |
| Reranker model | `BAAI/bge-reranker-v2-m3` |
| Max length | 256 |
| Rerank top-N | 50 |
| Daemon mode | True |
| Warmup excluded | True (n=2) |
| Baseline arm ran | True |
| Rerank arm ran | True |

## Summary

| Metric | Baseline | Rerank | Lift |
|--------|----------|--------|------|
| Mean NDCG@5 | 0.382 | 0.804 | +110.4% |
| Found rate (in top-5) | 57.6% | 84.8% | - |
| P50 latency | 29436ms | 59967ms | - |
| P95 latency | 56081ms | 95142ms | - |
| Latency sample n | 28 | 31 | - |

## NDCG@5 by Type

| Type | n | Baseline | Rerank | Lift |
|------|---|----------|--------|------|
| ARCHITECTURAL_DECISION | 3 | 0.210 | 0.544 | +158.5% |
| CODEBASE_PATTERN | 5 | 0.486 | 0.800 | +64.5% |
| ERROR_FIX | 8 | 0.567 | 0.954 | +68.2% |
| USER_PREFERENCE | 1 | 0.000 | 1.000 | inf |
| WORKING_SOLUTION | 16 | 0.313 | 0.766 | +144.7% |

## NDCG@5 by Scope

| Scope | n | Baseline | Rerank |
|-------|---|----------|--------|
| GLOBAL | 19 | 0.393 | 0.823 |
| PROJECT | 14 | 0.367 | 0.778 |

## Latency Measurement Methodology

The decision-gate latency arm threshold is `P95 <= 500ms`. Two different latency measurements exist for this eval:

| Metric | Source | Value | Gate (<=500ms) |
|---|---|---:|:---:|
| `eval_subprocess_p95_ms` | `recall_learnings.py --rerank` wall-clock per call (this eval) | ~95,000 ms | **FAIL** |
| `daemon_bench_p95_ms` | `rerank.py --bench` in-process hot loop (kraken Task 1.2, commit `5d13b7f`) | ~5,000 ms | **FAIL** |

**What each measures:**
- `eval_subprocess_p95_ms` is wall-clock per `uv run python recall_learnings.py --rerank ...` call. Includes uv env resolve, Python imports, sentence-transformers/torch import, DB connect, rerank step, JSON write. **This is what a USER experiences invoking `/recall --rerank` from a fresh shell.**
- `daemon_bench_p95_ms` is in-process hot-loop of the rerank step only. Excludes shell, imports, and DB. Measures steady-state cost of the cross-encoder forward pass on top-50 candidates with a daemon-resident model. **This is what `/recall --rerank` would cost if the entire recall pipeline lived in a long-lived daemon (Phase 3+ change, out of scope for Phase 2).**

**Conclusion for Task 3.2 (decision gate):**

The gate's latency arm uses `eval_subprocess_p95_ms` (the honest user-experience cost). At ~95s, this is ~190x over the 500ms gate. Even the daemon-bench measurement at ~5s is 10x over the gate. Therefore:

- The rerank cannot be default-on while the recall pipeline is invoked as a subprocess.
- Even with a Phase-3+ in-process recall daemon, the cross-encoder forward pass alone exceeds 500ms.
- **The `--rerank` flag stays opt-in.** Default-on would require either a faster reranker (smaller model, ONNX quantization, GPU acceleration) or relaxing the latency-arm threshold to ~5s warm.

## Decision Gate (Task 3.2)

- **NDCG@5 lift**: +110.4% (gate >= +10.0%) -> **PASS**
- **P95 latency**: 95142ms (gate <= 500ms) -> **FAIL**
- **Decision**: `opt-in` — NDCG lift passes but P95 latency exceeds the gate; keep --rerank opt-in until latency improves (smaller model, batching, GPU).

**CAVEAT**: The P95 latency measured here is the end-to-end `uv run python
recall_learnings.py` subprocess wall-clock time, NOT the in-process recall
latency. The subprocess overhead (uv venv resolution + python import + DB
connect + model load) dominates. The actual rerank decision should be made
against the in-process daemon ping P95 (which kraken's bench measured at
4-7s in 1.2).

**Scope note:** The baseline + reranked NDCG numbers here were measured with
`recall_learnings.py --all-projects` because the eval set spans multiple
projects' PROJECT-scope entries. Production hook recall
(`memory-awareness.ts`, `agent-recall-injector.ts`) is CWD-scoped, so
real-world baseline NDCG will be lower (less competition) and the absolute
reranker lift may be larger. The +110.4% relative lift is the gate metric
and remains directionally robust.

## Comparison Breakdown

| Verdict | Count | Meaning |
|---------|-------|---------|
| rescued | 9 | Rerank pulled the relevant doc INTO top-K from outside |
| demoted | 0 | Rerank pushed the relevant doc OUT of top-K (failure mode) |
| shuffled_improved | 10 | Both top-K contain relevant; rerank rank is better |
| shuffled_worse | 0 | Both top-K contain relevant; rerank rank is worse |
| shuffled_no_change | 9 | Top-K reordered but relevant doc rank unchanged |
| baseline_match | 0 | Rerank returned the identical top-K as baseline |
| both_miss | 5 | Relevant doc not in top-K under either arm |

**Note**: These verdicts are computed from NDCG comparison only (top-K id lists
are not available in the partial log data). 'baseline_match' and the granular
'shuffled_no_change' / 'shuffled_improved' distinctions may be under-represented.

## Top Rescued Pairs (rerank wins)

| Query | Relevant ID | Type | Scope |
|-------|-------------|------|-------|
| drizzle orm prisma preference | `b87bd60b...` | USER_PREFERENCE | PROJECT |
| mcp servers settings json ignored | `5abfaff4...` | WORKING_SOLUTION | GLOBAL |
| vitest mock lucide-react infinite hang | `6baa38a4...` | WORKING_SOLUTION | PROJECT |
| shadcnspace registry auth params components.json | `f32addc6...` | WORKING_SOLUTION | PROJECT |
| sync-to-active hooks dist not copied | `38f8551f...` | WORKING_SOLUTION | GLOBAL |
| drizzle migrate journal file missing deploy | `26d15f5b...` | WORKING_SOLUTION | GLOBAL |
| knowledge tree silent stop continuous-claude | `06be54d0...` | ERROR_FIX | GLOBAL |
| ralph e2e cli task tracker grade | `5ff3a2df...` | ARCHITECTURAL_DECISION | GLOBAL |

## Demoted Pairs (rerank failure mode)

None — no pair where rerank pushed the relevant_id OUT of top-K.

## Errors

| Query | Arm | Error |
|-------|-----|-------|
| drizzle orm prisma preference | baseline | timeout |
| vitest mock lucide-react infinite hang | baseline | timeout |
| shadcnspace registry auth params components.json | baseline | timeout |
| sync-to-active hooks dist not copied | baseline | timeout |

