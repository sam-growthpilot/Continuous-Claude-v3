# ROADMAP Subsystem

## Overview

ROADMAP.md is the **single authoritative view** of project status for Continuous Claude. It is automatically maintained by 4 specialized hooks but manually governable through the `/roadmap` skill.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         ROADMAP.md                              │
│  ┌─────────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │Current Focus│ │ Planned  │ │Completed │ │Recent Planning  │  │
│  └──────┬──────┘ └────┬─────┘ └────┬─────┘ └────────┬────────┘  │
└─────────┼─────────────┼────────────┼────────────────┼───────────┘
          │             │            │                │
          │             ▼            ▼                │
          │      ┌──────────────┐ ┌─────────────┐     │
          │      │prd-roadmap-  │ │git-commit-  │     │
          │      │sync          │ │roadmap      │     │
          │      │ PRD Write/   │ │ Bash git    │     │
          │      │ Edit trigger │ │ commit      │     │
          │      └──────────────┘ └─────────────┘     │
          │                            ▲              │
          ▼                            │              ▼
┌─────────────────┐            ┌─────────────┐  (same hook also
│post-plan-roadmap│            │roadmap-     │   writes Recent
│                 │            │completion   │   Planning)
│ ExitPlanMode    │            │ TaskUpdate  │
│ trigger         │            │ completed   │
└─────────────────┘            └─────────────┘
  post-plan-roadmap writes BOTH Current Focus and Recent Planning.
  Completed is fed by git-commit-roadmap. roadmap-completion is advisory-only (no write).
```

**The 4 ROADMAP hooks** (each distinct — `post-plan-roadmap` owns two sections):

| Hook | Trigger | ROADMAP Section(s) |
|------|---------|--------------------|
| `post-plan-roadmap` | ExitPlanMode | Current Focus + Recent Planning |
| `prd-roadmap-sync` | Write/Edit PRD files | Planned |
| `git-commit-roadmap` | Bash `git commit` | Completed |
| `roadmap-completion` | TaskUpdate completed / Bash | **Advisory only** — emits a reminder, never writes |

> **Cross-project contamination guard:** The ROADMAP hooks check plan content
> against the project registry (`.claude/project-registry.json`) before writing.
> When multiple terminals run planning sessions for different projects
> concurrently, this prevents one project's plan from polluting another's
> ROADMAP — a write is skipped if the plan's project doesn't match the target
> ROADMAP's project.

## Section Ownership Model

| Section | Primary Source | Automation | Human Override |
|---------|----------------|------------|----------------|
| **Current Focus** | Planning sessions | `post-plan-roadmap` | `/roadmap focus` |
| **Planned** | PRD files + manual | `prd-roadmap-sync` | `/roadmap add` |
| **Completed** | Git commits | `git-commit-roadmap` | `/roadmap complete` |
| **Recent Planning** | ExitPlanMode | `post-plan-roadmap` | Archive manually |

## Hand-Written Notes (preserved across automation)

The 4 **managed** sections above (Current Focus, Completed, Planned, Recent
Planning Sessions) are auto-regenerated. **Everything else you hand-write in
ROADMAP.md is preserved verbatim** across plan-approval regeneration — intro
prose and any custom section you add.

- Write durable / next-session notes under **`## Notes`** or **`## For Next
  Session`** (also `## Scratch`). These are preserved AND injected into context
  at session start by `session-start-continuity`, so the AI picks them up the
  next session automatically.
- **Avoid** custom headers that start with a managed word (`current`,
  `completed`, `planned`, `recent planning`): the parser matches sections by
  prefix, so e.g. `## Current ideas` is mistaken for Current Focus and
  regenerated away.
- Notes placed *inside* a managed section are not preserved (those blocks are
  regenerated) — keep notes in their own section.

## Components

| Component | File | Purpose |
|-----------|------|---------|
| Plan Hook | `hooks/src/post-plan-roadmap.ts` | Updates Current Focus on ExitPlanMode |
| PRD Hook | `hooks/src/prd-roadmap-sync.ts` | Syncs PRD files to Planned |
| Commit Hook | `hooks/src/git-commit-roadmap.ts` | Adds commits to Completed |
| Completion Hook | `hooks/src/roadmap-completion.ts` | TaskUpdate → Completed |
| Skill | `skills/roadmap/SKILL.md` | Manual management |

## Hook Reference

### prd-roadmap-sync

**Trigger:** PostToolUse (Write|Edit) for `prd-*.md` or `PRD-*.md` files

**Behavior:**
1. Extracts PRD metadata (title, status, priority)
2. Finds ROADMAP.md via recursive upward search (or CLAUDE_PROJECT_DIR)
3. Adds new PRD to Planned section if not duplicate
4. Updates progress when tasks file changes

### post-plan-roadmap

**Trigger:** PostToolUse (ExitPlanMode)

**Behavior:**
1. Reads latest plan from `.claude/plans/` directory
2. Extracts title, decisions, steps, files
3. Updates Current Focus with new goal
4. **Demotes the previous Current Focus to Planned** (not Completed — switching focus ≠ finishing the prior goal)
5. Records planning session in Recent Planning
6. **Regenerates only the 4 managed sections in place** (`applyRoadmapUpdate`); intro prose, `## Notes`, and any other content are preserved verbatim

### git-commit-roadmap

**Trigger:** PostToolUse (Bash) matching `git commit`

**Behavior:**
1. Parses conventional commit message (feat:, fix:, etc.)
2. Skips chore, style, ci commits
3. Adds commit to Completed section with hash

### roadmap-completion

**Trigger:** PostToolUse (TaskUpdate with status=completed | Bash) or UserPromptSubmit with completion signals

**Behavior (advisory-only — never writes ROADMAP):**
1. Detects completion signals (tests passed, git push, "done", TaskUpdate completed)
2. Emits a reminder that the Current Focus goal may be complete (surfaced via `additionalContext`)
3. Does NOT write the file. (Previously it moved Current Focus → Completed and promoted the next Planned item on EVERY task completion — removed because it corrupted ROADMAP ~10×/session and clobbered manual edits. Use `/roadmap complete` + `/roadmap focus` for intentional advancement.)

## /roadmap Skill

| Command | Purpose | Example |
|---------|---------|---------|
| `/roadmap show` | Display current state | `/roadmap show` |
| `/roadmap add <item>` | Add to Planned | `/roadmap add "Dark mode" --priority high` |
| `/roadmap focus <item>` | Set Current Focus | `/roadmap focus "Auth system"` |
| `/roadmap complete` | Mark done | `/roadmap complete` |

## ROADMAP Location

Search order (hooks use recursive upward search):
1. `$CLAUDE_PROJECT_DIR/ROADMAP.md` (if env var set)
2. `$CLAUDE_PROJECT_DIR/.claude/ROADMAP.md`
3. Recursive upward from current directory
4. `~/.claude/ROADMAP.md` (fallback)

## Integration Points

| System | Integration |
|--------|-------------|
| Knowledge Tree | `goals.source` references ROADMAP |
| Memory System | Planning decisions stored via `archival_memory` |
| Git | `git-commit-roadmap` auto-updates Completed |
| Task System | `roadmap-completion` responds to TaskUpdate |

## Plan Directory Fallback

The `post-plan-roadmap` hook checks plans in 3 locations (in order):
1. `{projectDir}/.claude/plans` - Standard project plans
2. `{projectDir}/plans` - When project IS ~/.claude
3. `~/.claude/plans` - User-level fallback

## Quick Usage

```bash
# Manual management
/roadmap show
/roadmap add "New feature" --priority high
/roadmap focus "Current work"
/roadmap complete

# Automation triggers automatically:
# - Exit plan mode → Current Focus updated
# - Create PRD file → Planned updated
# - Git commit feat/fix → Completed updated
# - TaskUpdate completed → Current → Completed
```

## Deep Dive

For implementation details and path resolution fixes:
→ `~/continuous-claude/docs/Roadmap Source of Truth Implementation.md`
