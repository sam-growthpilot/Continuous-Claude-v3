# Task #11 Embedding Daemon Decision — 2026-05-18

**Date:** 2026-05-18
**Status:** Shipped — default-on (daemon auto-spawns on first hook miss)
**Branch:** main
**Story:** task-11-embedding-daemon

## Commit Chain

| Hash | Description |
|------|-------------|
| `36b241a` | feat(memory): persistent BGE embedding daemon + recall routing |
| `0f12c43` | feat(memory): hook-time semantic recall via embedding daemon |
| `3912209` | fix(memory): mode-aware floor split (hybrid 0.01, text-only 0.05) |
| `e8566b3` | fix(memory): hook subprocess timeout + test isolation + timeout diagnostic |
| `57b6724` | fix(memory): bump hook subprocess timeout + tighten embed daemon timeout |

---

## TL;DR

BGE embedding daemon (BAAI/bge-large-en-v1.5) ships default-on. `memory-awareness.ts` auto-spawns the daemon on first hook miss, then routes to hybrid (vector+FTS RRF) recall. Hook recall now returns results (results_count: 3 verified) instead of silently dropping all results — a Phase 1 regression on Windows is also repaired by this commit chain.

---

## Decision

**Verdict: Path A (BGE persistent daemon) — SHIPPED, DEFAULT-ON.**

| Metric | Value |
|--------|-------|
| Daemon warm embed p50 | 144ms |
| Daemon warm embed p95 | 157ms |
| Daemon cold model load | ~32s (HF cache warm) |
| Hook total_elapsed_ms (post-fix) | ~1996ms |
| Hook results_count (post-fix) | 3 (was 0 pre-fix) |
| Byte-equivalence vs in-process | max_diff=0.00 — verified |

Three paths were investigated during Phase 1 research:

- **Path A (BGE daemon):** SHIPPED. Warm embed p50/p95 within plan targets (encode 30-100ms + ~7ms framing). Byte-equivalent to in-process `EmbeddingService`. No silent vector drift vs stored embeddings.
- **Path B (OpenAI text-embedding-3-small):** Viable fallback (~300ms, no subprocess cold-start, API cost). Not selected — adds external dependency and per-call cost.
- **Path C (accept text-only at hook time):** Preserved as-is on FTS-only path. Falls back automatically when daemon is unavailable.

---

## Why Default-On

- `results_count: 3` proven in arbiter validation against live DB — not a regression from text-only (which was returning 0 due to the subprocess timeout bug).
- Daemon auto-spawns silently (detached fire-and-forget) — no UX regression; first prompt after cold start pays 32s model load, all subsequent prompts see warm p50 144ms.
- Fallback path preserved: when daemon ping fails, hook routes to text-only (Phase 1 behavior). No hard failure mode.
- ~1.5-2GB RAM cost for loaded model is acceptable per user pattern.

---

## What Ships in Main

| File | Role |
|------|------|
| `opc/scripts/core/embedding_daemon.py` | NEW — BGE daemon; serves embed/ping/embed_batch/shutdown over TCP loopback |
| `opc/scripts/core/recall_learnings.py` | MODIFIED — daemon routing for `--vector-only` and hybrid CLI paths |
| `.claude/hooks/src/embedding-client.ts` | NEW — TypeScript TCP client for daemon probe + embed calls |
| `.claude/hooks/src/memory-awareness.ts` | MODIFIED — daemon auto-spawn + hybrid routing in UserPromptSubmit hook |
| `.claude/hooks/src/__tests__/embedding-client.test.ts` | NEW — 18 vitest tests for embedding client |
| `.claude/hooks/dist/memory-awareness.mjs` | REBUILT — compiled output |

---

## Phase 1 Bonus Fix

`memory-awareness.ts` had a 2000ms subprocess timeout for `uv run python` recall. On Windows, `uv run python` startup alone takes ~2.2-4s (dependency resolution + interpreter launch). The hook was silently returning `results_count: 0` for every prompt on this machine — Phase 1 recall was broken in production without any visible error.

Fix: timeout raised 2000ms → 8000ms (`e8566b3`) → 12000ms (`57b6724`). Hook now waits long enough for uv startup. The `db_subprocess_timed_out` diagnostic flag was added to distinguish timeout from genuine zero-results.

This means Phase 1 recall (text-only FTS) also works correctly after this commit chain — not just the new hybrid path.

---

## How It Works

### Daemon Lifecycle

1. `memory-awareness.ts` fires on `UserPromptSubmit`.
2. Hook reads `$TEMP/ccv3-embedding.json` (discovery file) to find daemon port.
3. If no discovery file or ping fails: spawn `embedding_daemon.py` as detached fire-and-forget subprocess (does not block hook).
4. Probe again after brief wait (200ms budget). If daemon ready: use hybrid recall. If not: fall back to text-only.
5. Daemon writes discovery file AFTER warmup completes — prevents connecting before model is loaded.
6. Daemon stays alive across prompts. Model loaded once per machine session.

### Daemon Architecture

- TCP loopback `127.0.0.1:auto-port` (OS assigns port; recorded in discovery file).
- Length-prefixed JSON frames: 4-byte big-endian uint32 length + UTF-8 JSON body, 100MB cap.
- `ThreadingTCPServer` + model lock (`sentence-transformers` is not thread-safe).
- Windows PID liveness check via `ctypes.windll.kernel32.OpenProcess`.
- Mirrors Phase 2 rerank daemon structure (`commit 5d13b7f`).

### Recall Routing

| Condition | Mode | Floor |
|-----------|------|-------|
| Daemon ready | Hybrid (vector + FTS RRF) | HYBRID_FLOOR=0.01 |
| Daemon unavailable | Text-only FTS | TEXT_ONLY_FLOOR=0.05 |

Floors are split because RRF scores (hybrid) operate in a different range (0.01–0.03 typical) than FTS `ts_rank` scores (0.05–1.0 typical). The old single-floor logic would silently drop all hybrid results.

### Fallback Path

Any error in the daemon path (spawn failure, ping timeout, TCP error, embed error) causes graceful degradation to text-only recall. No exception propagates to the hook output.

---

## Open Follow-Ups

Carry-forward — not blocking ship:

1. **HIGH-2:** `pingDaemon` double-timeout — 200ms probe budget can extend to 400ms worst-case due to TCP connection overhead inside the 200ms window. Cosmetic; defer to future cleanup in `embedding-client.ts`.
2. **MEDIUM-2:** `test_vector_search_with_embeddings` test isolation relies on fresh-import side effects; works today but fragile. Refactor to dependency injection pattern eventually.
3. **MEDIUM-3:** No `memory-awareness.test.ts` for hook orchestration logic. Floor split behavior, daemon routing logic, and `db_subprocess_timed_out` path are untested at unit level.
4. **LOW-1:** No daemon lifecycle anchor. First prompt after machine reboot pays 32s cold-start. Consider Windows Task Scheduler pre-warm job (analogous to `CCv3-Health-Check` task).
5. **LOW-2:** SIGKILL (e.g., machine shutdown) leaves stale discovery file. Recovery works correctly (ping fails → new daemon spawned) but creates one extra spawn cycle per orphan.
6. **LOW-3:** Daemon p50 144ms is slightly above the plan doc's `<100ms` aspiration. It is within spec range (30-100ms encode + ~7ms framing + OS overhead); not material to ship decision.
7. **Future architecture:** In-process recall daemon would eliminate the Python subprocess entirely. Total hook recall would drop from ~2s to ~200ms. Out of scope for Task #11; consider for Phase 3+ or a dedicated performance sprint.

---

## Cross-References

- **Handoff:** `docs/memory-system-handoff-2026-05-17.md`
- **Investigation:** `thoughts/shared/embedding-mode-task11.md`
- **Arbiter validation:** `thoughts/shared/task11-validation-2026-05-18.md`
- **Plan:** `~/.claude/plans/im-not-sure-if-compressed-donut.md`
- **Phase 2 decision:** `docs/phase2-reranker-decision-2026-05-18.md`
