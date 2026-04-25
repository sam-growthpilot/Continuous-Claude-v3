# SYSTEM-ROADMAP — Internal Infrastructure

This roadmap tracks **internal/system** work on Continuous Claude (CCv3): hooks, skills, agents, memory, observability, sync. Product/feature work lives in `ROADMAP.md`.

The two roadmaps are intentionally separate. Mixing them obscures progress and pollutes the goal-promotion hooks.

---

## Active Goal

**System Coherence — 5-Phase Plan** (started 2026-04-25, branch `feature/system-coherence`)

Source plan: `~/.claude/plans/i-have-a-new-abstract-quail.md`

Reliability > latency. Paranoid review > speed. Goal: every hook, skill, and agent fires reliably with the correct context.

| Phase | Status | Description |
|-------|--------|-------------|
| 1 — Telemetry + Hygiene Foundation | in_progress | Hook-trace tracer, weekly digest, adaptive canary timeout, memory dedup backfill, doc drift fixes, this file |
| 2 — Per-Hook Cleanup Audit | pending | Read-and-classify all 60 zombie .mjs + 31 source-only files. No bulk delete. Preserve sentry/linear placeholders |
| 3 — Structural Reorganization | pending | `src/lib/` for shared modules; frontmatter `kind` field for every hook (gate / injector / orchestrator / telemetry) |
| 4 — Memory + Routing Reliability | pending | Split `session-start-parallel`; raise memory-recall threshold; preview-then-inject; embed-and-match skill router; tree + bridge health checks |
| 5 — Agent/Skill Composition Design | pending | Scout map, architect design doc, tool-tier policy. **No refactoring** — design only, gated by user approval |

---

## Done Criteria (whole work)

All four signals green:

- [ ] Health check exits 0 end-to-end (no WARNs that aren't intentional like `STUB-NEEDED-LATER`).
- [ ] Hook telemetry shows zero silent failures over a 7-day window post-Phase-4.
- [ ] Memory recall noise is measurably reduced (proactive matches per session is lower; subjective relevance is up).
- [ ] This file shows the next active goal.

---

## Decision Log

19 architectural decisions captured during the 5-round interview. Full table is in the source plan; cliff notes:

| # | Topic | Decision |
|---|-------|----------|
| 1 | Hook style | Stay specialized (one hook per concern) |
| 2 | TLDR daemon | Commit — make canonical |
| 3 | session-start-parallel | Rewrite first into 2 hooks |
| 4 | Shared modules | Move to `src/lib/` |
| 5 | Hook telemetry | Build it with full coverage |
| 6 | Cleanup scope | Audit first, decide per-hook |
| 7 | Memory mode | Both — raise threshold AND preview-then-inject |
| 8 | Rollback pace | 4 commits, panic-revert ready |
| 9 | Skill routing | Embed-and-match via BGE |
| 10 | Tool-tier policy | Adopt + audit |
| 11 | Hook scope | Codify gate vs orchestrator |
| 12 | create-better-skills | Deprecated; skill-forge canonical |
| 13 | Agent vs skill | Dedicated Phase 5 + design doc |
| 14 | Tree health | Add freshness + completeness |
| 15 | Bridge health | Add bridge health checks |
| 16 | ROADMAP scope | Two ROADMAPs (this is the system one) |
| 17 | Canary timeout | Adaptive — P95 × 2 |
| 18 | Memory dedup | Backfill, keep newest |
| 19 | Done criteria | All four signals green |

---

## Tracked Backlog (post-current-goal)

When the current goal completes, promote one of these to `## Active Goal`:

1. **RLM Production Adoption** — adopt Recursive Language Models as a targeted capability. MVP-ready: `rlms` library wrapper at `opc/scripts/core/rlm_client.py`, Docker sandbox `continuous-claude/rlm-sandbox:3.11` (image already built and verified), `max_depth=1`, `min_context_chars=300_000`. Pilot on PageIndex large-doc TOC extraction. Plan content preserved in the source plan file's "Open Items" section.
2. **Agent/Skill Execution** — emerges from Phase 5 design doc. Estimated 2-3 days once approved.
3. **Hook re-stale root cause hardening** — sync-to-active.sh has been fixed (commit `c0fe795`); add a regression test that fails if `hooks/src/` ever appears in `SYNC_DIRS` again.
4. **`tools:` field on 7 agents** — minor health WARN; fix in Phase 2 or as standalone hygiene.
5. **`qlty` CLI configuration** — exit=1 on health check; LOW priority.
6. **Documentation drift sweep** — beyond the Phase 1 fixes (help, wiring, ARCHITECTURE), do a full pass on cross-references that age out.

---

## Conventions

- Each phase produces one commit (or a small chain) on `feature/system-coherence`.
- Health check between phases — never start phase N+1 with a non-green check from phase N.
- Update this file when phase status changes; the goal-promotion hooks read it.
- `git remote` convention: `origin = parcadei` (never push), `fork = Rev4nchist` (always push).

---

*Created 2026-04-25 as part of Phase 1 of the System Coherence plan.*
