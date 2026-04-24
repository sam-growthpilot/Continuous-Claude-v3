# Agent Memory & Task Restrictions Integration Plan

## Executive Summary

Claude Code v2.1.33 introduced two features that directly address pain points in our continuous-claude (CC) agent ecosystem:

1. **Agent `memory` frontmatter** - Gives agents persistent `MEMORY.md` directories that survive across sessions, enabling agents to accumulate domain expertise without consuming parent context.
2. **`Task(agent_type)` restrictions** - Declarative deny rules in `settings.json` that block specific sub-agent types, replacing our custom TypeScript hooks with zero-maintenance configuration.

### Why This Matters

Today our agent system has two architectural friction points:
- **No agent-level memory** - Every agent starts cold. Scout re-discovers the same patterns. Kraken re-learns the same build quirks. Our PostgreSQL memory system helps the *parent* session, but agents themselves have no persistent state.
- **Hook-based agent restrictions** - We maintain 80+ lines of TypeScript (`explore-to-scout.mjs`, `no-haiku-enforcer.mjs`) plus 7 PreToolUse:Task hooks just to enforce agent routing rules that could be a 3-line JSON config.

This document maps both features to our 18-agent ecosystem, identifies which agents benefit from memory (and which should not), proposes Task restriction rules that retire hook workarounds, and lays out a phased rollout.

---

## Feature 1: Agent Memory

### How It Works

Adding a `memory` key to an agent's frontmatter creates a persistent `MEMORY.md` at `~/.claude/agent-memory/<agent-name>/MEMORY.md`. The agent can read/write this file across sessions. Content after line 200 is truncated from the system prompt injection, so agents must keep notes concise.

```json
{
  "name": "scout",
  "memory": true,
  "prompt": "..."
}
```

### Relationship to Our PostgreSQL Memory System

| System | Scope | Persistence | Access Pattern | Best For |
|--------|-------|-------------|----------------|----------|
| Native `MEMORY.md` | Per-agent, local file | Survives sessions | Auto-injected into agent system prompt | Agent-specific learnings, project patterns, working notes |
| PostgreSQL + pgvector | Global, all sessions | Permanent DB | Explicit `recall_learnings.py` call | Cross-agent knowledge, semantic search, architectural decisions |

**These are complementary, not competing.** Native memory is the agent's personal scratchpad (fast, always available, 200-line limit). PostgreSQL is the shared knowledge base (searchable, unlimited, requires explicit query). An agent should store frequently-needed patterns in its `MEMORY.md` and use `recall_learnings.py` for deeper lookups.

### Agent Tiering

#### Tier 1: High-Value Memory (implement first)

These agents run frequently, accumulate domain knowledge, and would benefit most from persistent state.

| Agent | Model | Current Pain Point | Memory Use Case |
|-------|-------|--------------------|-----------------|
| **scout** | Sonnet | Re-discovers same file patterns every session | Project structure map, key file locations, naming conventions |
| **architect** | Opus | Forgets past design decisions | Architectural patterns chosen, rejected alternatives, system constraints |
| **kraken** | Opus | Re-learns build/test quirks | Build commands, test framework config, common failure patterns, TDD cycle notes |
| **sleuth** | Opus | Re-investigates same error classes | Error taxonomy, debugging playbooks, root cause patterns |
| **maestro** | Opus | Forgets orchestration patterns that worked | Successful agent compositions, phase timing, task decomposition patterns |

**scout example `MEMORY.md`:**
```markdown
# Scout Memory

## Project Structure
- Hooks: .claude/hooks/src/*.ts → dist/*.mjs (npm run build)
- Agents: .claude/agents/*.json (18 agents)
- Skills: .claude/skills/*/SKILL.md
- OPC scripts: opc/scripts/core/*.py

## Key Patterns
- All hooks use shared/types.ts for interfaces
- Import from './shared/types.js' in dist (not .ts)
- Settings.json has 7 PreToolUse:Task hooks in chain

## Naming Conventions
- Hooks: kebab-case (explore-to-scout.ts)
- Agents: kebab-case (react-perf-reviewer.json)
- Skills: kebab-case dirs with SKILL.md
```

#### Tier 2: Moderate-Value Memory (implement second)

These agents run less frequently but still benefit from accumulated knowledge.

| Agent | Model | Memory Use Case |
|-------|-------|-----------------|
| **oracle** | Opus | Cache of API docs consulted, library versions verified, external resource reliability notes |
| **phoenix** | Opus | Refactoring patterns that worked, migration strategies, dependency upgrade notes |
| **debug-agent** | Opus | Overlaps with sleuth; debugging heuristics, tool-specific troubleshooting |
| **scribe** | Sonnet | Documentation conventions, handoff format preferences, template patterns |

#### Tier 3: No Memory (do not implement)

These agents are either too specialized, too infrequent, or would accumulate stale/misleading state.

| Agent | Reason to Skip |
|-------|----------------|
| **spark** | Lightweight quick-fix agent. Stateless by design - it should not build habits. |
| **arbiter** | Test runner. Each run should be clean - cached assumptions about test state are dangerous. |
| **atlas** | E2E test runner. Same reasoning as arbiter. |
| **aegis** | Security scanner. Must evaluate fresh each time - cached security assumptions create blind spots. |
| **sentinel** | Plan reviewer. Should review each plan independently without bias from past reviews. |
| **warden** | Refactoring reviewer. Same independence reasoning as sentinel. |
| **profiler** | Performance profiler. Cached baselines become misleading as code changes. |
| **pathfinder** | External repo research. Each repo is different - past patterns don't transfer well. |
| **react-perf-reviewer** | Specialized reviewer. Should apply fresh analysis each time. |
| **ui-compliance-reviewer** | Specialized reviewer. Standards change; cached compliance checks go stale. |

**Principle:** Reviewers and validators should NOT have memory. Memory introduces bias. Implementation and exploration agents SHOULD have memory. Memory accelerates learning.

### Memory Content Guidelines

Each agent's `MEMORY.md` should follow this structure:

```markdown
# {Agent Name} Memory

## Project: {project-name}
{2-3 line project summary}

## Patterns
{Discovered patterns, max 5-10 entries}

## Pitfalls
{Things that don't work, max 5 entries}

## Key Files
{Critical file paths and their purposes}
```

**200-line budget allocation:**
- ~20 lines: Header + project context
- ~80 lines: Patterns and domain knowledge
- ~40 lines: Pitfalls and anti-patterns
- ~40 lines: Key files and references
- ~20 lines: Buffer for growth

### Memory Hygiene

Agents must self-maintain their `MEMORY.md`:
- Remove outdated entries when files are renamed/deleted
- Consolidate duplicate patterns
- Prioritize high-frequency knowledge near the top (truncation happens at line 200)
- Date-stamp entries that may go stale (e.g., "as of 2026-02 the build uses esbuild")

---

## Feature 2: Task Restrictions

### How It Works

`Task(agent_type)` deny rules in `settings.json` prevent specific sub-agent types from being spawned. This is declarative configuration that replaces procedural hook logic.

```json
{
  "permissions": {
    "deny": [
      "Task(Explore)",
      "Task(navigator)"
    ]
  }
}
```

When the parent model tries to spawn a denied agent type, the system blocks it with a clear error, prompting the model to choose an alternative.

### Replacing Hook Workarounds

#### Hook 1: `explore-to-scout.mjs` (80 lines) → 1 deny rule

**Current state:** A TypeScript hook intercepts `Task` calls with `subagent_type="Explore"`, returns `permissionDecision: deny`, and includes a message telling the model to use `scout` instead.

**Replacement:**
```json
{
  "permissions": {
    "deny": ["Task(Explore)"]
  }
}
```

The built-in deny mechanism provides a clear error that the model can act on. Combined with the existing rule at `.claude/rules/use-scout-not-explore.md` (which stays), this achieves the same outcome with zero custom code.

**Migration risk:** LOW. The deny rule is functionally identical. The rule file provides the "why" context. The hook can be retired.

**Files affected:**
- `.claude/settings.json` - Add deny rule
- `.claude/hooks/src/explore-to-scout.ts` - Archive
- `.claude/hooks/dist/explore-to-scout.mjs` - Remove from hook chain

#### Hook 2: `no-haiku-enforcer.mjs` (74 lines) → Not directly replaceable

**Current state:** Intercepts Task calls where `model="haiku"` and blocks them.

**Assessment:** `Task(agent_type)` restrictions deny by agent *type*, not by model parameter. The haiku enforcer checks the `model` field, not the `subagent_type` field. This hook cannot be replaced by a Task deny rule.

**Recommendation:** Keep `no-haiku-enforcer.mjs` as-is. It serves a different purpose (model selection enforcement vs. agent type restriction). If Claude Code adds `Task(model=haiku)` deny syntax in the future, revisit.

#### Other PreToolUse:Task hooks (keep all)

| Hook | Purpose | Replaceable? |
|------|---------|--------------|
| `agent-validate.mjs` | General validation logic | No - custom validation beyond type blocking |
| `navigator-validate.mjs` | Navigator-specific checks | No - custom logic |
| `task-router.mjs` | Task routing decisions | No - routing, not blocking |
| `maestro-enforcer.mjs` | Maestro workflow phase gating | No - stateful enforcement |
| `pre-tool-knowledge.mjs` | Knowledge injection | No - augmentation, not restriction |

### New Orchestrator Proposals

With Task deny rules available, we can create lightweight orchestrator agents that restrict which sub-agents they can spawn, enforcing composition patterns:

#### 1. `foreman` - Build Orchestrator

**Purpose:** Coordinates implementation tasks. Can only spawn implementation and test agents.

```json
{
  "name": "foreman",
  "description": "Build orchestrator - coordinates implementation and testing",
  "model": "opus",
  "permissions": "queue",
  "allowedAgents": ["kraken", "spark", "arbiter", "atlas"],
  "prompt": "You coordinate implementation tasks. Delegate to kraken for complex implementation, spark for quick fixes, arbiter for unit tests, atlas for E2E tests. Write coordination summary to $CLAUDE_PROJECT_DIR/.claude/cache/agents/foreman/latest-output.md"
}
```

**Task restrictions (in settings or agent config when supported):**
```
deny: Task(scout), Task(oracle), Task(architect), Task(phoenix)
```

**Value:** Prevents implementation orchestrators from going on research tangents. Forces a "build, don't explore" discipline.

#### 2. `detective` - Debug Orchestrator

**Purpose:** Coordinates debugging workflows. Can spawn investigation and fix agents.

```json
{
  "name": "detective",
  "description": "Debug orchestrator - coordinates investigation and resolution",
  "model": "opus",
  "permissions": "queue",
  "allowedAgents": ["sleuth", "debug-agent", "scout", "spark", "profiler"],
  "prompt": "You coordinate debugging workflows. Use sleuth/debug-agent for investigation, scout for codebase exploration, spark for fixes, profiler for performance issues. Write findings to $CLAUDE_PROJECT_DIR/.claude/cache/agents/detective/latest-output.md"
}
```

**Value:** Structured debugging that follows investigate-then-fix, preventing premature fixes without root cause analysis.

#### 3. `librarian` - Research Orchestrator

**Purpose:** Coordinates research and documentation. No implementation agents.

```json
{
  "name": "librarian",
  "description": "Research orchestrator - coordinates exploration and documentation",
  "model": "opus",
  "permissions": "queue",
  "allowedAgents": ["scout", "oracle", "scribe", "pathfinder"],
  "prompt": "You coordinate research and documentation tasks. Use scout for codebase exploration, oracle for external research, pathfinder for external repos, scribe for documentation. Write research summary to $CLAUDE_PROJECT_DIR/.claude/cache/agents/librarian/latest-output.md"
}
```

**Value:** Prevents research tasks from accidentally modifying code. Pure read-only exploration.

**Note:** These orchestrators depend on Claude Code supporting per-agent Task restrictions (agent-level `deny` rules). If the current implementation only supports global deny rules in `settings.json`, these orchestrators would need hook-based enforcement instead. Validate the feature scope before implementing.

### Settings.json Changes

Proposed additions to the `permissions` section:

```json
{
  "permissions": {
    "deny": [
      "Task(Explore)"
    ]
  }
}
```

This is minimal and conservative. Only deny `Explore` (replaced by scout). Do not deny other agent types globally - they all have legitimate use cases from the parent context.

---

## Migration Roadmap

### Phase 1: Task Deny Rule for Explore (Risk: LOW)

**Goal:** Replace `explore-to-scout.mjs` hook with native deny rule.

**Changes:**
1. Add `"permissions": { "deny": ["Task(Explore)"] }` to `.claude/settings.json`
2. Remove `explore-to-scout.mjs` from the PreToolUse:Task hook chain in settings.json
3. Verify `.claude/rules/use-scout-not-explore.md` still provides guidance (it does)
4. Move `explore-to-scout.ts` and `.mjs` to `.claude/hooks/archive/`

**Verification:**
- Attempt to spawn an `Explore` agent → should be blocked by deny rule
- Attempt to spawn a `scout` agent → should succeed
- Check that the model self-corrects to `scout` after denial

**Rollback:** Re-add the hook entry to settings.json. The archived files remain available.

### Phase 2: Tier 1 Agent Memory (Risk: LOW-MEDIUM)

**Goal:** Add `memory: true` to the 5 highest-value agents.

**Changes:**
1. Add `"memory": true` to: `scout.json`, `architect.json`, `kraken.json`, `sleuth.json`, `maestro.json`
2. Create initial `MEMORY.md` templates at `~/.claude/agent-memory/<name>/MEMORY.md` (or let agents bootstrap their own)
3. Add `.claude/agent-memory/` to `.gitignore` (memory is local, not shared)

**Verification:**
- Spawn each agent → confirm MEMORY.md is injected into their system prompt
- Have scout explore the project → verify it writes useful patterns to its MEMORY.md
- Re-spawn scout → verify it references its prior notes

**Risk:** Agents may write too much (hitting 200-line limit) or too little (empty memory). Monitor first 5 sessions and adjust prompt guidance.

### Phase 3: Tier 2 Agent Memory (Risk: LOW)

**Goal:** Add memory to 4 more agents after Tier 1 is stable.

**Changes:**
1. Add `"memory": true` to: `oracle.json`, `phoenix.json`, `debug-agent.json`, `scribe.json`
2. Seed MEMORY.md with project-relevant content if available

**Prerequisite:** Phase 2 has run for 5+ sessions with no issues.

### Phase 4: Memory-PostgreSQL Bridge (Risk: MEDIUM)

**Goal:** Connect agent MEMORY.md with our PostgreSQL memory system so high-value agent learnings propagate to the shared knowledge base.

**Changes:**
1. Add a PostToolUse:Task hook that reads the agent's updated MEMORY.md after task completion
2. Diff against previous version to identify new learnings
3. Store significant new learnings to PostgreSQL via `store_learning.py`
4. Tag with `source:agent-memory, agent:<name>` for provenance

**Risk:** Automated storage could flood the DB with low-quality entries. Use heuristics:
- Only store entries >20 chars
- Skip entries that match existing learnings (0.85 similarity threshold already handles this)
- Require confidence tagging in agent memory format

### Phase 5: New Orchestrators (Risk: MEDIUM-HIGH)

**Goal:** Create foreman, detective, librarian orchestrators with Task restrictions.

**Prerequisite:** Confirm Claude Code supports per-agent deny rules (not just global). If not, implement via hooks instead.

**Changes:**
1. Create `.claude/agents/foreman.json`, `detective.json`, `librarian.json`
2. Add per-agent Task deny rules (mechanism TBD based on feature scope)
3. Update CLAUDE.md agent table with new orchestrators
4. Add to `.claude/rules/proactive-delegation.md` routing guidance

**Risk:** New orchestrators add complexity. Only proceed if the restriction mechanism is clean. Hook-based enforcement for per-agent restrictions would add 3 more hooks to an already large chain (7 PreToolUse:Task hooks).

### Phase 6: Hook Cleanup & Documentation (Risk: LOW)

**Goal:** Archive replaced hooks, update docs, capture learnings.

**Changes:**
1. Move archived hooks to `.claude/hooks/archive/`
2. Update `docs/hooks/README.md` with new architecture
3. Update `.claude/rules/use-scout-not-explore.md` to reference deny rule instead of hook
4. Store migration learnings to PostgreSQL memory

---

## Risk Analysis

### R1: Memory Divergence

**Risk:** Agent MEMORY.md diverges from reality as codebase evolves (files renamed, patterns changed).

**Mitigation:**
- Agents should date-stamp volatile entries
- Phase 4 bridge provides a cross-check mechanism
- Periodic manual review of agent memory files (quarterly)
- Keep memory concise - less content = less to go stale

### R2: 200-Line Truncation

**Risk:** Agents write past 200 lines, losing important content silently.

**Mitigation:**
- Agent prompts should include: "Keep MEMORY.md under 180 lines. Consolidate and prune regularly."
- Use the budget allocation (20/80/40/40/20) as a guideline
- Monitor memory file sizes in Phase 2

### R3: Memory Contamination Across Projects

**Risk:** Agent memory from project A leaks into project B context.

**Mitigation:**
- Native MEMORY.md is per-project (stored under project-specific paths)
- Verify isolation by testing with multiple project directories
- If isolation is insufficient, prefix all entries with project name

### R4: Hook Removal Regression

**Risk:** Removing `explore-to-scout.mjs` breaks the redirect flow.

**Mitigation:**
- Phase 1 is the lowest-risk change with clear rollback (re-add hook)
- The `.claude/rules/use-scout-not-explore.md` rule file remains as backup guidance
- Test explicitly before removing the hook

### R5: Orchestrator Complexity Creep

**Risk:** Three new orchestrators (Phase 5) add complexity without proportional value.

**Mitigation:**
- Gate Phase 5 behind proven value from Phases 1-4
- Start with one orchestrator (foreman) and evaluate before adding more
- Each orchestrator must justify its existence with measurable improvement

### R6: Stale Reviewer Memory

**Risk:** If we later add memory to reviewer agents (Tier 3), they accumulate biases.

**Mitigation:**
- Tier 3 agents are explicitly excluded from memory. This is a design decision, not a deferral.
- Document the principle: "Reviewers and validators should be stateless."

---

## Appendix

### A1: Agent Frontmatter Diff (Phase 2)

```diff
# scout.json
 {
   "name": "scout",
   "description": "Codebase exploration and pattern finding",
+  "memory": true,
   "prompt": "...",
   "tools": [],
   "model": "sonnet",
   "permissions": "skip",
   "blocked_patterns": [],
   "inherit_blocks": true
 }
```

Same pattern for `architect.json`, `kraken.json`, `sleuth.json`, `maestro.json`.

### A2: Settings.json Diff (Phase 1)

```diff
 {
   "env": { ... },
+  "permissions": {
+    "deny": [
+      "Task(Explore)"
+    ]
+  },
   "hooks": {
     "PreToolUse": [
       ...
       {
         "matcher": "Task",
         "hooks": [
           { "command": "agent-validate.mjs", ... },
-          { "command": "explore-to-scout.mjs", ... },
           { "command": "no-haiku-enforcer.mjs", ... },
           ...
         ]
       }
     ]
   }
 }
```

### A3: .gitignore Addition (Phase 2)

```diff
 # Claude cache and state
 .claude/cache/
 .claude/state/
+
+# Agent memory (local per-machine, not shared)
+.claude/agent-memory/
```

### A4: Current Hook Chain (PreToolUse:Task)

For reference, the current 7-hook chain that runs on every `Task` call:

| Order | Hook | Purpose | Replaceable by Task Deny? |
|-------|------|---------|---------------------------|
| 1 | `agent-validate.mjs` | General validation | No |
| 2 | `explore-to-scout.mjs` | Redirect Explore→scout | **Yes (Phase 1)** |
| 3 | `no-haiku-enforcer.mjs` | Block model=haiku | No (model, not type) |
| 4 | `navigator-validate.mjs` | Navigator checks | No |
| 5 | `task-router.mjs` | Routing logic | No |
| 6 | `maestro-enforcer.mjs` | Phase gating | No |
| 7 | `pre-tool-knowledge.mjs` | Knowledge injection | No |

After Phase 1: chain reduces to 6 hooks. Small win, but removes 80 lines of custom code.

### A5: Agent Inventory

| Agent | Model | Tier | Memory? | Frequency | Primary Role |
|-------|-------|------|---------|-----------|--------------|
| scout | Sonnet | 1 | Yes | Very High | Codebase exploration |
| architect | Opus | 1 | Yes | High | Design planning |
| kraken | Opus | 1 | Yes | High | TDD implementation |
| sleuth | Opus | 1 | Yes | Medium | Bug investigation |
| maestro | Opus | 1 | Yes | Medium | Multi-agent orchestration |
| oracle | Opus | 2 | Yes | Medium | External research |
| phoenix | Opus | 2 | Yes | Low-Medium | Refactoring strategy |
| debug-agent | Opus | 2 | Yes | Medium | Debugging |
| scribe | Sonnet | 2 | Yes | Low-Medium | Documentation |
| spark | Sonnet | 3 | No | High | Quick fixes (stateless) |
| arbiter | Opus | 3 | No | High | Test runner (clean slate) |
| atlas | Opus | 3 | No | Low | E2E tests (clean slate) |
| aegis | Opus | 3 | No | Low | Security scanning (fresh) |
| sentinel | Opus | 3 | No | Low | Plan review (unbiased) |
| warden | Opus | 3 | No | Low | Refactor review (unbiased) |
| profiler | Sonnet | 3 | No | Low | Performance (fresh baselines) |
| pathfinder | Opus | 3 | No | Low | External repo research |
| react-perf-reviewer | Sonnet | 3 | No | Low | React review (fresh) |
| ui-compliance-reviewer | Sonnet | 3 | No | Low | UI/a11y review (fresh) |

---

*Document created: 2026-02-06*
*Branch: feature/status-dashboard*
*Status: Planning - no code changes yet*
