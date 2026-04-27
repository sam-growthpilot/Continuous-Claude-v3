# Agent & Skill Map — CCv3
Generated: 2026-04-26 | Branch: feature/system-coherence

## Counts

| Entity | Count |
|--------|-------|
| Agents (repo) | 33 |
| Skills (active, repo) | 109 |
| Global-only agents | 0 |
| Global-only skills | 0 |
| Repo skills NOT in global | 2 (find-skills, vercel-cli) |
| Hook files (src) | 100 |
## Agents

| Name | Model | Purpose | Key Tools | Skill Mentions | Mentioned-By Skills |
|------|-------|---------|-----------|----------------|---------------------|
| aegis | (inherit) | Security audit | Bash, Read, Glob, Grep, WebFetch | security | release |
| agent-factory | (inherit) | Scaffold new agents | Write, Read, Bash, Glob, Grep | — | — |
| architect | (inherit) | System design and planning | Read, Glob, Grep, Write, Bash | — | build, refactor, migrate, maestro |
| arbiter | (inherit) | Test execution and validation | Bash, Read, Glob, Grep | — | fix, build, refactor, release, tdd |
| atlas | (inherit) | Test suite runner and reporter | Bash, Read, Glob, Grep | — | release |
| braintrust-analyst | (inherit) | Braintrust eval analysis | Bash, Read | braintrust-tracing | — |
| critic | (inherit) | Code review (critical lens) | Read, Glob, Grep | — | review |
| debug-agent | (inherit) | Bug investigation and root cause | Bash, Read, Glob, Grep | systematic-debugging | fix, maestro |
| deployer | (inherit) | Vercel/Railway/Sentry deployments | Bash, Read | vercel-cli, railway-cli, sentry-cli | release, build |
| diagnose | (inherit) | Deep diagnostic analysis | Bash, Read, Glob, Grep | — | fix |
| herald | (inherit) | Changelog and release notes writer | Write, Read | — | release |
| kraken | (inherit) | Complex implementation via TDD | Bash, Read, Glob, Grep, Write | — | fix, build, refactor, tdd, maestro |
| maestro | (inherit) | Multi-step orchestration conductor | Task, Bash, Read, Glob, Grep, Write | maestro | maestro |
| onboard | (inherit) | Project onboarding | Read, Glob, Grep, Bash | onboard | — |
| oracle | (inherit) | External research (web/docs/APIs) | WebFetch, WebSearch, Bash, Read | exa, opencli, github-search | fix, build, migrate, maestro |
| phoenix | (inherit) | Refactor strategy and brownfield analysis | Read, Glob, Grep, Write | — | refactor, migrate |
| plan-agent | (inherit) | Implementation planning | Read, Glob, Grep, Write | create_plan (BROKEN PATH) | refactor, migrate, release |
| plan-reviewer | (inherit) | Plan quality gate | Read | — | refactor, review |
| principal-reviewer | (inherit) | Senior engineer code review | Read, Glob, Grep | — | (none — undiscoverable) |
| profiler | (inherit) | Performance profiling | Bash, Read, Glob, Grep | — | build, maestro |
| ralph | (inherit) | Autonomous dev orchestrator | Task, Bash, Read, Glob, Grep, Write | ralph | ralph |
| react-perf-reviewer | (inherit) | React performance review | Read, Glob, Grep | react-perf | — |
| review-agent | (inherit) | Synthesis code reviewer | Read, Glob, Grep | — | review, release |
| scribe | (inherit) | Documentation and handoffs | Write, Read | create_handoff, continuity_ledger | release, maestro |
| scout | (inherit) | Codebase exploration and mapping | Read, Glob, Grep, Bash | — | build, fix, explore, migrate, maestro |
| session-analyst | (inherit) | Session outcome analysis | Bash, Read | — | — |
| sleuth | (inherit) | Deep bug forensics | Bash, Read, Glob, Grep | systematic-debugging | fix |
| spark | (inherit) | Lightweight fixes and quick tweaks | Bash, Read, Glob, Grep, Write | — | fix, build |
| surveyor | (inherit) | Migration scope assessment | Read, Glob, Grep, Bash | — | migrate |
| ui-compliance-reviewer | (inherit) | UI/UX standards compliance review | Read, Glob, Grep | ui-audit | — |
| validate-agent | (inherit) | Validates agent/task output quality | Read, Bash | — | — |
| wizard | (inherit) | CCv3 setup and configuration | Bash, Read, Write | — | — |
## Skills

### Workflow Orchestrators (14 skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| build | build, implement, feature, greenfield, brownfield | Full feature build pipeline | scout, oracle, architect, kraken, spark, profiler, arbiter, deployer | Yes (architect+kraken) |
| fix | fix, bug, broken, failing, error, debug | Bug resolution pipeline | sleuth, debug-agent, diagnose, spark, kraken, arbiter | Yes (sleuth+spark) |
| explore | explore, understand, map, architecture | Codebase exploration | scout | Yes (scout) |
| ralph | /ralph, autonomous, GSD | Autonomous dev orchestrator | ralph | Yes (ralph) |
| maestro | /maestro, orchestrate, multi-step | Multi-agent orchestration | maestro, architect, kraken, spark, oracle, scout, debug-agent, profiler, scribe | Yes (maestro) |
| refactor | refactor, restructure, reorganize | Refactor pipeline | phoenix, plan-agent, kraken, plan-reviewer, arbiter | Yes (phoenix+kraken) |
| migrate | migrate, migration, upgrade, port | Migration pipeline | oracle, phoenix, plan-agent, kraken, surveyor | Yes (phoenix+surveyor) |
| release | release, ship, deploy, launch | Release pipeline | aegis, atlas, review-agent, herald, scribe, deployer | Yes (aegis+herald) |
| review | /review, code review, PR | Code review workflow | critic, plan-reviewer, review-agent | Yes (critic+review-agent) |
| security | security audit, vulnerability | Security review | aegis | Yes (aegis) |
| tdd | TDD, test-driven, red-green | TDD cycle | kraken, arbiter | Yes (kraken) |
| test | /test, test suite, test run | Test execution wrapper | arbiter, atlas | Yes (arbiter) |
| premortem | premortem, risk, pre-mortem | Risk analysis before implementation | — | No |
| plan-mode | plan, think through, /plan | Plan mode guidance | plan-agent | Yes (plan-agent) |

### Memory System (5 skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| memory | memory, recall, remember, store learning | Master memory skill (canonical) | — | No |
| recall | /recall, find memory, what did we | Recall from PostgreSQL+pgvector | — | No |
| remember | /remember, store this, save learning | Store to memory system | — | No |
| recall-reasoning | recall reasoning, why did we | Recall with chain-of-thought | — | No |
| memory-curate | curate memory, clean memory | Memory quality management | — | No |

### Session Continuity (3 skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| create_handoff | handoff, end session, wrap up | Create YAML handoff doc | scribe | Yes (scribe) |
| resume_handoff | resume, continue from handoff | Resume from handoff doc | — | No |
| continuity_ledger | ledger, continuity | Session ledger management | scribe | Yes (scribe) |

### Debugging (3 guardrail skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| systematic-debugging | bug, error, fix, debug | Systematic debugging framework (GUARDRAIL — 1x/session block) | debug-agent, sleuth | Yes (debug-agent+sleuth) |
| databases | SQL, postgres, database, migration, query | Database operations skill (GUARDRAIL — 1x/session block) | — | No |
| code-review | PR, review, merge, complete | Code review framework (GUARDRAIL — 1x/session block) | critic, review-agent | Yes (critic+review-agent) |
### Infrastructure and Ops (8 skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| vercel-cli | vercel, deploy | Vercel CLI usage guide | deployer | Yes (deployer) |
| railway-cli | railway, deploy | Railway CLI usage guide | deployer | Yes (deployer) |
| neonctl | neon, neonctl, postgres | Neon Postgres CLI guide | — | No (gap) |
| sentry-cli | sentry, error tracking | Sentry CLI usage guide | deployer | Yes (deployer) |
| docker | docker, container | Docker operations | — | No |
| git | git, commit, branch | Git operations | — | No |
| linearis | linear, issue, ticket | Linear issue management | — | No |
| gh | github, PR, pull request | GitHub CLI | — | No |

### Skill and Agent Development (7 skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| hook-scaffold | hook scaffold, new hook | Scaffold new hook TypeScript file | — | No |
| hook-audit | hook audit, hook health | Audit hook registration and health | — | No |
| sync-drift | sync drift, out of sync | Detect ~/.claude vs repo drift | — | No |
| find-skills | find skill, which skill | Skill discovery and routing | — | No |
| project-registry | project registry, which project | Project registry queries | — | No |
| knowledge-tree | knowledge tree, nav | Knowledge tree queries | — | No |
| onboard | onboard, new project | Project onboarding workflow | onboard | Yes (onboard) |

### Codebase Analysis (7 skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| tldr-structure | tldr structure | TLDR structure subcommand guide | — | No (undiscoverable) |
| tldr-search | tldr search | TLDR search subcommand guide | — | No (undiscoverable) |
| tldr-impact | tldr impact | TLDR impact subcommand guide | — | No (undiscoverable) |
| tldr-dead | tldr dead | TLDR dead code subcommand guide | — | No (undiscoverable) |
| tldr-arch | tldr arch | TLDR architecture subcommand guide | — | No (undiscoverable) |
| ast-grep-find | ast-grep, AST search | AST structural pattern search | — | No |
| morph-search | morph, fast search | Fast text search via morph harness | — | No |

### Research Tools (5 skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| mcp-guidance | MCP, tool use | MCP tool selection guide | — | No |
| opencli | opencli, web data | OpenCLI adapter usage | oracle | Yes (oracle) |
| github-search | github search, find repo | GitHub search via harness | oracle | Yes (oracle) |
| exa | exa, semantic search | Exa search engine usage | oracle | Yes (oracle) |
| braintrust-tracing | braintrust, eval, trace | Braintrust eval platform | braintrust-analyst | Yes (braintrust-analyst) |
### Frontend and UI (6 skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| frontend-design | design, UI, component | Frontend design pipeline | — | No |
| react-perf | react performance, memo, render | React perf review methodology | react-perf-reviewer | Yes (react-perf-reviewer) |
| browser-dev-cycle | browser, playwright | Browser automation workflow | — | No |
| ui-audit | UI audit, accessibility | UI compliance standards | ui-compliance-reviewer | Yes (ui-compliance-reviewer) |
| paper-design | paper, artboard | Paper.design MCP integration | — | No |
| shadcnspace | shadcn, component library | Shadcn Space premium blocks | — | No |

### Project Management (3 skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| notion-bridge | notion, bridge, Eve | Notion MCP bridge to Claude.ai | — | No |
| roadmap | roadmap, goal, ROADMAP.md | ROADMAP.md management | — | No |
| prd | PRD, product requirements | PRD creation and management | — | No |

### Quality and Testing (2 skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| personas | persona | Persona loading framework | — | No |
| qlty | quality, lint, qlty | Qlty code quality CLI | — | No |

### Agentica Platform (1 skill)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| agentica | agentica, agent deployment | Agentica platform deployment | — | No |

### Meta and Reference (3 skills)

| Skill | Trigger Keywords | Purpose | Agent Mentions | Companion Agent? |
|-------|-----------------|---------|----------------|-----------------|
| claude-code-guide | claude code, how to use | CCv3 usage reference guide | — | No |
| health-check | health check, system health | System health diagnostic | — | No |
| create-plan | (none — no hook fires it) | Plan creation methodology (ORPHANED) | plan-agent (broken path) | Yes but broken |
## Cross-Reference: Hooks That Route Agents and Skills

| Hook | Event | Trigger | Action | Target |
|------|-------|---------|--------|--------|
| explore-to-scout | PreToolUse(Task) | subagent_type=Explore | HARD BLOCK | Forces scout instead |
| task-router | UserPromptSubmit | Keyword detection (research/implement/debug/etc.) | RECOMMEND only | oracle, kraken, spark, architect, phoenix, debug-agent, sleuth, profiler, arbiter, scribe |
| guardrail-enforcer | UserPromptSubmit | bug/error/fix/debug | SOFT BLOCK (1x per session) | Requires systematic-debugging skill |
| guardrail-enforcer | UserPromptSubmit | SQL/postgres/migration/query | SOFT BLOCK (1x per session) | Requires databases skill |
| guardrail-enforcer | UserPromptSubmit | PR/review/merge/complete | SOFT BLOCK (1x per session) | Requires code-review skill |
| skill-activation-prompt | UserPromptSubmit | Dynamic via skill-rules.json with LLM validation | RECOMMEND | Matching skill for the prompt |
| maestro-detector | UserPromptSubmit | Complexity signals (multi-step, orchestrate) | SUGGEST | Recommends /maestro |
| react-perf-context | PostToolUse(Read) | Reading .tsx files | INJECT CONTEXT | Auto-loads react-perf skill context |
| agent-model-guard | PreToolUse(Task) | model=haiku detected | HARD BLOCK | Denies haiku model selection |
| agent-verification | PostToolUse(Task) | All agent completions | VERIFY | Checks agent output quality |
| no-haiku-enforcer | PreToolUse(Task) | model=haiku detected | HARD BLOCK | Redundant enforcement with agent-model-guard |

### Routing Coverage Gaps

These agents have NO hook routing — only reachable by explicit name:
- principal-reviewer
- wizard
- validate-agent
- agent-factory
- session-analyst
- braintrust-analyst (has skill but no UserPromptSubmit hook routing)

## Gaps and Overlaps

1. **plan-agent loads a broken skill path.** The agent definition references `skills/create_plan/SKILL.md` (underscore). The actual directory is `create-plan` (hyphen). Every workflow that chains through plan-agent — refactor, migrate, release — silently gets no methodology context injected. Fix: rename the path in plan-agent.md.

2. **braintrust-analyst and session-analyst are functional duplicates.** Both analyze Braintrust/session trace data with nearly identical tool sets. No routing rule distinguishes them. The system carries two agents doing the same job — one should be archived or they should be merged with differentiated roles.

3. **Five TLDR sub-skills are undiscoverable.** tldr-structure, tldr-search, tldr-impact, tldr-dead, and tldr-arch have no hook that fires them. CLAUDE.md references the tldr CLI directly by subcommand name, bypassing the skill layer entirely. These skills exist as documentation artifacts but are never auto-loaded.

4. **debug-agent and sleuth are near-duplicates with undocumented distinction.** Both investigate bugs. The fix skill uses sleuth for deep forensics and debug-agent as general fallback, but this distinction only lives in fix/SKILL.md — no hook enforces or documents the split. In practice both get recommended for the same problem class.

5. **maestro fires on itself.** The maestro-detector hook activates on complexity signals and recommends /maestro. If the user is already running a maestro session, the hook will suggest maestro again. No guard against this re-entrancy.

6. **pioneer agent is missing.** The build skill SKILL.md references a pioneer agent for greenfield scaffolding. No pioneer.md file exists in the agents directory. The greenfield build path has no dedicated scaffolding agent.

7. **principal-reviewer is completely undiscoverable.** The agent exists but appears in no skill and has no hook routing. It can only be invoked by typing the agent name explicitly. No workflow surfaces it.

8. **onboard is a dual-entity with circular references.** Both onboard.md (agent) and skills/onboard/SKILL.md exist, each referencing the other. The agent loads the skill; the skill mentions the agent. Authorship and primary ownership are ambiguous.

9. **health-check and mot overlap in purpose.** Both skills cover system health diagnostics. health-check is the current primary skill. mot (monitoring over time) is an older pattern. The relationship, precedence, and whether mot should be archived are undocumented.

10. **No neonctl companion agent.** The neonctl skill has no companion agent. All other infrastructure CLIs (vercel-cli, railway-cli, sentry-cli) are wrapped by the deployer agent. Neon Postgres operations bypass the agent safety layer.

11. **validate-agent agent and agent-model-guard hook.** validate-agent.md validates task output quality post-completion. The agent-model-guard.ts hook blocks haiku model selection at invocation time. Nameclash resolved by R5 rename (was agent-validate.ts).

12. **perplexity and firecrawl skills are orphaned.** Both were removed from oracle agent and CLAUDE.md primary pathways (per memory entry, 2026-03-09). The skill files still exist in the active skill directory but nothing routes to them. They should be archived.

## Sync Drift (Repo vs Global)

Skills present in repo (`continuous-claude/.claude/skills/`) but NOT in global (`~/.claude/skills/`):

| Skill | Status | Action Needed |
|-------|--------|---------------|
| find-skills | Repo only | Run `bash scripts/sync-to-active.sh` |
| vercel-cli | Repo only | Run `bash scripts/sync-to-active.sh` |

All 33 agents are present in both repo and global.
All other skills are in sync.

**Command to fix:**
```
bash C:/Users/david.hayes/continuous-claude/scripts/sync-to-active.sh
```
