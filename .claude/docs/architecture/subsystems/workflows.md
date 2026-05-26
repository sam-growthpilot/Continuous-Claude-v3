# Workflows Subsystem

## Workflow Types

```
┌─────────────────────────────────────────────────────────────┐
│                    WORKFLOWS                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  /ralph    - Autonomous dev: PRD → Tasks → Delegate → Verify│
│  /maestro  - Coordinate multiple specialists               │
│  /fix      - Debug → Implement → Test                      │
│  /build    - Plan → Implement → Review                     │
│  /explore  - Codebase research at varying depths           │
│  /premortem- Adversarial failure-mode analysis of a plan   │
│  /review   - Parallel specialized reviews                  │
│  /release  - Audit → Test → Changelog                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## /ralph Workflow

Maestro's **autonomous development mode** (GSD lifecycle). Ralph orchestrates
specialized agents to take a defined requirement from PRD through verified
implementation. **Ralph NEVER edits code directly** — it delegates ALL
implementation to agents (kraken, spark, arbiter, debug-agent, etc.) via the
Task tool. It is not an idea-generation or brainstorm pipeline.

```
Phase 0   → 0.5   → 1    → 2     → 2.5      → 3        → 4      → 4.1.5
Context     Deep    PRD    Task    Premortem  Delegation Review   Goal
loading     research        breakdown (adversarial loop      & merge  verify
(memory +  (optional)              gate)      (spawn
 tree)                                          agents)
```

**Phases:**
1. **Phase 0** - Context loading (memory recall + knowledge tree)
2. **Phase 0.5** - Deep research (optional, for complex features)
3. **Phase 1** - PRD generation (ai-dev-tasks templates)
4. **Phase 2** - Task breakdown (`generate-tasks.md`)
5. **Phase 2.5** - Adversarial plan gate (`/premortem`, includes a codex-adversary cross-model pass)
6. **Phase 3** - Delegation loop (spawn agents; each must emit a `ralph_status` JSON)
7. **Phase 4** - Review & merge
8. **Phase 4.1.5** - Goal verification

**Enforcement:** After plan approval, the `plan-to-ralph-enforcer` hook blocks
direct code edits (Edit/Write on `.ts`/`.py`/etc.) — implementation must flow
through delegated agents. The `ralph-delegation-enforcer` hook blocks
Edit/Write/Bash for implementation while Ralph mode is active.

**Bounded iterations:** 10 (small) / 30 (medium) / 50 (large) — Ralph escalates
to the user after hitting the limit rather than looping silently.

**Usage:** `/ralph "build a task management app"`

## /premortem Workflow

First-class adversarial failure-mode analysis of an approved plan. Auto-offered
by the `plan-exit-premortem-prompt` hook after every `ExitPlanMode`, and run as
Phase 2.5 inside `/ralph`.

```
Plan ──→ Imagine failure modes ──→ codex-adversary ──→ Folded mitigations
 │            (inline)              (cross-model pass)        │
 ▼                                                            ▼
ExitPlanMode                                          Hardened plan
```

- Identifies "tigers" (likely failures) and "elephants" (unspoken risks).
- The codex-adversary pass (OpenAI `codex exec`) adds cross-model triangulation —
  findings only one model catches are the cross-model lift.
- Skip the Codex pass with `--no-codex` for doc-only or trivial diffs.

**Usage:** `/premortem` (or auto-offered after a plan is approved)

## /maestro Workflow

Versatile orchestrator for complex multi-step tasks.

```
Analyze Request
      │
      ▼
Spawn Specialists (parallel where possible)
      │
      ├── scout (if research needed)
      ├── oracle (if external docs needed)
      ├── kraken (if implementation needed)
      └── arbiter (if testing needed)
      │
      ▼
Synthesize Results
```

**Usage:** `/maestro "research auth patterns and implement OAuth"`

## /fix Workflow

Bug investigation and resolution.

```
Investigate ──→ Implement ──→ Test ──→ Commit
     │              │           │         │
     ▼              ▼           ▼         ▼
debug-agent      spark      arbiter    /commit
  (find root     (apply     (verify    (if asked)
   cause)         fix)       fix)
```

**Usage:** `/fix "login button not responding"`

## /build Workflow

Feature development with planning.

```
Plan ──→ Implement ──→ Review ──→ Test
  │          │           │         │
  ▼          ▼           ▼         ▼
architect  kraken      critic    arbiter
```

**Usage:** `/build "add dark mode toggle"`

## /explore Workflow

Codebase exploration with depth control.

```
/explore quick      - Surface scan, file structure
/explore medium     - Key patterns, main flows
/explore deep       - Full analysis, relationships
/explore "<query>"  - Targeted search
```

**Usage:** `/explore "how does auth work"`

## /review Workflow

Comprehensive code review via parallel specialists.

```
┌─────────────┐
│   /review   │
└──────┬──────┘
       │   Phase 1 (parallel reviewers)
       ├── critic (code review)
       ├── plan-reviewer (plan / change review)
       └── codex-adversary (cross-model pass, OpenAI codex exec)
       │
       ▼
   review-agent synthesizes findings
```

**Cross-model lift:** `codex-adversary` runs in parallel with critic and
plan-reviewer. Because Codex is a different model family, it catches blind spots
the Claude-family reviewers share. Findings flagged by BOTH are high-confidence;
`[Codex]`-only findings are the cross-model lift. Skip with `--no-codex` for
doc-only or trivial diffs. See `.claude/rules/codex-adversarial.md`.

## /release Workflow

Release preparation and validation.

```
Security Audit ──→ E2E Tests ──→ Review ──→ Changelog
       │              │            │           │
       ▼              ▼            ▼           ▼
     aegis          atlas       critic      herald
```

## Creating Custom Workflows

Skills in `~/.claude/skills/` can compose workflows:

```yaml
# ~/.claude/skills/my-workflow/SKILL.md
1. Detect trigger
2. Spawn agents in sequence/parallel
3. Synthesize results
4. Present to user
```

## Workflow vs Direct Agent

| Situation | Use |
|-----------|-----|
| Single focused task | Direct agent |
| Multi-step with dependencies | Workflow |
| Need coordination | /maestro |
| Autonomous feature build (PRD → verified impl) | /ralph |
| Stress-test a plan before building | /premortem |
