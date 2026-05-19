# Project Roadmap

## Current Focus

**Phase 2 follow-ups + Task #11 polish** — clean up carry-forward items from both shipped stories before committing to Phase 3 (Graphiti + FalkorDB graph memory layer).

Priority order:
1. Phase 2 follow-ups: clean 42/42 reranker re-run (Docker stable required), MEDIUM-1..5 from critic 3.1, unit tests for `rerank.py`
2. Task #11 polish: HIGH-2 `pingDaemon` double-timeout, MEDIUM-2 test isolation fragility, MEDIUM-3 missing `memory-awareness.test.ts`
3. Phase 3 kickoff once above are resolved or explicitly deferred

## Completed
- [x] Memory System — Task #11 BGE embedding daemon shipped default-on (2026-05-18) — hook-time hybrid recall enabled, Phase 1 Windows timeout regression repaired. Commits: `36b241a` `0f12c43` `3912209` `e8566b3` `57b6724`
- [x] Memory System — Phase 2 follow-ups + Task #11 hook-time recall path (2026-05-19)
- [x] [fix](memory) hook subprocess timeout + test isolation + timeout diagnostic (2026-05-18) `e8566b3`
- [x] [fix](memory) mode-aware floor split (hybrid 0.01, text-only 0.05) (2026-05-18) `3912209`
- [x] Memory System Upgrade — Phase 2: Cross-encoder reranker shipped opt-in (2026-05-18) — NDCG@5 +110% lift; P95 latency 95s/5s fails 500ms gate; `--rerank` stays opt-in. Commits: `31169eb` `5d13b7f` `4f97be3` `b6cc578` `4d4dbff` `f40e4e2` `83d1308`
- [x] [fix](memory) correct rerank bench percentile + bump eval daemon timeout (2026-05-18) `83d1308`
- [x] [feat](memory) add NDCG@5 + latency eval harness for Phase 2 reranker (2026-05-17) `b6cc578`
- [x] [feat](memory) add Stage-2 cross-encoder reranker (Phase 2) (2026-05-17) `5d13b7f`
- [x] [test](memory) add Phase 2 recall eval set (42 query→relevant-id pairs) (2026-05-17) `511c246`
- [x] Memory System Upgrade — Phase 1 hardening (types, retrieval, agent recall, temporal) (2026-05-17) `e8444e6`
- [x] Diagnose & Remediate System Memory Pressure (AFK 50% → 99% Growth) (2026-05-16)
- [x] Plan — Headless 360 is live, what we ship next (2026-05-14)
- [x] [feat] manifest-driven hub with sidebar ToC, filters, status pills, OG meta, breadcrumbs (2026-05-13) `85f0e84`
- [x] [fix](continuous-claude-architecture) point footer source links at GitHub-rendered diagrams (2026-05-13) `187d4c2`
- [x] CCv3 Interactive Architecture Visualization (2026-05-13)
- [x] Add continuous-claude-architecture deck (2026-05-13) `5eebe29`
- [x] Resolve stashed hook simplification — `git stash list` shows `stash@{0}: deferred: hook simplification + sync-to-active.sh (pre-existing staged work, not kusto-cli scope)`. Stashed 2026-05-04 to clear the kusto-cli PR. 12 files: 11 `.claude/hooks/src/*.ts` + `.claude/scripts/sync-to-active.sh`. Net: ~590 deletions, 112 insertions (~478 net). Originated in the `claude/lucid-hellman` worktree alongside `stash@{1}: dist-noise-from-prior-esbuild`. Inspect via `git stash show stash@{0} --stat`; recover via `git stash pop stash@{0}`. Decide: ship as a separate PR, discard, or keep parked. (2026-05-12)
- [x] CCv3 Interactive Architecture Visualization (2026-05-12)
- [x] Diagnose & Remediate System Memory Pressure (AFK 50% → 99% Growth) (2026-05-12)
- [x] Add foundry-hosted-agents deck (2026-05-12) `bb3e498`
- [x] Adjust `ebr-presentations/CLAUDE.md` for Brinker / iQ360 (2026-05-12)
- [x] [fix](kusto-cli) apply self-review findings (factual + coverage + structural) (2026-05-04) `8d9a6a0`
- [x] [feat](kusto-cli) integrate Microsoft Kusto.Cli for KQL queries (2026-05-04) `183fe58`
- [x] [fix](health_check) fail loudly when hook-trace file is unreadable (2026-04-30) `b43accf`
- [x] [fix](misc) wizard quoting + hook-trace readability + dedup test cleanup (2026-04-30) `38b37bb`
- [x] PR #3 CodeRabbit Review — Remediation Plan (2026-04-29)
- [x] [test](memory-isolation) Phase 1 fix-up - commit recall scope acceptance tests (2026-04-29) `0acbb1a`
- [x] [test](plan-to-ralph) bump test timeouts to 15s for Phase 4 isolation tests (2026-04-29) `c5e3426`
- [x] [fix](stress-harness) Phase 5 - fix vitest + skill-eval exit-code parsing (2026-04-29) `61a6757`
- [x] [fix](coordination) Phase 4 - scope file_claims and hook state by project (2026-04-29) `331ce8b`
- [x] [fix](session-start) Phase 3 - warn on .claude skip + extend hasCodeFiles() (2026-04-29) `b9ec375`
- [x] [fix](hooks) Phase 2 - replace hardcoded user paths with os.homedir() (2026-04-29) `a495931`
- [x] [feat](memory-isolation) Phase 1 - filter recall by project_id (2026-04-29) `ebbcc95`
- [x] CCv3 System Coherence Stress Test — Comprehensive Suite (2026-04-28)
- [x] [refactor](memory-remediation) Phase 5 - lazy_tree.invalidate writes stale marker, never deletes (2026-04-28) `8b109dd`
- [x] [feat](memory-remediation) Phase 4A - route v1 store_learning through v2 quality gate (2026-04-28) `58d1da1`
- [x] CCv3 Memory System Remediation Plan (2026-04-27)
- [x] CCv3 Final System Review — Pre-Next-Task Verification (2026-04-27)
- [x] [docs](cleanup) Commit A -- archive MEMORY.md + strip drifty counts (2026-04-27) `0b00cf7`
- [x] [fix](rlm) route large prompts via stdin to avoid Windows argv overflow (2026-04-27) `5028903`
- [x] [fix](phase-5c) pre-push review followups (R5 completion + cleanup) (2026-04-27) `2aa0c57`
- [x] [docs](phase-5c) R4 sentinel<->browser-dev-cycle xref + R8 deployer neonctl awareness (2026-04-26) `3cb9aa8`
- [x] CCv3 System Coherence — Comprehensive Plan (2026-04-26)
- [x] [feat](phase-4) activate dormant tree+memory daemons; add tldr daemon health check (2026-04-26) `f80013f`
- [x] [feat](health-check) bridge category - skill present, page IDs stable, MCP configured (2026-04-26) `a285b52`
- [x] [feat](memory-awareness) raise proactive-injection floor (Phase 4.1) (2026-04-26) `ad27e9b`
- [x] [refactor](hooks) move 5 LIB modules to src/lib/ (Phase 3) (2026-04-26) `c90bf02`
- [x] [docs](phase-2) hook audit script + decisions doc (read-only) (2026-04-26) `61589a7`
- [x] CCv3 System Coherence — Comprehensive Plan (2026-04-26)
- [x] [feat](health-check) adaptive canary timeout (P95x2, floor 90s, ceiling 300s) (2026-04-26) `ed495a9`
- [x] [refactor](memory) canonicalize SKILL.md as single source, stub the 4 rule files (2026-04-24) `31e3670`
- [x] [feat](health-check) weekly system health audit with Notion dashboard integration (2026-04-24) `c766fcf`
- [x] [feat](rlm) production wrapper for Recursive Language Models with Docker sandbox (2026-04-24) `a72da5f`
- [x] Recursive Language Models (RLM) — Production Adoption Plan (2026-04-24)
- [x] Fix `permission-auto-allow` Hook: Unblock AskUserQuestion in Plan Mode (2026-04-23)
- [x] [feat] backfill V2 -- scan Fourth AI project pages for dated activity (2026-04-23) `47ca3b4`
- [x] [fix] declaw ralph-delegation-enforcer to stop blocking agents (2026-04-23) `1e30ac9`
- [x] [fix] em-dash regex in backfill + add REPO_PATHS override for outliers (2026-04-23) `837cb86`
- [x] [feat] backfill-tracker script + initial dry-run plan (2026-04-23) `6b3a4f4`
- [x] [feat] add collect_weekly_work_tracker + mark_published MCP tools (2026-04-23) `4583640`
- [x] [feat] restructure as multi-week report archive (2026-04-17) `f25df6d`
- [x] RAM Recovery Plan — Minimal-Disruption Actions (2026-04-16)
- [x] Add GTM status presentations: risk report Apr 16 (2026-04-16) `e4d65e9`
- [x] System Resource Recovery Plan (2026-04-15)
- [x] Integrate `openai/codex-plugin-cc` into CCv3 (2026-04-15)
- [x] Add CLAUDE.md with mandatory hub-update instructions for new decks (2026-04-11) `1ebae90`
- [x] Remove enablement flag from Pages workflow (2026-04-11) `cc7d52a`
- [x] Consolidate 6 decks into grouped landing page (2026-04-11) `3b64def`
- [x] Multi-Presentation Repo Pattern (2026-04-11)
- [x] Fix Cowork Plugin Upload + Full Audit Results (2026-04-11)
- [x] Add GitHub Pages deployment workflow (2026-04-09) `51732a4`
- [x] EBR Processor Project Setup + Zendesk Integration Consolidation (2026-04-07)
- [x] [fix] use sse transport type for fourth-playwright MCP connector (2026-04-02) `7f3df8a`
- [x] Zendesk Ticket Integration for EBR Builder (2026-04-02)
- [x] Eliminate Excessive Permission Prompts for Autonomous Agent Tasks (2026-04-02)

## Planned
_No planned items yet._

## Recent Planning Sessions
### 2026-05-16: Planning Session
### 2026-05-15: Diagnose & Remediate System Memory Pressure (AFK 50% → 99% Growth)
**Key Decisions:**
- `Live Boost Process Governor` task currently **Running**.
- 8 SmartScan scheduled tasks: (one per weekday + base + Mon-Sun). Hardware/registry scans during AFK can spike memory.
- `.wslconfig` at `C:\Users\david.hayes\.wslconfig` correctly caps at 3 GB, 4 procs, 4 GB swap, `autoMemoryReclaim=gradual`.
- `CCv3-Blocklist-Update` — daily 9 AM (last run succeeded 5/12 9:00).
- `CCv3-Health-Check` — weekly Friday 8:03 AM.

### 2026-05-14: Plan — Headless 360 is live, what we ship next
**Key Decisions:**
- `salesforce_mcp/hosted_mcp/client.py`: — `list_tools()` returns `[]`, `call_tool()` raises `NotImplementedError`. The whole proxy is a stub.
- ✅ **Headless 360 enabled* — confirmed by admin.
- ✅ **Token Exchange Handler registered on the ECA* — admin meeting 2026-05-07 closed it. The Step 0 spike below validates this end-to-end.
- Confirmed scope decisions: *
- OBO ships before Phase 6 Railway deploy.: Per-user identity all the way down from day one — the audit story matches the build plan §3 value prop. Step 3 is on the critical path, not deferred.

### 2026-05-13: CCv3 Interactive Architecture Visualization
**Key Decisions:**
- `continuous-claude-explained` → also broken (same root cause; user didn't annotate it but the relative path is identical structure)
- Edit the master `<footer>` block with the 4 new absolute URLs + `target="_blank" rel="noopener"`.
- `git add` deployed copy + `git commit` in `ai-enablement-decks` with message `fix(continuous-claude-architecture): point footer source links at GitHub-rendered diagrams`.
- Wait ~20s; `gh run list --repo Rev4nchist/ai-enablement-decks --limit 1` to confirm `success`.
- Reload https://rev4nchist.github.io/ai-enablement-decks/continuous-claude-architecture/ in a browser; inspect the footer to confirm new `href` values are present.

### 2026-05-12: CCv3 Interactive Architecture Visualization
**Key Decisions:**
- Visual reference: dark theme matching the Dave Jeffery / ToDesktop screenshot — black/navy background, color-coded nodes, yellow highlight for the active flow path, flow list with descriptions on the right, numbered step cards below.
- Vanilla HTML/CSS/JS — no React, no build step, no npm dependencies
- Flow click → toggle `.active` on edges + nodes belonging to that flow, render step list
- File Edit + Coordination: — file-claims hook → check PG → claim or warn
- Knowledge Tree Regen: — tree-invalidate marks stale → session-start-init-check rebuilds
