/**
 * Tests for post-plan-roadmap's focus-transition helper.
 *
 * Regression guard: previously, switching the Current Focus to a new plan
 * title stamped the OLD focus as `completed: today` -- mis-recording "I
 * switched focus" as "I finished the prior goal". The fix demotes the old
 * focus back into Planned (the backlog) instead, and the caller reassigns
 * Current Focus separately.
 *
 * Pure-function test (no fs / no stdin), following the git-commit-roadmap
 * pure-helper convention.
 */

import { describe, it, expect } from 'vitest';
import type { RoadmapDoc } from '../shared/roadmap-parser.js';
import { demoteCurrentFocusToPlanned } from '../post-plan-roadmap.js';

function makeDoc(current: RoadmapDoc['current']): RoadmapDoc {
  return {
    current,
    completed: [],
    planned: [],
    sessions: [],
    rawContent: '',
    rawSections: new Map(),
  };
}

describe('demoteCurrentFocusToPlanned', () => {
  it('demotes the prior focus into Planned (not Completed) when title changes', () => {
    const sections = makeDoc({ title: 'Goal A' });
    demoteCurrentFocusToPlanned(sections, 'Goal B');

    // Demoted into the backlog as a high-priority planned item.
    expect(sections.planned).toHaveLength(1);
    expect(sections.planned[0].title).toBe('Goal A');
    expect(sections.planned[0].priorityBucket).toBe('high');

    // The core regression assertion: NOT pushed to completed.
    expect(sections.completed.length).toBe(0);

    // The helper only demotes; the caller reassigns current.
    expect(sections.current).toEqual({ title: 'Goal A' });
  });

  it('is a no-op when the new title equals the current title', () => {
    const sections = makeDoc({ title: 'Goal A' });
    demoteCurrentFocusToPlanned(sections, 'Goal A');
    expect(sections.planned).toHaveLength(0);
    expect(sections.completed).toHaveLength(0);
  });

  it('does not duplicate an item already present in Planned', () => {
    const sections = makeDoc({ title: 'Goal A' });
    sections.planned.push({
      title: 'Goal A',
      priority: 'high',
      priorityBucket: 'high',
    });
    demoteCurrentFocusToPlanned(sections, 'Goal B');
    expect(sections.planned).toHaveLength(1);
  });

  it('is a no-op (no throw) when there is no current focus', () => {
    const sections = makeDoc(null);
    expect(() => demoteCurrentFocusToPlanned(sections, 'Goal B')).not.toThrow();
    expect(sections.planned).toHaveLength(0);
  });
});
