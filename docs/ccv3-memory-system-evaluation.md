# Evaluation of Current Memory System

**Date:** 2026-05-16
**Subject:** Open-sourcing of pgGraph (Evokoa) — X post by @daleverett, 2026-05-15
**Evaluator perspective:** CCv3 memory system architect
**Note:** This evaluation lives in the plan file because plan mode is active. Recommend moving to `thoughts/shared/pggraph-evaluation-2026-05-16.md` after ExitPlanMode.

## Section 3 (filled in): Our Current Memory System — Ground Truth

Measured directly against the live database, not docs:

**Backend:**
- PostgreSQL 16 in Docker (`continuous-claude-postgres`, 60 MB / 2.84 GB cap)
- Extensions installed: `pg_trgm 1.6`, `plpgsql 1.0`, `vector 0.8.1` (pgvector)
- **No graph extension installed.** No `age`, no `pggraph`.

**Core memory table — `archival_memory`:**
- 1,068 rows across 347 distinct sessions (first entry 2026-01-11, latest 2026-05-15)
- Fields: `id (uuid)`, `session_id`, `agent_id`, `content`, `metadata (jsonb)`, `embedding (vector 1024)`, `created_at`, `project_id`, `scope`
- Indices: HNSW on embedding (cosine, m=16, ef_construction=64) + GIN on `to_tsvector('english', content)` + GIN on metadata jsonb + btree on session/agent/project/scope/created_at
- Embeddings: 1024-dim BGE (local provider)
- Companion: `archival_memory_archived` for deprecated/low-quality entries

**Broader schema (38 tables, 43 foreign keys — implicit graph):**
| Cluster | Tables |
|---|---|
| Memory + sessions | `archival_memory`, `archival_memory_archived`, `sessions`, `continuity`, `file_claims`, `handoffs`, `handoff_trees`, `parking_lot` |
| Agent activity | `agents`, `agent_messages`, `agent_runs`, `agent_skills`, `agent_templates`, `ai_conversations`, `ai_messages` |
| Planning + decisions | `plans`, `decisions` |
| Document/page index | `pageindex_nodes`, `pageindex_trees`, `document_versions`, `yjs_documents` |
| Meetings + agendas | `meetings`, `meeting_series`, `meeting_participants`, `agenda_topics` |
| Workspace + people | `workspaces`, `workspace_members`, `users`, `auth_tokens` |
| Reports + connections | `reports`, `report_sections`, `data_connections` |
| Annotations + audit | `comments`, `mentions`, `highlights`, `audit_log`, `metrics`, `projects` |

**Retrieval methods (current):**
- Hybrid RRF (reciprocal rank fusion) — DEFAULT
- Pure vector (cosine similarity via HNSW)
- Text-only (BM25-style via tsvector GIN)
- Metadata exact-match via jsonb GIN
- **No multi-hop relationship retrieval.** All current retrieval is single-table semantic/textual matching against `archival_memory`.

**Quality / extraction:**
- L0 hook scorer auto-blocks NOISE entries (score <3) before insert
- L0/L1/L2/L3 extraction layers (hooks + pre-compact + session-end + manual)
- 98% of entries auto-extracted; manual stores rare and high-value
- Dedupe at 0.85 cosine similarity
- Types: `WORKING_SOLUTION`, `ERROR_FIX`, `CODEBASE_PATTERN`, `FAILED_APPROACH`, `ARCHITECTURAL_DECISION`, `USER_PREFERENCE`
- Scope tag: `scope:project` vs `scope:global`

**Known gaps relevant to this evaluation:**
- No graph traversal / relationship queries beyond direct FK joins.
- No relationship-distance metric in retrieval.
- No automated lineage tracing (e.g., "which decisions cite this learning?").
- `mentions` table exists but is underused for cross-entity links.

---

## 4.1 Summary of Article (~200 words, neutral)

Evokoa (operational intelligence platform for multi-location enterprises) announced on 2026-05-15 the open-sourcing of pgGraph, a Rust-based PostgreSQL extension for graph traversal. The core design keeps PostgreSQL as the source of truth and builds a compact, derived in-memory index using **compressed sparse row (CSR) arrays** over selected relational tables. When applications or AI agents issue standard SQL queries that require graph operations (shortest path, bounded BFS/DFS, connected components, network discovery), pgGraph intercepts those queries and walks integer arrays — claimed at microsecond latency — bypassing the recursive CTE patterns that traditionally degrade at depth on Postgres. The stated motivation is the assertion that "graph capabilities are going to become a fundamental requirement for the agent era" and that requiring AI startups to adopt a separate, heavy graph database would stall market adoption. The project is alpha (May 2026): core traversal features (BFS/DFS, shortest path, connected components) are usable; memory model for very large enterprise-scale graphs is still being hardened. Distribution is via Docker container plus standard Postgres extension install. SQLite support is on the roadmap. Author Dale Everett positions pgGraph explicitly opposite Gel/EdgeDB — additive rather than schema-replacing.

## 4.2 Relevance Score: **8/10**

Rationale:
- **+** We run the exact PostgreSQL + pgvector stack pgGraph targets. Architecturally drop-in.
- **+** Our schema has 38 tables with 43 foreign keys — already a graph in shape, just no graph traversal layer.
- **+** Our workload is exactly the use case Evokoa names: AI agents needing multi-hop relationship reasoning.
- **+** Adoption cost is low — same database, same source-of-truth, just a derived index.
- **−** We have no documented multi-hop retrieval use cases TODAY. Score isn't 10 because pgGraph solves a problem we haven't proven we have.
- **−** Alpha-stage software, no benchmarks shown, no GitHub URL in the announcement itself.

## 4.3 Novel Information

1. **"Postgres gravity" pattern** — the principle of *adding* graph capabilities *to* Postgres rather than migrating data *out* of it. This is a different mental model than the standard graph-DB pitch and worth tagging as a pattern in its own right.
2. **CSR-array derived index over relational tables** — known technique in numerical computing/SciPy land; novel as a Postgres extension pattern. Suggests the implementation may be more like a kernel-of-pgvector than a typical SQL function library.
3. **Rust-based Postgres extension** — likely built on `pgrx` (formerly pgx) framework. Worth investigating for our own future memory-system extensions.
4. **Explicit anti-positioning vs Gel/EdgeDB and the schema-replacing camp** — clean architectural narrative we could borrow when explaining why we picked pgvector over Weaviate/Qdrant/Pinecone.
5. **Strategic framing: "graph capabilities are fundamental requirement for agent era"** — a thesis statement to track. If correct, it changes what infrastructure agent platforms need to ship.
6. **Evokoa as an org** — not previously in our memory. Operational-intelligence layer for multi-location enterprises. Worth a single-line "who they are" entry.

## 4.4 Overlaps / Reinforcements

- **Validates our stack choice.** pgGraph being purpose-built FOR Postgres reinforces that adopting Postgres + pgvector as agent memory was the right architectural call.
- **Reinforces "Postgres can do it all" pattern** — same logic that informed pgvector adoption, same logic that should inform pageindex-on-postgres, etc.
- **Aligns with "single source of truth + derived indices for performance"** — exactly our pattern: archival_memory is canonical; HNSW + tsvector + jsonb GIN are derived indices for performance.
- **Hybrid retrieval principle** — pgGraph would slot in as a 4th retrieval dimension alongside vector / FTS / metadata. The RRF design extends naturally.
- **Cross-references existing memory:**
  - `ram-eval-2026-04-28`: confirms pg memory footprint is trivial; adding pgGraph wouldn't materially change that at our 1,068-row scale (though CSR index size scales with edge count, not row count).
  - `memory-system-fixes-2026-01-29`: same `continuous-claude-postgres` container is the target.
  - `ram-recovery-docker-wslconfig`: WSL config — pgGraph runs inside the same container, no WSL impact.

## 4.5 Contradictions / Conflicts

| # | Conflict | Severity | Resolution |
|---|---|---|---|
| 1 | Our retrieval is currently flat (single-table semantic + textual), pgGraph encourages relationship-first thinking | LOW | Not a contradiction — a different axis. We can add graph traversal without retiring semantic retrieval. |
| 2 | We've previously evaluated graph-DB needs implicitly negative (we picked pgvector, not Neo4j) | LOW | pgGraph isn't a graph DB — it's a Postgres extension. Earlier "don't adopt Neo4j" reasoning doesn't apply. |
| 3 | Article asserts existing solutions are "too slow" without naming them; Apache AGE specifically is a credible Postgres graph extension that competes directly | MEDIUM | **Action: compare pgGraph vs Apache AGE before any adoption decision.** AGE is more mature, openCypher-based, also extension-form. The omission is a signal of either ignorance (unlikely from sophisticated team) or strategic framing (possible). |

## 4.6 Outdated or Superseded Information

- **Mildly outdated:** `ram-eval-2026-04-28` entry says "archival_memory has 2 rows." Current count is 1,068. Conclusion ("not a meaningful RAM contributor") still holds, but the row count grew 500×. Worth refreshing the learning with `2026-05-16: updated row count to 1,068; conclusion unchanged`.
- **No knowledge superseded by pgGraph itself.** It's additive.

## 4.7 Integration Recommendations

### Immediate Actions (do now)
1. **Add a single new memory entry** (`scope:global`, type=`ARCHITECTURAL_DECISION`):
   > "pgGraph announced 2026-05-15 by Evokoa: alpha Rust Postgres extension adding graph traversal (BFS/DFS, shortest path, connected components) via CSR-derived in-memory index. Postgres stays source of truth — zero migration. Targets AI agent multi-hop reasoning workloads. DO NOT INSTALL YET (alpha, no benchmarks, no GitHub URL in announcement). Re-evaluate at GA. Compare against Apache AGE before any adoption. Watch for: license clarity, benchmarks vs recursive CTE, benchmarks vs AGE, production stability reports."
2. **Refresh the April pgvector RAM eval entry** with current row count (1,068 rows / 347 sessions).
3. **Find the actual GitHub repository URL** (not provided in the announcement) and record it in the new entry once located.

### Suggested New Tags
- `#PostgresGraphExtension` — for any Postgres-extension graph work (covers pgGraph, AGE, future)
- `#GraphRAG` — for graph-based retrieval patterns
- `#AgentMemoryArchitecture` — for memory-design-level decisions
- `#PostgresGravity` — the "add to Postgres, don't migrate out" pattern as a tag in its own right
- `#Watchlist` — for promising-but-not-ready tools we want to revisit

### Knowledge Graph Updates (proposed nodes/edges for when we DO have graph traversal)
- Node: `pgGraph` (tool, alpha, 2026-05-15)
- Node: `Evokoa` (org, operational-intelligence, multi-location)
- Node: `Apache AGE` (tool, alternative, more mature)
- Node: `CSR (Compressed Sparse Row)` (technique, numerical computing)
- Node: `pgrx` (framework, Rust Postgres extensions)
- Edge: `pgGraph` --[targets]--> `AI Agent Multi-hop Reasoning`
- Edge: `pgGraph` --[complements]--> `pgvector`
- Edge: `pgGraph` --[alternative_to]--> `Apache AGE`
- Edge: `pgGraph` --[uses_technique]--> `CSR`
- Edge: `pgGraph` --[likely_built_on]--> `pgrx`
- Edge: `pgGraph` --[author_org]--> `Evokoa`

### Archiving / Deprecation
- None required.

### Open Questions for Future Research
1. **What's the GitHub repo URL?** (Announcement said "find it on Github" but no link.)
2. **What's the license?** ("100% free and open-source, forever" — but Apache 2.0? MIT? AGPL? Matters.)
3. **How does it compare with Apache AGE on our schema?** (Same install path, both extensions.)
4. **Memory cost of the CSR index at our scale?** (~1k rows is trivial, but if extension's index includes pre-computed transitive closure that could grow.)
5. **What's the latency vs Postgres recursive CTE on a 4-hop query over our `archival_memory → session → handoffs → handoff_trees` chain?**
6. **What pgGraph DDL looks like — column type requirements? Junction-table mandates?**
7. **Multi-tenant story** — can pgGraph indices be scoped (`scope:project` vs `scope:global`) the way our memory is?

## 4.8 Potential Risks / Biases

| Risk | Nature | Mitigation |
|---|---|---|
| Vendor incentive | Evokoa is a commercial startup; "free forever" announcements can change (e.g., Sentry, MongoDB, Elastic license shifts) | Read the actual license. Plan for fork if rug-pulled. |
| Marketing language overshadowing technical merit | "Postgres gravity," "agent era," "humanity's movement towards AI native" are framing, not evidence | Discount narrative; demand benchmarks before adoption |
| No comparison to Apache AGE | Notable omission — AGE has been a Postgres graph extension since 2020 | Run head-to-head before adoption decision |
| No benchmarks shown | "Microseconds" and "avoid recursive SQL traps" are unverified claims | Benchmark on our schema before committing |
| Alpha stage | Author explicitly says "alpha" and "still hardening the memory model" | Don't run in any path where data integrity matters |
| Implementation language | Rust extension means crashes can take Postgres down | Wait for production-stability reports |
| Selection bias in social signal | Twitter announcement amplifies founder voice; counter-perspectives unlikely in same thread | Sample Hacker News, r/postgres, and pgGraph issue tracker before adopting |

## 4.9 Confidence Assessment

**Overall confidence: 78%.**

Strong:
- The article content is accurately summarized.
- Our memory-system ground truth was measured directly from the live database, not from documentation.
- The architectural-fit analysis is rooted in the actual schema (38 tables, 43 FKs, no graph extension currently installed).
- The risk and bias analysis is conservative and explicit.

Where additional sources would help:
- **Direct read of the pgGraph GitHub repo** (license, README, test suite, build) — would push confidence to 90%+.
- **Independent benchmarks vs Apache AGE and recursive CTEs** — required before any adoption recommendation.
- **Community reception** (Hacker News thread, r/postgres, Twitter critical responses, GitHub issues) — would surface known issues.
- **Verification that announcement claims match committed code** — typical alpha gap.
- **Evokoa's funding / runway** — if they go under, the project's maintenance posture matters.

## 4.10 Proposed Memory Update Diff

```diff
+ NEW archival_memory entry [scope:global, type=ARCHITECTURAL_DECISION]
+   session: pggraph-eval-2026-05-16
+   content: "pgGraph announced 2026-05-15 by Evokoa: alpha Rust PostgreSQL extension
+     adding graph traversal (BFS/DFS, shortest path, connected components) via CSR-
+     derived in-memory index over relational tables. Postgres remains single source
+     of truth — zero data migration. Targets AI agent multi-hop reasoning workloads.
+     STATUS: alpha, no benchmarks shown, GitHub URL not in announcement.
+     RECOMMENDATION: don't install yet; re-evaluate at GA; compare vs Apache AGE
+     before any adoption decision. Watch: license, benchmarks vs recursive CTE,
+     production stability reports."
+   tags: pgGraph, PostgresGraphExtension, GraphRAG, AgentMemoryArchitecture,
+         PostgresGravity, Watchlist, Alpha, Evokoa

~ UPDATE archival_memory entry [session:ram-eval-2026-04-28]
~   add note: "2026-05-16 refresh: archival_memory now has 1,068 rows across 347
~     sessions (vs '2 rows' at original measurement). Container still ~60 MB —
~     RAM-pressure conclusion unchanged but row count grew ~500×."

? FUTURE entry (only if we adopt pgGraph)
?   "Adopted pgGraph for archival_memory multi-hop queries. Schema changes: [list].
?    Benchmark vs recursive CTE on 4-hop query: [results]. Migration: additive only,
?    no data movement. Operational notes: [crash recovery, version-pin strategy]."
```

---

## **Final Recommendation**

> **🔄 Partial update required — Watchlist entry, no installation yet.**
>
> pgGraph aligns architecturally with our PostgreSQL + pgvector memory system and would augment (not replace) our retrieval. The "Postgres gravity" pattern is a strong fit for our 38-table, 43-FK relational graph. But pgGraph is alpha, has no benchmarks shown, doesn't engage with Apache AGE (the obvious mature competitor), and we have no documented multi-hop retrieval use case that demands it today.
>
> **Action:** Add one new memory entry (watchlist), refresh one existing entry (row-count update), and propose an Apache AGE vs pgGraph evaluation as the next research thread. **Do not install pgGraph until: (a) GA release, (b) explicit license confirmed, (c) head-to-head vs Apache AGE on our schema demonstrates a meaningful advantage, (d) we have an identified multi-hop query our hybrid retrieval can't already serve well.**

---

## Suggested Next-Session Actions

After ExitPlanMode, the user can:
1. Move this evaluation to `thoughts/shared/pggraph-evaluation-2026-05-16.md` for proper artifact archiving.
2. Run the two memory updates listed in 4.10 (new entry + refresh).
3. Queue follow-up research thread: **"Apache AGE vs pgGraph on our archival_memory schema — multi-hop benchmark."**
4. Track the pgGraph GitHub repo for: license file, first benchmark publication, GA announcement.

---

# Combined Architectural Synthesis: Graphify + pgGraph vs Current Memory System

**Date:** 2026-05-16
**Trigger:** User request to review the Notion page "Graphify MCP Integration (CCv3)" (planned 2026-04-14, never executed) alongside the pgGraph evaluation above.
**Question:** How should we modify our memory/knowledge system given both options on the table?

## State of Play (measured ground truth)

| Layer | What we have today | What's missing |
|---|---|---|
| Storage | PostgreSQL 16 + pgvector 0.8.1, 38 tables, 43 FKs, 1,068 rows in `archival_memory` | No graph-extension installed (pg_extension shows only pg_trgm, plpgsql, vector) |
| Retrieval | Hybrid RRF (vector + tsvector FTS + jsonb metadata + btree); HNSW cosine; dedup at 0.85 | No multi-hop traversal; no relationship-distance metric; no lineage tracing |
| Ingestion | Hook-driven L0–L3 auto-extraction from sessions; manual stores rare | **No multimodal ingestion** — can't process PDFs, screenshots, audio, video |
| Visualization | None (knowledge-tree.json is structural, not graph-style) | No HTML graph viz, no community detection, no "god node" topology insights |
| Code intelligence | TLDR CLI (AST), Serena (LSP), Nia (external repo RAG) | No code+docs+media unified graph |

**Graphify status:** decision-approved 2026-04-14 ("INTEGRATE narrow scope") but **never executed** — `~/.mcp.json` / `~/.claude/mcp.json` / `~/.claude.json` all contain no graphify entry; `pip show graphifyy` returns "not found". A month of decision-decay.

**pgGraph status:** evaluated above. Alpha. Watchlist. Don't install yet.

## Critical Distinction: Graphify ≠ pgGraph

| Dimension | Graphify | pgGraph |
|---|---|---|
| **Layer** | Application (Python process) | Database (Postgres extension) |
| **Input** | Multimodal artifacts: code, PDFs, markdown, screenshots, video, audio | Relational tables in Postgres |
| **Output** | NetworkX graph in memory + serialized to disk + HTML viz + report | SQL-accessible BFS/DFS/shortest-path over existing tables |
| **Algorithms** | tree-sitter AST extraction (23 langs) + faster-whisper transcription + Claude subagent reasoning + Leiden clustering + community detection | CSR-array graph index over relational schema; classic graph traversals |
| **Persistence** | Local files | Same Postgres DB |
| **Latency** | Slow ingestion (LLM-heavy); query is fast (NetworkX in-memory) | Microsecond traversal (claimed) |
| **Maturity** | v0.4.12, 25k★, MIT, 6+ months stable | Alpha, May 2026 |
| **CCv3 install cost** | One MCP entry + pip install + per-project graph build | Postgres extension install + DDL + index build |
| **Gap it fills for us** | **Multimodal ingestion** (PDFs/audio/screenshots → graph) | **Multi-hop relational traversal** (lineage, shortest path between learnings, community detection on existing schema) |

These are **two non-overlapping layers**. Adopting one doesn't preclude or substitute for the other.

## Synergy Potential (longer-term)

A unified architecture could plug them together:

```
[Raw artifacts: /raw folders, PDFs, recordings]
              │
              ▼
[Graphify ingestion: tree-sitter + whisper + Claude subagents]
              │
              ▼
[Extract entities + relationships]
              │
              ├──▶ Local NetworkX graph (default Graphify output)
              │
              └──▶ Postgres tables (custom adapter — not built yet)
                              │
                              ▼
                  [archival_memory + new node/edge tables]
                              │
                              ▼
              [pgGraph traversal: AI agent multi-hop queries]
```

**This synergy doesn't exist out-of-the-box.** Graphify writes NetworkX, not Postgres. We'd need a custom adapter — premature to build until we know we want it.

## Architectural Options

### Option A — Execute Graphify integration NOW (per existing plan)
- Install Graphify as MCP only (skip skill + hook per the original decision)
- Use on projects with `/raw` mixed-artifact folders
- 2–3 trial runs, then re-evaluate (Phase 3 of the original plan)
- Keep pgGraph on watchlist
- **Effort:** 30 min install + ongoing usage time
- **Risk:** Low. Decision was already vetted in 2026-04-14 oracle review. MIT-licensed, mature.
- **Wins:** Multimodal ingestion capability we currently lack. Community detection over local graphs. Validates whether multimodal-graph adds value in our actual workflows.
- **Lose:** Python dep added to MCP fleet. Per-graph build cost via Claude subagents.

### Option B — Do nothing, wait
- Graphify integration continues to sit unexecuted
- pgGraph stays watchlist
- Current memory system continues
- **Effort:** Zero
- **Risk:** Zero in the short term; decision-decay risk in the long term (we'll re-debate the same Graphify choice every quarter)
- **Wins:** No new dependencies
- **Lose:** No new capabilities; multimodal ingestion gap persists

### Option C — Bigger play: design unified knowledge graph architecture upfront
- New Postgres tables: `graph_nodes(id, type, label, metadata, embedding)`, `graph_edges(source_id, target_id, relation_type, weight, metadata)`
- Graphify adapter to write into those tables instead of (or in addition to) NetworkX
- pgGraph (when GA) traverses those tables
- Integrate with existing `archival_memory` via FK or embedding similarity
- **Effort:** Multi-week design + implementation. Requires pgGraph to ship.
- **Risk:** High. Designing for a tool (pgGraph) that hasn't even left alpha.
- **Wins:** Coherent long-term architecture
- **Lose:** Premature. Building on alpha software. Custom adapter maintenance.

### Option D — Execute Graphify + design table schema NOW that's compatible with eventual pgGraph
- Install Graphify per Option A
- Concurrently: define `graph_nodes` / `graph_edges` schema and have Graphify write to it via a thin adapter
- pgGraph slots in later when GA, no rework needed
- **Effort:** Option A effort + ~1 day of schema design + adapter
- **Risk:** Medium. Designing schema for a tool that might never GA; adapter maintenance burden.
- **Wins:** Doesn't waste the integration; lays groundwork for graph traversal
- **Lose:** May design wrong schema if pgGraph requirements differ from assumed; over-engineering for current need

## Recommendation: **Option A** (with explicit revisit gate)

Reasoning:
1. **The Graphify decision is already a month stale.** Either execute it or formally close it. "Planned" status sitting for 30+ days is technical debt of a different kind — undermines decision-making credibility.
2. **Graphify is mature** (v0.4.12, 25k stars, MIT, stable). pgGraph is alpha. Different risk profiles deserve different responses.
3. **Multimodal ingestion is a real gap.** TLDR/Serena/Nia don't process PDFs, audio, or screenshots. Graphify fills that gap with zero overlap.
4. **Option C/D are premature.** Designing a Postgres graph schema *for pgGraph* before pgGraph proves itself is exactly the kind of speculative architecture that ages badly.
5. **Decision symmetry:** Treat Graphify and pgGraph independently. Execute the mature one; watchlist the alpha one. Revisit jointly when pgGraph reaches GA.

## Execution Plan (Option A)

### Phase 1 — Install (30 min)
1. `pip install graphifyy` OR `uv tool install graphifyy` (verify which the repo recommends — README check)
2. Verify the stdio MCP server runs: `graphify mcp --help` or equivalent
3. Add to `~/.mcp.json` with Windows `cmd /c` wrapper (per `.claude/rules/windows-platform.md`):
   ```json
   "graphify": {
     "command": "cmd",
     "args": ["/c", "graphify", "mcp"]
   }
   ```
   (Exact command-line discovered after install; adjust as needed.)
4. Restart Claude Code session; confirm `mcp__graphify__*` tools surface
5. **Skip:** `graphify claude install` (would install PreToolUse hook conflicting with our 67-hook stack — explicitly excluded by original 2026-04-14 plan)
6. **Skip:** the bundled `/graphify` skill (would duplicate our skill router)

### Phase 2 — Trial uses (1–2 weeks of opportunistic usage)
- Use on the first project that surfaces with a `/raw` folder of mixed artifacts
- Run a graph build, inspect HTML viz + report
- Compare insights vs what TLDR/Serena/Nia/manual review would have produced
- Track time-to-insight and Claude subagent token cost per build

### Phase 3 — Decision gate (after 2–3 trial uses)
Criteria to KEEP:
- At least 1 insight surfaced from multimodal data that we wouldn't have gotten from TLDR/Serena/Nia
- Time-to-insight ≤ 30 min from `/raw` folder to readable report
- Cost ≤ ~$2 per graph build (Claude subagent extraction cost)

If KEEP: write a memory entry (`ARCHITECTURAL_DECISION`) confirming the choice and document recommended usage patterns. Re-open Option D (unified schema) for evaluation.

If DROP: uninstall, write a `FAILED_APPROACH` memory entry with the specific reasons it didn't deliver.

### Files / paths to touch
- `~/.mcp.json` (add graphify entry — Node atomic write per windows-platform.md)
- `.claude/rules/cli-integration-strategy.md` (add Graphify row to the MCP server table)
- New memory entry on completion
- Notion page status update: `Planned → In Progress` then `In Progress → Done` or `Dropped`

## Critical Files / References

- Notion source: https://www.notion.so/innovativemusings/Graphify-MCP-Integration-CCv3-34276fd7ac828195b3adf38653b8982b
- Graphify repo: https://github.com/safishamsi/graphify
- Graphify PyPI: https://pypi.org/project/graphifyy/
- Graphify landing: https://graphify.net/
- pgGraph evaluation: previous section of this plan file
- Current memory ground truth: Section 3 of pgGraph evaluation (38 tables, 1,068 rows, etc.)
- Existing MCP rules: `.claude/rules/cli-integration-strategy.md`, `.claude/rules/windows-platform.md`, `.claude/rules/nia-first-external.md`, `.claude/rules/opencli-first.md`

## Memory Updates Proposed

```diff
+ NEW archival_memory entry [scope:global, type=ARCHITECTURAL_DECISION]
+   session: graphify-pggraph-synthesis-2026-05-16
+   content: "Architectural synthesis 2026-05-16: Graphify (MIT, v0.4.12, 25k★)
+     and pgGraph (alpha, May 2026) are non-overlapping layers — Graphify is
+     application-level multimodal ingestion → NetworkX graph; pgGraph is
+     Postgres extension for fast multi-hop traversal over relational tables.
+     DECISION: execute the 2026-04-14 Graphify integration plan (MCP-only,
+     narrow scope, skip skill + hook); keep pgGraph on watchlist until GA.
+     Do NOT design unified pgGraph-compatible schema yet — premature.
+     Revisit jointly when pgGraph reaches GA."
+   tags: Graphify, pgGraph, MCPIntegration, KnowledgeGraph, MultimodalIngestion,
+         AgentMemoryArchitecture, PostgresGraphExtension, AppliedSynthesis

± UPDATE Notion page status (after Phase 1 install): Planned → In Progress
± UPDATE Notion page status (after Phase 3 decision): In Progress → Done / Dropped
```

---

## **Final Synthesis Recommendation**

> **🔄 Execute Graphify integration (Phase 1) now. Keep pgGraph on watchlist. Don't design unified schema yet.**
>
> The two tools occupy different layers and address different gaps. Graphify is mature and the integration decision is a month stale — execute or formally close it. pgGraph is alpha and addresses a gap (multi-hop traversal) we haven't proven we need. Designing an integrated schema upfront would be speculative architecture against an alpha tool's assumed requirements.
>
> Concrete next actions: install graphifyy, register MCP server, trial on a `/raw`-folder project, re-evaluate after 2–3 uses.
