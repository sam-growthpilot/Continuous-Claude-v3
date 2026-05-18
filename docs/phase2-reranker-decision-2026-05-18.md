# Phase 2 Reranker Decision — 2026-05-18

**Date:** 2026-05-18
**Status:** Shipped — opt-in (`--rerank` flag, default OFF)
**Branch:** main
**Story:** memory-hardening-phase2-reranker

## Commit Chain

| Hash | Description |
|------|-------------|
| `31169eb` | chore(opc): add sentence-transformers + python-dotenv for Phase 2 reranker |
| `5d13b7f` | feat(memory): add Stage-2 cross-encoder reranker (Phase 2) |
| `4f97be3` | test(memory): add Phase 2 recall eval set (42 query→relevant-id pairs) |
| `b6cc578` | feat(memory): add NDCG@5 + latency eval harness for Phase 2 reranker |
| `4d4dbff` | test(memory): Phase 2 reranker eval results (NDCG@5 + latency) — partial 33/42 |
| `f40e4e2` | docs(memory): add latency measurement methodology to Phase 2 eval report |
| `83d1308` | fix(memory): correct rerank bench percentile + bump eval daemon timeout |

---

## TL;DR

Cross-encoder reranker (BAAI/bge-reranker-v2-m3) ships in `recall_learnings.py` behind `--rerank` (default OFF). Quality arm passed decisively (+110% NDCG@5 lift); latency arm failed — P95 ~95s subprocess, ~5s daemon-bench, both far above the 500ms gate. Default-on requires hardware or architecture changes not in Phase 2 scope.

---

## Decision

**Verdict: SHIP as opt-in. Do NOT enable by default.**

| Metric | Baseline | Reranked | Change |
|--------|----------|----------|--------|
| NDCG@5 | 0.3821 | 0.8038 | **+110.4%** |
| Pairs rescued | — | 9 | pulled into top-5 from outside |
| Pairs demoted | — | 0 | no failure cases |
| P95 wall-clock (subprocess) | — | ~95,000ms | FAIL (gate: 500ms) |
| P95 warm (daemon-bench) | — | ~5,000ms | FAIL (gate: 500ms) |

Eval coverage: 33/42 pairs (partial run — Docker Desktop Linux engine crashed mid-eval). The +110% lift is decisive; the missing 9 pairs cannot flip the verdict.

---

## Why Opt-In (Latency Story)

Two latency benchmarks were measured:

1. **Subprocess wall-clock** (~95s P95): Full cold path — `uv` dependency resolution, Python imports, torch model load, DB connect, rerank forward pass, JSON write. This is the current production path when `--rerank` is called without a running daemon.

2. **Daemon-bench warm** (~5s P95): Rerank step only — model already loaded, TCP loopback to long-lived `rerank.py` process, cross-encoder forward pass over candidates. This is the best achievable latency with the current architecture and hardware.

**Gate threshold: 500ms.** Both arms fail by 10x–190x.

The cross-encoder forward pass on this CPU hardware (no GPU) is the floor. Even in-process with a persistent model, Phase 3+ would need to target a smaller quantized model or GPU inference to meet 500ms. Default-on while latency fails the gate would degrade every recall invocation at hook time.

---

## What Ships in Main

| File | Role |
|------|------|
| `opc/scripts/core/rerank.py` | Cross-encoder daemon + CLI; serves candidates over TCP loopback |
| `opc/scripts/core/recall_learnings.py` | Hybrid-RRF recall; accepts `--rerank` flag to invoke Stage-2 |
| `opc/tests/recall_eval_report.md` | Partial eval results (33/42 pairs) + latency methodology |
| `opc/tests/eval_recall.py` | NDCG@5 + latency harness |
| `opc/tests/phase2_recall_eval_set.json` | 42-pair ground truth (query → relevant_id) |

---

## How to Use It

```bash
# Standard recall (no rerank — default, fast)
uv run --project opc python opc/scripts/core/recall_learnings.py \
  --query "hook test isolation pattern" --k 5 --text-only

# With Stage-2 reranker (opt-in, slow — use for high-stakes queries)
uv run --project opc python opc/scripts/core/recall_learnings.py \
  --query "hook test isolation pattern" --k 5 --rerank

# Start the rerank daemon first for repeated use (amortizes model load)
uv run --project opc python opc/scripts/core/rerank.py --daemon &
```

`--rerank` is a no-op for `--text-only` and `--vector-only` modes. It only activates on the hybrid-RRF path.

---

## Open Follow-Ups

Carry-forward items — not blocking ship:

1. **Clean 42/42 re-run** — Docker Desktop Linux engine crashed during V2 eval attempt. Re-run once Docker is stable to confirm full-set NDCG@5.
2. **MEDIUM-1** (critic 3.1): `daemon_is_alive()` in `rerank.py` should add TCP ping — PID alive does not guarantee socket is accepting; narrow race window.
3. **MEDIUM-2** (critic 3.1): Eval report claims "all 6 types" but partial run only measured 5 (FAILED_APPROACH missing from 33/42 sample).
4. **MEDIUM-3** (critic 3.1): `_apply_rerank` mutates input candidate dicts in-place — works but fragile; add clarifying comment or refactor to copy.
5. **MEDIUM-4** (critic 3.1): Percentile helper is duplicated between `rerank.py` and `eval_recall.py` — extract to `opc/scripts/core/utils.py`.
6. **MEDIUM-5** (critic 3.1): `--all-projects` default in eval differs from production hook scope; document baseline interpretation in report.
7. **NITPICK cluster**: hardcoded model/max_length in report meta, `model=None` indirection, NITPICKs 1-4 from critic 3.1 review.
8. **Unit tests** for `rerank.py` core functions: `rerank()`, `load_model()`, `_recv_exact()`, `daemon_is_alive()`.
9. **Task #11** (deferred from Phase 1): hook-time semantic recall path — decide between (a) BGE daemon, (b) OpenAI text-embedding-3-small (~300ms, no subprocess), (c) accept text-only at hook time. Findings in `thoughts/shared/embedding-mode-task11.md`.
10. **Pre-condition for default-on**: faster reranker (smaller model, ONNX quantization, or GPU) AND in-process recall pipeline (in-process daemon eliminates subprocess overhead). Neither is Phase 2 scope.

---

## Cross-References

- **Handoff:** `docs/memory-system-handoff-2026-05-17.md`
- **Plan:** `~/.claude/plans/im-not-sure-if-compressed-donut.md`
- **Eval report:** `opc/tests/recall_eval_report.md` (commits `4d4dbff` + `f40e4e2`)
- **Phase 1 decision:** committed at `e8444e6` (2026-05-17)
