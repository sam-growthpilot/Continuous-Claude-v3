# CCv3 Lean Audit — Intent vs Reality vs Actual Usage

**Date:** 2026-05-30
**Method:** Maestro orchestration — 5 parallel scout auditors (Context/Huge-Info, Hooks, Skills+Agents, MCP, Workflows/PM) → synthesis.
**Posture:** Balanced (remove confirmed-dead, archive maybe-dead reversibly, consolidate duplicates). **Audit + plan only — nothing executed without per-item approval.**
**Lens (user's framing):** components must be *set up correctly* AND *used correctly*. The goal is a lean foundation for all agentic work, with **context & huge-info management** as the first priority.

---

## 0. Critical data correction (read first)

An earlier scan in this session used `pg_stat_user_tables.n_live_tup` (a stale autovacuum *estimate*) and reported `archival_memory=3`, `pageindex_nodes=0`. The **authoritative `SELECT count(*)`** shows:

| Table | Stale estimate | **Authoritative count** |
|---|---|---|
| `archival_memory` | 3 | **569** (+184 archived ≈ 753 total) |
| `pageindex_trees` | 0 | **177** |
| `pageindex_nodes` | 0 | **2,418** |
| `sessions` | 17 | **1,117** |
| `file_claims` | 10 | **6,720** |

**Implication:** Memory and the homegrown PageIndex DB are *populated*, not empty. The real gaps are reliability and verified-value, not absence. Lesson: always `count(*)`, never trust `pg_stat` estimates for usage decisions.

> The `@pageindex/mcp` MCP server removed earlier this session is the **hosted Vectify PDF product** (the `localhost:8090` OAuth popup) — a *different* system from the homegrown DB-backed PageIndex pillar. That removal stands (zero usage, was the popup).

---

## 1. Executive summary — the 6 themes

1. **Intent-vs-reality gaps are real and pervasive** (your instinct was right) — but the headline "memory is empty" was a measurement artifact. The genuine gaps are below.
2. **Per-prompt cost is heavy.** 13 hooks fire on every UserPromptSubmit, 2 spawn heavy Python subprocesses (memory recall ~9–12s, skill-activation `uv run`), injecting ~700–1,400 chars/prompt. Several "conditional" hooks still spawn a process to check state.
3. **Drift/fragility is structural.** The `sync-to-active.sh` rebuild-from-stale-src footgun is **live** (`architecture-stats-sync.ts` already diverged). A stale Ralph state injects phantom "work in progress" noise on every session/prompt.
4. **Enforcement theater.** `ralph-delegation-enforcer` has been *advisory-only since 2026-04-23* (never blocks) while RULES.md still claims it blocks code edits during Ralph.
5. **Redundancy + dead weight.** Byte-identical duplicate skills, deprecated-but-present skills, structural-FAIL skills, ghost directories, project-specific agents in the global dir, 2 unused MCP servers + 6 duplicate MCP entries.
6. **Context/huge-info strategy is fragmented.** Memory works but is unreliable; TLDR warm-cache is a no-op loop; RLM unused since Apr 23; knowledge-tree is populated with *test-artifact paths*; PageIndex navigator's value is uninstrumented.

---

## 2. PRIORITY PILLAR — Context & Huge-Information Management

### Current reality (per Auditor A, VERIFIED unless noted)

| Component | Set up? | Used as intended? | Evidence |
|---|---|---|---|
| **Memory (DB recall)** | YES | **MOSTLY** | 569 rows w/ embeddings; 193 hook fires, **53 injections (27.5%; 36% recently)**; BGE daemon up 65% of fires; **32% subprocess timeouts**, ~9–12s latency |
| **Memory (agent-side recall)** | WIRED | **NO** | `agent-recall.jsonl` has 1 test-only entry — agents (kraken/spark/architect) run blind |
| **TLDR warm-cache** | WIRED | **NO** | No `meta.json` ever created → `isCacheStale()` loops true forever; hook no-ops every session |
| **RLM** | YES | **NO** | Last run 2026-04-23 (smoke + 1 arch-audit); nothing since |
| **Knowledge tree** | YES (fresh) | **PARTIALLY** | Tree regenerates, but components point at `test-screenshots/routes`, `spark-frontend-experiment/nexus/oauth` — *noise, not real CCv3 structure* (visible live in this session's injected context) |
| **PageIndex (homegrown)** | YES (177 trees/2,418 nodes) | **UNVERIFIED** | navigator hook fires every prompt; no logging to confirm DB-query path vs static fallback |
| **Research MCPs (Nia/context7/Exa)** | YES (Nia/ctx7), Exa http | **UNVERIFIED** | wired + rule-guided; zero telemetry (acceptable for on-demand tools) |

### The lean correct strategy (target)

1. **Memory = primary persistence.** It works — make it *reliable*: persistent BGE daemon (kill the 35% down-time), fail-fast under ~3s instead of 9–12s, and **activate agent-side recall** (highest-value gap — your most consequential work runs blind).
2. **TLDR = primary large-code navigation, on-demand.** Remove the broken warm-cache hook; `tldr structure/impact/search` are fast enough live. (Net: one fewer SessionStart hook + ends a no-op loop.)
3. **RLM = the explicit large-overflow tool, dormant.** Keep the Docker image; document it as *the* answer for 300K+ char corpora; revisit when a real overflow case appears. Don't pretend it's in active rotation.
4. **Knowledge tree = fix quality once.** Regenerate continuous-claude's tree from a real component description (Memory / Hooks / Agents / Skills / Workflows / Observability), not test-dir discovery. Then it earns its per-tool injection.
5. **PageIndex (homegrown) = instrument, then decide.** Add one log line: query-hit vs static-fallback. If it always falls back, archive the pillar (~7,100 LOC + 4 hooks reclaimed). If it's used, keep + improve. **Decision deferred to evidence** — do not archive blind.

---

## 3. Cross-cutting findings (all auditors)

### 3a. Per-prompt hot path (Auditor B)
- **13 UserPromptSubmit hooks**, sequential, ~62s cumulative timeout budget (~15–20s typical). Heavy: `memory-awareness` (9–12s subprocess), `skill-activation-prompt` (`uv run`).
- **Dead-weight injector:** `pageindex-navigator` emits ~400 chars of static NAVIGATOR boilerplate on every non-casual prompt (the routing hints already live in CLAUDE.md).
- **Spawn-to-no-op:** `ralph-watchdog`, `ralph-progress-inject`, `ralph-retry-reminder` each read Ralph state every prompt even when Ralph is inactive; `sentry-error-context` (matcher `""`) fires with no Sentry org; `braintrust_hooks.py` starts Python even when tracing off.

### 3b. Drift / fragility (Auditors B, E)
- **`sync-to-active.sh` footgun — LIVE.** `SYNC_DIRS` excludes `hooks/src`, but the script then runs `npm run build` against the *stale active src*, which can delete freshly-synced dist files. Confirmed: `architecture-stats-sync.ts` is in repo src but **missing from active src** → next sync-with-build silently drops that hook. **Fix:** default `--skip-build` (dist is already synced from repo) or remove the build step.
- **Stale Ralph state — `ccv3-visualization`.** `session.active=true`, 11/11 tasks done, 3+ days old. Injects "WORKFLOW RECOVERY AVAILABLE" + "RALPH SESSION ACTIVE" + a progress bar across **3 hooks every session/prompt**. Root cause: `session-deactivate` never auto-called on completion. Plus a logic bug: `session-start-recovery.ts:125` checks `totalTasks>0` instead of `completedTasks<totalTasks`.

### 3c. Enforcement theater (Auditor E)
- `ralph-delegation-enforcer` = **advisory-only since 2026-04-23** (can't tell orchestrator from sub-agent on shared session_id). RULES.md / `plan-to-ralph-enforcement.md` still claim it *blocks*. Either restore blocking (via `CLAUDE_AGENT_ID`) or correct the docs. (`plan-to-ralph-enforcer` and `maestro-enforcer` **do** block correctly.)

### 3d. Redundancy & dead weight (Auditors C, D)
- **Skills (140 active dirs):** `skill-creator` is byte-identical to `skill-forge`; `create-better-skills` self-marked DEPRECATED; `claude-in-chrome` deprecated (rule says don't use); structural-FAIL (missing scripts): `agentica-claude-proxy/-infrastructure/-server`, `excalidraw-mcp`, `wiring`; ghost dir `tdd-migration-pipeline` (marked archived in eval, dir present); **14 `math/*` skills wired in skill-rules.json but living in `archive/math/`** (broken routing); orphan artifacts `create-better-skills.bak`, `skill-rules.json.backup`. Active-but-unwired: `recall`, `remember`, `qa-test`, `qa-suite`, `full-test-suite`, `hook-audit`, `post-ship-audit`, `stale-scan`.
- **Agents (39):** `quant-analyst`, `risk-officer`, `paper-trader` are vibe-trading-specific but sit in the global dir; `liaison`, `surveyor` have no workflow reference (possibly dead).
- **MCP (12 stdio + 6 http + 8 cloud):** `next-devtools` and `idearalph` (skill archived) unused; 6 servers duplicated across `.mcp.json` AND `.claude/mcp.json` (lower-priority copies are dead config); **Neon Bearer token hardcoded plaintext in `.claude.json`** (security); `excalidraw` Express port 3002 collides with NorthStar dev server; `git`/`fetch` lack `cmd /c` wrapper; `gong` has no skill/rule (investigate).

---

## 4. Ranked execution plan (balanced, reversible)

Effort: S(mins) / M(hours) / L(day+). Risk: all reversible unless noted.

### P0 — Immediate, near-zero risk, high value
| # | Action | Why | Effort | Source |
|---|---|---|---|---|
| 1 | `session-deactivate` the stale `ccv3-visualization` Ralph state | Kills 3 phantom "work in progress" injections per session/prompt | S | E |
| 2 | Make `--skip-build` the default in `sync-to-active.sh` (or remove the build step) | Stops silent reversion of dist-only hook fixes (live divergence exists) | S | B |
| 3 | Regenerate continuous-claude knowledge-tree from a real component description | Tree currently injects test-artifact paths every tool call | S | A/E |

### P1 — Lean the per-prompt hot path
| # | Action | Why | Effort | Source |
|---|---|---|---|---|
| 4 | `pageindex-navigator`: add hit-vs-fallback logging + skip when DB count is 0 / not useful | ~400 chars/prompt of static boilerplate; also yields the data for the §2.5 decision | S–M | A/B |
| 5 | Merge the 3 Ralph UserPromptSubmit hooks into 1 with early-exit when no `.ralph/state.json` | 2 fewer process spawns/prompt | M | B |
| 6 | Early-exit guards: `sentry-error-context` (no `SENTRY_ORG`), `braintrust_hooks.py` (no key), fold `user-confirmation-detector` into `smarter-everyday` | Removes spawns on most prompts | M | B |

### P2 — Context pillar reliability (priority)
| # | Action | Why | Effort | Source |
|---|---|---|---|---|
| 7 | Memory: persistent BGE daemon + fail-fast (<3s) recall | Cuts the 32% timeout / 35% daemon-down | M–L | A |
| 8 | Memory: activate agent-side recall (`agent-recall-injector` fires for agent Task calls) | Agents run the highest-value work blind today | M | A |
| 9 | TLDR: remove the broken warm-cache hook; use on-demand | Ends an infinite no-op loop; one fewer SessionStart hook | S | A |
| 10 | RLM: document as the explicit large-overflow tool; keep dormant | Honest status; no infra cost | S | A |
| 11 | PageIndex homegrown: decide AFTER #4 instrumentation (keep+improve OR archive ~7,100 LOC) | Evidence-gated, not blind | — | A/B |

### P3 — Dedupe / dead-code / hygiene
| # | Action | Effort | Source |
|---|---|---|---|
| 12 | Archive `skill-creator`, `create-better-skills`, `claude-in-chrome`; delete `*.bak` + `skill-rules.json.backup`; remove `tdd-migration-pipeline` ghost dir; reconcile `math/*` (move to `skills/math/` or drop from rules); wire `recall`/`remember`/`qa-*`/`hook-audit`/`post-ship-audit`/`stale-scan` into skill-rules.json | M | C |
| 13 | Move vibe-trading agents to that project; investigate `liaison`/`surveyor`; archive structural-FAIL skills (agentica-*, excalidraw-mcp, wiring) or restore their scripts | M | C |
| 14 | **Security:** move Neon token to `${NEON_API_KEY}` (Node atomic write to `.claude.json`); remove `next-devtools` + `idearalph` MCP; dedupe the 6 servers in `.claude/mcp.json`; fix excalidraw port; add `cmd /c` to git/fetch; investigate `gong` | M | D |

### P-docs — Truth in docs
| # | Action | Effort | Source |
|---|---|---|---|
| 15 | Fix `RULES.md` / `plan-to-ralph-enforcement.md`: ralph-delegation-enforcer is advisory-only (or restore blocking) | S | E |
| 16 | Fix `session-start-recovery.ts:125` logic (`completedTasks < totalTasks`) so finished stories stop showing as "recovery available" | S | E |

---

## 5. Already done this session
- **tldr SessionStart console-popup** — fixed (`tldr warm .`, no shell, no `--background`, detached + `windowsHide`); repo+active src+dist.
- **`@pageindex/mcp` server (hosted PDF popup)** — removed from all 5 config locations (2 mcp.json, template, 2 settings.json). Homegrown PageIndex pillar untouched.

## 6. Healthy systems — keep as-is (no action)
Memory schema, cross-terminal coordination (1,117 sessions / 6,720 claims, working), `maestro-enforcer` + `plan-to-ralph-enforcer` + `file-claims` (correctly blocking), ROADMAP Completed auto-sync, handoffs (32 dirs, active), Serena, the review/debug/test agent clusters (genuinely differentiated), the active research MCPs (Nia/context7/Exa/github/playwright/serena), the package-install-guard supply-chain hook.

---

*Generated by Maestro audit. Recommend executing P0→P1 first (cheap, high-signal), then re-measuring before P2/P3.*
