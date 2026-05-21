# Recall Eval Report — Phase 2 Reranker

*Generated: 2026-05-21T01:29:37.455748+00:00*

## Run Metadata

| Field | Value |
|-------|-------|
| Eval set | `tests\recall_eval_set.jsonl` |
| Pairs evaluated | 42 |
| K | 5 |
| Reranker model | `BAAI/bge-reranker-v2-m3` |
| Max length | 256 |
| Rerank top-N | 50 |
| Daemon mode | False |
| Warmup excluded | True (n=2) |
| Baseline arm ran | True |
| Rerank arm ran | True |

## Summary

| Metric | Baseline | Rerank | Lift |
|--------|----------|--------|------|
| Mean NDCG@5 | 0.385 | 0.798 | +107.3% |
| Found rate (in top-5) | 57.1% | 83.3% | - |
| P50 latency | 9861ms | 32862ms | - |
| P95 latency | 12016ms | 35282ms | - |
| Latency sample n | 40 | 40 | - |

## NDCG@5 by Type

| Type | n | Baseline | Rerank | Lift |
|------|---|----------|--------|------|
| ARCHITECTURAL_DECISION | 3 | 0.210 | 0.544 | +158.5% |
| CODEBASE_PATTERN | 9 | 0.381 | 0.667 | +74.9% |
| ERROR_FIX | 8 | 0.567 | 0.954 | +68.2% |
| FAILED_APPROACH | 5 | 0.186 | 1.000 | +437.2% |
| USER_PREFERENCE | 1 | 1.000 | 1.000 | +0.0% |
| WORKING_SOLUTION | 16 | 0.353 | 0.766 | +117.4% |

## NDCG@5 by Scope

| Scope | n | Baseline | Rerank |
|-------|---|----------|--------|
| GLOBAL | 22 | 0.359 | 0.847 |
| PROJECT | 20 | 0.414 | 0.745 |

## Decision Gate (Task 3.2)

- **NDCG@5 lift**: +107.3% (gate >= +10.0%) -> **PASS**
- **P95 latency**: 35282ms (gate <= 500ms) -> **FAIL**
- **Decision**: `opt-in` — NDCG lift passes but P95 latency exceeds the gate; keep --rerank opt-in until latency improves (smaller model, batching, GPU).

## Comparison Breakdown

| Verdict | Count | Meaning |
|---------|-------|---------|
| rescued | 11 | Rerank pulled the relevant doc INTO top-K from outside |
| demoted | 0 | Rerank pushed the relevant doc OUT of top-K (failure mode) |
| shuffled_improved | 13 | Both top-K contain relevant; rerank rank is better |
| shuffled_worse | 0 | Both top-K contain relevant; rerank rank is worse |
| shuffled_no_change | 11 | Top-K reordered but relevant doc rank unchanged |
| baseline_match | 0 | Rerank returned the identical top-K as baseline |
| both_miss | 7 | Relevant doc not in top-K under either arm |

## Top Rescued Pairs (rerank wins)

| Query | Relevant ID | Type | Scope |
|-------|-------------|------|-------|
| mcp servers settings json ignored | `5abfaff4...` | WORKING_SOLUTION | GLOBAL |
| vitest mock lucide-react infinite hang | `6baa38a4...` | WORKING_SOLUTION | PROJECT |
| sync-to-active hooks dist not copied | `38f8551f...` | WORKING_SOLUTION | GLOBAL |
| drizzle migrate journal file missing deploy | `26d15f5b...` | WORKING_SOLUTION | GLOBAL |
| knowledge tree silent stop continuous-claude | `06be54d0...` | ERROR_FIX | GLOBAL |

