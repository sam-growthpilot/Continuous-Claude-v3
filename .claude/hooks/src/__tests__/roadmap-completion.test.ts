/**
 * Tests for roadmap-completion PostToolUse(TaskUpdate) branch.
 *
 * Regression guard: a prior session saw ROADMAP.md corrupted ~10x/session
 * because handleTaskUpdate unconditionally rewrote the file on EVERY
 * TaskUpdate->completed (blanked Current Focus, promoted next Planned).
 * The fix makes that branch advisory-only: it NEVER writes.
 *
 * Follows the roadmap-reconcile.test.ts convention (vitest, mkdtempSync temp
 * dir created in beforeEach, rmSync in afterEach).
 *
 * fs is mocked with vi.mock (the codebase-idiomatic pattern -- vi.spyOn(fs,...)
 * fails under ESM: "Module namespace is not configurable"; see the comment in
 * hook-trace.test.ts). writeFileSync is a vi.fn() spy delegating to the real
 * implementation, so we can assert it is NEVER called by the TaskUpdate branch
 * (premortem mitigation: catches a write to ANY path, not just the target),
 * while all reads / temp-dir ops remain real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock is hoisted above imports, so the spy it references must be created
// inside vi.hoisted() (also hoisted) -- a plain top-level const is not yet
// initialized when the mock factory runs.
const { writeSpy } = vi.hoisted(() => ({ writeSpy: vi.fn() }));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  // Delegate to the real writeFileSync so any (unexpected) write still works,
  // while letting us assert the TaskUpdate branch never calls it.
  writeSpy.mockImplementation(actual.writeFileSync as any);
  return { ...actual, writeFileSync: writeSpy };
});

const actualFs = await vi.importActual<typeof import('fs')>('fs');

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  buildTaskCompletionAdvisory,
  handleTaskUpdate,
} from '../roadmap-completion.js';

const FIXTURE_ROADMAP = `# Project Roadmap

## Current Focus

**Implement OAuth login**
- Started: 2026-05-01

## Completed
- [x] Scaffold project (2026-04-20)

## Planned
- [ ] Add rate limiting (high priority)
`;

// ---------------------------------------------------------------------------
// Unit: buildTaskCompletionAdvisory
// ---------------------------------------------------------------------------

describe('buildTaskCompletionAdvisory', () => {
  it('returns an advisory naming the Current Focus title', () => {
    const advisory = buildTaskCompletionAdvisory(FIXTURE_ROADMAP);
    expect(advisory).not.toBeNull();
    expect(advisory).toContain('Implement OAuth login');
  });

  it('returns null when there is no current goal placeholder', () => {
    const advisory = buildTaskCompletionAdvisory(
      '# R\n## Current Focus\n\n_No current goal._\n',
    );
    expect(advisory).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(buildTaskCompletionAdvisory('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: handleTaskUpdate (the regression guard)
// ---------------------------------------------------------------------------

describe('handleTaskUpdate', () => {
  let tempDir: string;
  let roadmapPath: string;

  beforeEach(() => {
    writeSpy.mockClear();
    tempDir = actualFs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-completion-test-'));
    roadmapPath = path.join(tempDir, 'ROADMAP.md');
  });

  afterEach(() => {
    actualFs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('is advisory-only: never writes and leaves ROADMAP byte-identical', async () => {
    actualFs.writeFileSync(roadmapPath, FIXTURE_ROADMAP);
    const before = fs.readFileSync(roadmapPath, 'utf-8');

    writeSpy.mockClear();
    const result = await handleTaskUpdate(
      {
        tool_name: 'TaskUpdate',
        tool_input: { status: 'completed', taskId: 'unrelated-1' },
      } as any,
      tempDir,
    );

    // The invariant: this branch must never call writeFileSync (to ANY path).
    expect(writeSpy).not.toHaveBeenCalled();

    // File untouched: Current Focus not blanked, no new Completed entry,
    // "Add rate limiting" NOT promoted into Current Focus.
    expect(fs.readFileSync(roadmapPath, 'utf-8')).toBe(before);

    // Returns an advisory continue, surfaced via additionalContext.
    expect(result.result).toBe('continue');
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput!.additionalContext).toContain(
      'Implement OAuth login',
    );
  });

  it('does nothing for non-completed status (in_progress)', async () => {
    actualFs.writeFileSync(roadmapPath, FIXTURE_ROADMAP);

    writeSpy.mockClear();
    const result = await handleTaskUpdate(
      {
        tool_name: 'TaskUpdate',
        tool_input: { status: 'in_progress', taskId: 'x' },
      } as any,
      tempDir,
    );

    expect(result.result).toBe('continue');
    expect(writeSpy).not.toHaveBeenCalled();
    expect(result.hookSpecificOutput).toBeUndefined();
  });
});
