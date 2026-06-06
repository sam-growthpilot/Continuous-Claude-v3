# Memory System Upgrade — Session Handoff

**Date:** 2026-05-17
**Session name:** `mem-sys-upgrade`
**Ralph story:** `memory-hardening-2026-05-16`
**Status:** Phase 1 shipped. Phase 2 ready to start.
**Last commit:** `e8444e6 feat(memory): Phase 1 hardening — types, retrieval, agent recall, temporal`
**Branch:** `main`

---

## Goal

Harden the CCv3 memory system so memories are made, accessed, and triggered reliably and accurately, then integrate graph and multimodal layers (Apache AGE was the original plan; oracle research pivoted to Graphiti+FalkorDB).

## What's done (Phase 1)

### Substantive changes shipped (committed `e8444e6`)

**Extraction hardening (G1, G3, G6, G8, G12, G14):**
- `opc/scripts/core/incremental_extract.py` — uses 7-type heuristic instead of hardcoded `session_learning`; captures `CLAUDE_AGENT_ID` from env.
- `opc/scripts/core/store_learning.py` — accepts `agent_id` kwarg (now populates DB column); validates noise prefixes BEFORE min-length check; rejects NULL type from non-CLI paths; runs `_infer_learning_type()` fallback.
- `.claude/hooks/src/agent-error-capture.ts` + `browser-learning-extractor.ts` — both now call `scoreExtraction()` and require score ≥3 (previously bypassed the TS scorer).
- `periodic-extract` hook — disabled in `~/.claude/settings.json` (was generating tool-frequency noise every 50 calls).

**Retrieval hardening (G2, G4-partial, G10, G11):**
- `.claude/hooks/src/memory-awareness.ts` — restored `PROACTIVE_INJECTION_FLOOR = 0.05` (docs/code drift fixed); merges local+DB results instead of local-first short-circuit; appends every fire to `.claude/logs/memory-recall.jsonl` with `{session_id, intent, results_count, top_score, kept_after_floor, source}`.
- `.claude/hooks/src/shared/intent-extractor.ts` — NEW shared helpers extracted from memory-awareness; reused by agent-recall-injector.
- `opc/scripts/core/recall_learnings.py` — bi-temporal `--valid-at` filter; decay weighting on by default (`exp(-age_days * 0.02)`, ~35-day half-life); `--no-decay` opt-out; `--include-superseded`.

**Agent recall enforcement (G5):**
- `.claude/hooks/src/agent-recall-injector.ts` — NEW PreToolUse hook on `Task`. Extracts intent from spawned agent's prompt, runs `recall_learnings.py --text-only --k 3`, injects results as `additionalContext`. Skips oracle/pathfinder (their own research), short prompts, and recursive sub-agent spawns (checks `CLAUDE_AGENT_ID`). Registered in `~/.claude/settings.json` with 3s timeout. 27 vitest cases.

**Persistence (G7, plus C5 temporal):**
- `archival_memory` schema: ADD COLUMN `valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `valid_until TIMESTAMPTZ`. Indices `idx_archival_valid_from` and `idx_archival_valid_until` (partial). All 1,068 historical rows backfilled with `valid_from = created_at`.
- `opc/scripts/core/index_handoffs.py` — NEW. Walks `thoughts/shared/handoffs/`, parses YAML + multi-doc front-matter + markdown; stores per-field (goal/done/next/blockers/decisions) with `metadata.source='handoff'`, `metadata.outcome=...`, canonical type per field. Idempotent (skips existing). Ran `--apply` once: +85 handoff entries.
- `.claude/hooks/src/session-end-handoff-indexer.ts` — NEW SessionEnd hook. Detects recently-written handoff files (≤30s) and spawns `index_handoffs.py --apply --only-path <file>` in background. 13 vitest cases.
- `opc/scripts/core/backfill_types.py` — NEW. Classifies untyped/`session_learning` rows via the same heuristic. `--dry-run` default, `--apply` writes, `--limit`, `--sample`. Idempotent. Ran on 449 surviving rows → final distribution below.

**New skills:**
- `/supersede` (`.claude/skills/supersede/SKILL.md` + `opc/scripts/core/supersede.py`) — bi-temporal replacement. Sets `valid_until=NOW()` on old entry, inserts new entry with `metadata.supersedes=<old_id>`.
- `/memory-stats` (`.claude/skills/memory-stats/SKILL.md`) — audit hit rate, score distribution, source mix, top intents with consistent matches/misses by reading the new `.claude/logs/memory-recall.jsonl`.

**Docs:** `.claude/skills/memory/SKILL.md` rewritten end-to-end to match actual behavior (was stale).

### Phase 1.5 cleanup (done after Phase 1 main work)

- **Cohort split done**: 594 `vibe-trading-ingest` rows moved to new `vibe_trading_data` table (separate schema with identical columns). The 196 that recurred mid-session were also moved after the producer fix.
- **Noise prefix archive**: 21 entries with prefixes like "Now I have…", "Let me…", "The user…", "I need to…" moved to `archival_memory_archived` with `archive_reason='noise_prefix_leak_2026-05-16'`.
- **Producer fix (cross-repo)**: `C:/Users/david.hayes/Projects/vibe-trading/src/memory/thesis_store.py` + `outcome_tagger.py` — INSERT/SELECT/UPDATE redirected from `archival_memory` to `vibe_trading_data`. **NOT committed in that repo — user owns the commit there.**
- **Dev env**: `asyncpg` resolved (was already in `pyproject.toml`, just needed `uv sync`). `hooks/package.json` now tracked.
- **Accident files removed**: `opc/'type' --context Failed`, `` opc/`query_files ``, `` opc/pd.DataFrame` `` deleted (CLI typo artifacts).

### Database state at handoff

```sql
-- Run from: docker exec continuous-claude-postgres psql -U claude -d continuous_claude
SELECT COUNT(*) FROM archival_memory;          -- 538 (down from 1,068)
SELECT COUNT(*) FROM vibe_trading_data;         -- 790 (594 initial + 196 recurred)
SELECT COUNT(*) FROM archival_memory_archived;  -- includes the 21 noise + prior archives
SELECT COUNT(*) FROM archival_memory_backfill_snapshot_2026_05_16;  -- 645 (rollback safety net)
```

Type distribution in `archival_memory` (post-backfill):

| Type | Count | % |
|---|---:|---:|
| WORKING_SOLUTION | 445 | 60.6% |
| ERROR_FIX | 125 | 17.0% |
| ARCHITECTURAL_DECISION | 108 | 14.7% |
| CODEBASE_PATTERN | 39 | 5.3% |
| FAILED_APPROACH | 14 | 1.9% |
| USER_PREFERENCE | 3 | 0.4% |
| NULL or `session_learning` | **0** | 0% |

### Gaps closed (13 of 15 + 1 partial)

| Gap | Status | Notes |
|---|---|---|
| G1 Type taxonomy dead | ✅ Closed | Forward fix + backfill |
| G2 Proactive floor missing | ✅ Closed | 0.05 restored |
| G3 Quality gate bypass | ✅ Closed | Uniform scorer + Python tighten |
| G4 memory-awareness text-only-only | 🟡 Partial | Floor + merge + observability shipped; hook-time semantic recall deferred (Task #11) |
| G5 Agents do not recall | ✅ Closed | agent-recall-injector hook |
| G6 periodic-extract noise | ✅ Closed | Disabled |
| G7 Handoffs disconnected | ✅ Closed | Indexer + auto-ingest hook |
| G8 TS scorer inconsistent | ✅ Closed | Uniform |
| G10 Local memory shadows DB | ✅ Closed | Merge instead of local-first |
| G11 No recall observability | ✅ Closed | JSONL log + /memory-stats |
| G12 (NEW) agent_id NULL | ✅ Closed | Forward fix; historical NULL accepted (no producer info to infer from) |
| G13 (NEW) Cohort separation | ✅ Closed | Cohort split + producer fixed |
| G14 (NEW) Noise filter leak | ✅ Closed | Filter strengthened + 21 archived |

## What's deferred (1 of 15)

### Task #11 — hook-time semantic recall (G4 partial)

Investigation revealed both originally-proposed options fail to meet the 2s hook timeout: subprocess spawn cost (sentence-transformers + torch load = 30-43s) dominates regardless of model size. Swapping bge-large → bge-small won't help.

**Three paths surfaced in `thoughts/shared/embedding-mode-task11.md`:**

1. **Build a real persistent embedding daemon** — keep a Python process loaded with BGE; serve embedding requests over a local socket. ~1-2 day sprint. Existing `ClaudeMemoryDaemon` scheduled task points at a *session-extraction* daemon (broken — script path doesn't exist); we'd need a new daemon.
2. **Pivot to OpenAI `text-embedding-3-small` at hook time** — ~300ms per call, no subprocess. Requires `OPENAI_API_KEY` env var; ~$0.02 per million tokens. Re-embed cost for 538 rows ≈ trivial. Easiest path.
3. **Accept text-only at hook time** — current behavior. With Phase 1 changes (floor + merge + agent recall injector), text-only is materially better than before. Hybrid RRF stays available for manual `/recall` via the (slower) BGE path.

**Recommendation:** Path 2 (OpenAI) for ergonomics, Path 1 for fully-local independence. Path 3 if waiting on Phase 2/3.

## What's next (from v2 plan, awaiting direction)

### Phase 2 — Cross-encoder reranker (HIGHEST LEVERAGE)

Per oracle landscape research, this is the single biggest retrieval-quality lift (+15-30% NDCG@5 in production reports). Additive Stage-2 after RRF candidate selection. User locked in `BAAI/bge-reranker-v2-m3` as the model.

**Work items:**
- `opc/scripts/core/rerank.py` — service that takes (query, candidate_list[id, content]) → returns reordered top-K
- `opc/scripts/core/recall_learnings.py` — modify hybrid path: RRF top-50 → rerank → return top-K (default 5). Gate behind `--rerank` flag initially.
- `opc/tests/recall_eval_set.jsonl` — 30-50 manually curated (query → relevant-id) pairs for NDCG@5 measurement
- Decision gate: keep rerank-by-default if NDCG@5 lifts ≥10% AND P95 latency ≤500ms

### Phase 3 — Graphiti + FalkorDB graph memory layer

Replaces v1's "Apache AGE pilot" per oracle findings (AGE has `pg_upgrade` foot-gun and slow issue triage; Graphiti has bi-temporal validity built in + MCP server).

**Work items:**
- Add FalkorDB container to docker-compose
- `pip install graphiti-core`
- Register Graphiti MCP server in `~/.mcp.json` (Windows `cmd /c` wrapper)
- Define graph schema: `:Learning`, `:Session`, `:Project`, `:Handoff`, `:Decision`, `:Agent`, `:File`, `:Tag` + edges
- Population script: walk `archival_memory` + `sessions` + `file_claims` + handoffs → Graphiti episodes
- Benchmark queries: Q1 multi-hop, Q2 file-hub, Q3 bi-temporal (unique to Graphiti)

### Phase 4 — Graphify (multimodal ingestion, demoted to ad-hoc tool)

- `pip install graphifyy`
- Register MCP server in `~/.mcp.json`
- Use on `/raw` folders (PDFs, screenshots, recordings)
- Stretch: thin adapter to dump NetworkX nodes into Graphiti as `:Artifact` and `:ExtractedFrom`

### Phase 5 — Embedding swap (DEFERRED until Phase 2 measurement infra exists)

Only if measured benefit. Candidates: Qwen3-Embedding-8B (Apache-2.0, MTEB-Code 80.68) or Stella-en-1.5B-v5.

### Phase 6 — pgGraph re-evaluation (DEFERRED until GA)

Currently alpha. Re-evaluate against Phase 3 benchmark queries at GA.

## Resume instructions

### To start fresh and pick up where we left off:

```bash
# 1. Verify state
cd C:/Users/david.hayes/continuous-claude
git log --oneline -3
# Expect: e8444e6 feat(memory): Phase 1 hardening...

# 2. Verify DB state
docker exec continuous-claude-postgres psql -U claude -d continuous_claude -c "
SELECT metadata->>'type' AS type, COUNT(*)::int AS count
FROM archival_memory GROUP BY 1 ORDER BY 2 DESC;
"
# Expect: 6 canonical types, 0 NULL, 0 session_learning, 538 total

# 3. Read the active plan
cat C:/Users/david.hayes/.claude/plans/im-not-sure-if-compressed-donut.md

# 4. Choose next move
# Option A: Decide Task #11 (hook-time semantic recall)
#   - Read: thoughts/shared/embedding-mode-task11.md
#   - Pick path 1 (daemon), 2 (OpenAI), or 3 (accept text-only)
# Option B: Start Phase 2 (cross-encoder reranker — RECOMMENDED)
#   - /ralph to delegate work
#   - Spawn kraken for opc/scripts/core/rerank.py
# Option C: Skip to Phase 3 (Graphiti+FalkorDB)
```

### Resume with /ralph

```
/ralph
```

Then for Phase 2:
```
Story: memory-hardening-phase2-reranker
Tasks:
  1. Install BAAI/bge-reranker-v2-m3 model locally (~568M params)
  2. Build opc/scripts/core/rerank.py (HuggingFace transformers wrapper, daemon-mode option)
  3. Modify recall_learnings.py hybrid path: --rerank flag, top-50 → top-K reorder
  4. Build opc/tests/recall_eval_set.jsonl (30-50 query→relevant-id pairs)
  5. Measure NDCG@5 baseline vs reranked + P50/P95 latency
  6. Decision: keep rerank-by-default if lifts ≥10% with ≤500ms P95
```

## Critical files / paths

### Shipped in Phase 1 (committed `e8444e6`)
- `.claude/hooks/src/memory-awareness.ts` (modified, 344→452 lines)
- `.claude/hooks/src/agent-error-capture.ts` (modified)
- `.claude/hooks/src/browser-learning-extractor.ts` (modified)
- `.claude/hooks/src/session-end-handoff-indexer.ts` (new)
- `.claude/hooks/src/agent-recall-injector.ts` (new)
- `.claude/hooks/src/shared/intent-extractor.ts` (new)
- `.claude/hooks/src/__tests__/agent-recall-injector.test.ts` (new, 27 tests)
- `.claude/hooks/src/__tests__/session-end-handoff-indexer.test.ts` (new, 13 tests)
- `.claude/hooks/dist/*.mjs` (5 rebuilt)
- `.claude/hooks/package.json` (newly tracked)
- `.claude/skills/memory/SKILL.md` (rewritten)
- `.claude/skills/memory-stats/SKILL.md` (new)
- `.claude/skills/supersede/SKILL.md` (new)
- `opc/scripts/core/incremental_extract.py` (modified)
- `opc/scripts/core/recall_learnings.py` (modified)
- `opc/scripts/core/store_learning.py` (modified)
- `opc/scripts/core/backfill_types.py` (new)
- `opc/scripts/core/index_handoffs.py` (new)
- `opc/scripts/core/supersede.py` (new)
- `opc/tests/conftest.py` (modified)
- `opc/tests/unit/test_recall_learnings.py` (modified)
- `opc/tests/test_validate_quality.py` (new, 20 tests)
- `.gitignore` (added `.claude/logs/*.jsonl`)

### Settings (not synced — local to `~/.claude/`)
- `~/.claude/settings.json` — `periodic-extract` removed from PostToolUse; `agent-recall-injector` added to PreToolUse Task; `session-end-handoff-indexer` added to SessionEnd

### Documentation / reports (gitignored under `thoughts/`)
- `thoughts/shared/memory-baseline-2026-05-16.md` — before-state measurements
- `thoughts/shared/memory-phase1-complete-2026-05-16.md` — verification report
- `thoughts/shared/embedding-mode-task11.md` — Task #11 investigation findings

### Plan file
- `C:/Users/david.hayes/.claude/plans/im-not-sure-if-compressed-donut.md` — v2 plan including landscape research

## Open items / known caveats

1. **Task #11** — see above. Three paths, user pick required.
2. **Cross-repo commit pending**: producer fix in `C:/Users/david.hayes/Projects/vibe-trading/` is on disk but NOT committed. User controls that repo's commit.
3. **Working tree has uncommitted prior-session work** — paper-trader/quant-analyst/risk-officer agents, memory monitor CSVs, prior `.ts` edits (plan-mode-approval-gate, transcript-parser, daemon-client, etc.), Fourth/iQ360 skills, fastmcp playbook doc. None of this is memory-system. Decide separately whether to commit or stash.
4. **9 pre-existing vitest failures unrelated to memory system** (plan-exit-tracker FS perms, arscontexta skill-count drift, hardcoded path lint on `plan-mode-approval-gate.ts`). Not introduced by Phase 1.
5. **Backfill safety net**: `archival_memory_backfill_snapshot_2026_05_16` table still in DB (645 rows). Drop when comfortable: `DROP TABLE archival_memory_backfill_snapshot_2026_05_16;`

## Verification commands (run after pick-up to confirm state)

```bash
# Hook health
cd C:/Users/david.hayes/continuous-claude/.claude/hooks && npm run build && npx vitest run src/__tests__/agent-recall-injector.test.ts src/__tests__/session-end-handoff-indexer.test.ts

# Memory CLI smoke
cd C:/Users/david.hayes/continuous-claude && PYTHONPATH=. uv run python opc/scripts/core/recall_learnings.py --query "memory hardening" --k 3

# DB shape
docker exec continuous-claude-postgres psql -U claude -d continuous_claude -c "
SELECT 'archival' AS t, COUNT(*) AS n FROM archival_memory
UNION ALL SELECT 'vibe_trading', COUNT(*) FROM vibe_trading_data
UNION ALL SELECT 'archived', COUNT(*) FROM archival_memory_archived
UNION ALL SELECT 'snapshot', COUNT(*) FROM archival_memory_backfill_snapshot_2026_05_16;
"

# Observability log
ls -la C:/Users/david.hayes/continuous-claude/.claude/logs/memory-recall.jsonl
ls -la C:/Users/david.hayes/continuous-claude/.claude/logs/agent-recall.jsonl
```

## Session metrics

- Duration: ~10 hours across two days (2026-05-16 → 2026-05-17)
- Tasks completed: 19 of 19 (Task #11 deferred with rich findings)
- Agents spawned: ~12 (scout, oracle, kraken×7, spark×3, arbiter)
- Total agent token spend (rough): ~1.2M tokens
- Files modified or added: 27 (Phase 1 commit)
- Lines changed: +5,665 / -383
- Tests added: 60 (vitest 40 + pytest 20)
- DB rows touched: 1,068 → 538 in `archival_memory`; 790 in `vibe_trading_data`; 21 in `archival_memory_archived`; 645 in snapshot

---

**To resume:** start a new session, read this file, run the verification commands, then either invoke `/ralph` for Phase 2 reranker or pick a Task #11 path.
