# ROADMAP as Source of Truth - Implementation Report

**Date:** 2026-02-03
**Commit:** `3868c36`
**Status:** Implemented

---

## Executive Summary

ROADMAP.md has been elevated to the **single authoritative view** of project status for the Continuous Claude system. This implementation fixes automation gaps, adds error visibility, and provides manual override capabilities through a new `/roadmap` skill.

---

## Problem Statement

### Before Implementation

| Section | State | Root Cause |
|---------|-------|------------|
| **Current Focus** | Empty placeholder | No `ExitPlanMode` triggered recently |
| **Planned** | Empty | Path resolution bug in `prd-roadmap-sync` |
| **Completed** | 20+ items | Working correctly |
| **Recent Planning** | 1 stale entry | Normal - reflects last planning session |

### Technical Issues Identified

1. **Path Resolution Bug**: `prd-roadmap-sync.ts` searched only 1 level up, but PRD files were located 3+ levels deep in `opc/ai-dev-tasks/spark-enhancements/`
2. **Silent Failures**: All 4 ROADMAP hooks swallowed errors with empty `catch(() => continue)` blocks
3. **No Manual Entry Path**: Users couldn't add planned items without PRD files
4. **Automation Dependency**: System relied entirely on hooks with no fallback

---

## Solution Architecture

### Design Principle

> ROADMAP.md is the **single authoritative view** of project status, automatically maintained but manually governable.

### Section Ownership Model

| Section | Primary Source | Automation | Human Override |
|---------|----------------|------------|----------------|
| **Current Focus** | Planning sessions | `post-plan-roadmap` | `/roadmap focus` |
| **Planned** | PRD files + manual | `prd-roadmap-sync` | `/roadmap add` |
| **Completed** | Git commits + tasks | `git-commit-roadmap` + `roadmap-completion` | `/roadmap complete` |
| **Recent Planning** | ExitPlanMode | `post-plan-roadmap` | Archive manually |

---

## Implementation Details

### 1. Path Resolution Fix

**File:** `.claude/hooks/src/prd-roadmap-sync.ts`
**Lines:** 142-166

**Before:**
```typescript
function findRoadmapPath(startDir: string): string | null {
  const candidates = [
    path.join(startDir, 'ROADMAP.md'),
    path.join(startDir, '.claude', 'ROADMAP.md'),
    path.join(startDir, '..', 'ROADMAP.md'),        // Only 1 level!
    path.join(startDir, '..', '.claude', 'ROADMAP.md'),
  ];
  // ...
}
```

**After:**
```typescript
function findRoadmapPath(startDir: string): string | null {
  // Check CLAUDE_PROJECT_DIR first (highest priority)
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir) {
    const roadmap = path.join(projectDir, 'ROADMAP.md');
    if (fs.existsSync(roadmap)) return roadmap;
    const claudeRoadmap = path.join(projectDir, '.claude', 'ROADMAP.md');
    if (fs.existsSync(claudeRoadmap)) return claudeRoadmap;
  }

  // Recursive upward search from startDir
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    const candidate = path.join(current, 'ROADMAP.md');
    if (fs.existsSync(candidate)) return candidate;

    const claudeCandidate = path.join(current, '.claude', 'ROADMAP.md');
    if (fs.existsSync(claudeCandidate)) return claudeCandidate;

    current = path.dirname(current);
  }

  return null;
}
```

**Impact:** PRD files at any depth can now trigger ROADMAP updates.

---

### 2. Error Logging

**Files Modified:** 4 hook files

| Hook | Error Pattern |
|------|---------------|
| `prd-roadmap-sync.ts` | `[prd-roadmap-sync] Error: <message>` |
| `post-plan-roadmap.ts` | `[post-plan-roadmap] Error: <message>` |
| `roadmap-completion.ts` | `[roadmap-completion] Error: <message>` |
| `git-commit-roadmap.ts` | `[git-commit-roadmap] Error: <message>` |

**Before:**
```typescript
main().catch(() => {
  console.log(JSON.stringify({ result: 'continue' }));
});
```

**After:**
```typescript
main().catch((err) => {
  console.error('[hook-name] Error:', err.message);
  console.log(JSON.stringify({ result: 'continue' }));
});
```

**Impact:** Hook failures now visible in stderr for debugging.

---

### 3. `/roadmap` Skill

**Location:** `.claude/skills/roadmap/SKILL.md`

#### Commands

| Command | Purpose |
|---------|---------|
| `/roadmap show` | Display current ROADMAP state |
| `/roadmap add <item>` | Add item to Planned section |
| `/roadmap focus <item>` | Set Current Focus (promotes from Planned if exists) |
| `/roadmap complete [item]` | Move current goal to Completed |

#### Example Usage

```
/roadmap add "Implement dark mode" --priority high
/roadmap focus "ROADMAP as Source of Truth"
/roadmap complete
```

**Impact:** Users can manually manage ROADMAP without waiting for automation triggers.

---

### 4. ROADMAP Content Updates

**Backfilled from PRD files:**
- Actions Kanban Board [PRD-001] (high priority)
- Decisions Filter [PRD-002] (medium priority)
- Dark Mode [PRD-003] (medium priority)
- Agent Integration [PRD-004] (high priority)

**Set Current Focus:**
```markdown
## Current Focus

**ROADMAP as Source of Truth Implementation**
- Making ROADMAP the authoritative project view
- Fixed path resolution, added error logging, created /roadmap skill
- Started: 2026-02-03
```

---

## Hook Architecture Overview

The ROADMAP system is maintained by 4 specialized hooks:

```
┌─────────────────────────────────────────────────────────────────┐
│                         ROADMAP.md                              │
│  ┌─────────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │Current Focus│ │ Planned  │ │Completed │ │Recent Planning  │  │
│  └──────┬──────┘ └────┬─────┘ └────┬─────┘ └────────┬────────┘  │
│         │             │            │                │           │
└─────────┼─────────────┼────────────┼────────────────┼───────────┘
          │             │            │                │
          ▼             ▼            ▼                ▼
┌─────────────────┐ ┌──────────────┐ ┌─────────────┐ ┌────────────┐
│post-plan-roadmap│ │prd-roadmap-  │ │git-commit-  │ │post-plan-  │
│                 │ │sync          │ │roadmap      │ │roadmap     │
│ ExitPlanMode    │ │ PRD Write/   │ │ Bash git    │ │ExitPlanMode│
│ trigger         │ │ Edit trigger │ │ commit      │ │trigger     │
└─────────────────┘ └──────────────┘ └─────────────┘ └────────────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │roadmap-     │
                                    │completion   │
                                    │ TaskUpdate  │
                                    │ trigger     │
                                    └─────────────┘
```

---

## Verification Checklist

| Criterion | Status | Notes |
|-----------|--------|-------|
| Current Focus has active goal | Done | Set to this implementation |
| Planned has 4+ items from PRDs | Done | Backfilled from spark-enhancements/ |
| PRD edits auto-sync to Planned | Ready | Path fix deployed, needs trigger |
| Planning sessions update Current Focus | Ready | Requires ExitPlanMode |
| Users can manually manage ROADMAP | Done | `/roadmap` skill created |
| Hook errors are visible | Done | All 4 hooks updated |

---

## Files Changed

| File | Change Type | Purpose |
|------|-------------|---------|
| `.claude/hooks/src/prd-roadmap-sync.ts` | Modified | Fix path resolution |
| `.claude/hooks/src/post-plan-roadmap.ts` | Modified | Add error logging |
| `.claude/hooks/src/roadmap-completion.ts` | Modified | Add error logging |
| `.claude/hooks/src/git-commit-roadmap.ts` | Modified | Add error logging |
| `.claude/hooks/dist/*.mjs` | Rebuilt | Compiled hooks |
| `.claude/skills/roadmap/SKILL.md` | Created | New skill |
| `ROADMAP.md` | Modified | Set focus, backfill planned |

---

## Related Systems

### Integration Points

1. **Knowledge Tree**: Can reference `goals.source` from ROADMAP
2. **Memory System**: Planning decisions stored via `archival_memory`
3. **Git Hooks**: `git-commit-roadmap` auto-updates Completed section
4. **Task System**: `roadmap-completion` responds to TaskUpdate

### Dependencies

- `CLAUDE_PROJECT_DIR` environment variable for path resolution
- TypeScript/esbuild for hook compilation
- Git for commit detection

---

## ROADMAP Hook Reference

### prd-roadmap-sync

**Trigger:** PostToolUse (Write|Edit) for `prd-*.md` or `PRD-*.md` files

**Behavior:**
1. Extracts PRD metadata (title, status, priority)
2. Finds ROADMAP.md via recursive upward search
3. Adds new PRD to Planned section if not duplicate
4. Updates progress when tasks file changes

### post-plan-roadmap

**Trigger:** PostToolUse (ExitPlanMode)

**Behavior:**
1. Reads latest plan from `.claude/plans/` directory
2. Extracts title, decisions, steps, files
3. Updates Current Focus with new goal
4. Moves previous goal to Completed
5. Records planning session in Recent Planning

### git-commit-roadmap

**Trigger:** PostToolUse (Bash) matching `git commit`

**Behavior:**
1. Parses conventional commit message (feat:, fix:, etc.)
2. Skips chore, style, ci commits
3. Adds commit to Completed section with hash

### roadmap-completion

**Trigger:** PostToolUse (TaskUpdate with status=completed) or UserPromptSubmit with completion signals

**Behavior:**
1. Detects completion signals (tests passed, git push, "done")
2. Moves Current Focus to Completed
3. Optionally promotes next Planned item

---

## Future Enhancements

1. **PRD Auto-Discovery**: Scan for new PRD files on session start
2. **Progress Tracking**: Update ROADMAP with task completion percentages
3. **Archive Management**: Auto-archive stale planning sessions
4. **Conflict Resolution**: Handle concurrent ROADMAP updates
5. **Dashboard View**: Web UI for ROADMAP visualization

---

## Conclusion

ROADMAP.md is now a reliable, observable, and manually-governable source of truth for project status. The fix to path resolution enables PRD files anywhere in the project tree to trigger updates, error logging ensures failures are visible, and the `/roadmap` skill provides user control over automation gaps.

---

*Report generated: 2026-02-03*
*Implementation by: Claude Opus 4.5*
