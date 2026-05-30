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
import { parseRoadmap } from '../shared/roadmap-parser.js';
import { applyRoadmapUpdate, demoteCurrentFocusToPlanned } from '../post-plan-roadmap.js';

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

/**
 * applyRoadmapUpdate: regenerate the 4 managed sections in place, splice every
 * other line (intro prose, `## Notes`, loose prose) back verbatim. Round-trips
 * through the shared parser so rawContent/rawSections come from real parsing.
 */
describe('applyRoadmapUpdate', () => {
  it('preserves a ## Notes block byte-for-byte while regenerating Current Focus', () => {
    const fixture = [
      '# Project Roadmap',
      '',
      '## Current Focus',
      '**Old goal**',
      '- Started: 2026-01-01',
      '',
      '## Notes',
      '- remember to check the rate limiter',
      '- ping Danny about the staging creds',
      '',
      '## Completed',
      '- [x] Initial scaffolding (2025-12-01)',
      '',
      '## Planned',
      '- [ ] Future thing (high priority)',
      '',
    ].join('\n');

    const parsed = parseRoadmap(fixture);
    // Simulate main() mutating the structured Current Focus to the new plan.
    parsed.current = { title: 'New goal', started: '2026-05-30' };

    const out = applyRoadmapUpdate(parsed);

    // The notes block survives verbatim (header + both bullets + trailing blank).
    const notesBlock = [
      '## Notes',
      '- remember to check the rate limiter',
      '- ping Danny about the staging creds',
      '',
    ].join('\n');
    expect(out).toContain(notesBlock);

    // Current Focus reflects the mutated value, and the old title is gone.
    expect(out).toContain('## Current Focus\n**New goal**');
    expect(out).not.toContain('**Old goal**');

    // The other managed sections are still present.
    expect(out).toContain('## Completed');
    expect(out).toContain('## Planned');
  });

  it('preserves intro prose and keeps a ## Notes placed ABOVE Current Focus in position', () => {
    const fixture = [
      '# Project Roadmap',
      '',
      'This roadmap is hand-curated. Read the notes before editing.',
      '',
      '## Notes',
      '- top-of-file reminder',
      '',
      '## Current Focus',
      '**Old goal**',
      '',
      '## Completed',
      '- [x] Thing (2025-11-01)',
      '',
    ].join('\n');

    const parsed = parseRoadmap(fixture);
    parsed.current = { title: 'Fresh goal' };

    const out = applyRoadmapUpdate(parsed);

    // Intro prose preserved verbatim.
    expect(out).toContain('This roadmap is hand-curated. Read the notes before editing.');
    // Notes block preserved.
    expect(out).toContain('## Notes\n- top-of-file reminder');
    // Position: Notes appears BEFORE Current Focus in the output.
    expect(out.indexOf('## Notes')).toBeLessThan(out.indexOf('## Current Focus'));
    // Current Focus regenerated.
    expect(out).toContain('## Current Focus\n**Fresh goal**');
    expect(out).not.toContain('**Old goal**');
  });

  it('preserves loose prose that sits between managed sections (separated by an unmanaged header)', () => {
    // The parser extends a managed section's range to the next "## " header, so
    // text demarcated by an unmanaged header is the unit that lands BETWEEN two
    // managed sections in the verbatim-splice path.
    const fixture = [
      '# Project Roadmap',
      '',
      '## Current Focus',
      '**Goal**',
      '',
      '## Scratch',
      'Loose prose sitting between Current Focus and Completed.',
      'A second loose line.',
      '',
      '## Completed',
      '- [x] Done (2025-10-01)',
      '',
    ].join('\n');

    const parsed = parseRoadmap(fixture);
    parsed.current = { title: 'Goal' }; // unchanged title, still regenerates in place

    const out = applyRoadmapUpdate(parsed);

    const looseBlock = [
      '## Scratch',
      'Loose prose sitting between Current Focus and Completed.',
      'A second loose line.',
    ].join('\n');
    expect(out).toContain(looseBlock);
    // The unmanaged block stays between the two managed sections.
    const looseIdx = out.indexOf('Loose prose sitting between');
    expect(looseIdx).toBeGreaterThan(out.indexOf('## Current Focus'));
    expect(looseIdx).toBeLessThan(out.indexOf('## Completed'));
  });

  it('preserves a trailing unmanaged section after the last managed section', () => {
    const fixture = [
      '# Project Roadmap',
      '',
      '## Current Focus',
      '**Goal**',
      '',
      '## Completed',
      '- [x] Done (2025-10-01)',
      '',
      '## Scratch',
      'Trailing free-form prose after the last managed section.',
      'Another trailing line.',
      '',
    ].join('\n');

    const parsed = parseRoadmap(fixture);
    parsed.current = { title: 'Goal' };

    const out = applyRoadmapUpdate(parsed);

    const trailingBlock = [
      '## Scratch',
      'Trailing free-form prose after the last managed section.',
      'Another trailing line.',
    ].join('\n');
    expect(out).toContain(trailingBlock);
    // Trailing block stays after the last managed section.
    expect(out.indexOf('Trailing free-form prose')).toBeGreaterThan(out.indexOf('## Completed'));
  });

  it('appends a Planned section when the original is missing it', () => {
    const fixture = [
      '# Project Roadmap',
      '',
      '## Current Focus',
      '**Goal**',
      '',
      '## Completed',
      '- [x] Done (2025-09-01)',
      '',
    ].join('\n');

    const parsed = parseRoadmap(fixture);
    expect(parsed.rawSections.has('planned')).toBe(false);
    parsed.planned = [{ title: 'Newly planned', priorityBucket: 'high' }];

    const out = applyRoadmapUpdate(parsed);

    expect(out).toContain('## Planned');
    expect(out).toContain('- [ ] Newly planned (high priority)');
    // Existing managed sections still present, in original order.
    expect(out.indexOf('## Current Focus')).toBeLessThan(out.indexOf('## Completed'));
    // The appended Planned comes after the originally-present sections.
    expect(out.indexOf('## Completed')).toBeLessThan(out.indexOf('## Planned'));
  });

  it('falls back to canonical generateRoadmap output for an empty/fresh file', () => {
    const parsed = parseRoadmap('');
    parsed.current = { title: 'First goal' };

    const out = applyRoadmapUpdate(parsed);

    expect(out.startsWith('# Project Roadmap')).toBe(true);
    expect(out).toContain('## Current Focus\n**First goal**');
    expect(out).toContain('## Completed');
    expect(out).toContain('## Planned');
    expect(out).toContain('## Recent Planning Sessions');
  });

  it('integrates with demoteCurrentFocusToPlanned: demoted focus appears in regenerated Planned', () => {
    const fixture = [
      '# Project Roadmap',
      '',
      '## Current Focus',
      '**Old goal**',
      '',
      '## Notes',
      '- keep me',
      '',
      '## Planned',
      '- [ ] Existing plan (medium priority)',
      '',
    ].join('\n');

    const parsed = parseRoadmap(fixture);
    demoteCurrentFocusToPlanned(parsed, 'New goal');
    parsed.current = { title: 'New goal' };

    const out = applyRoadmapUpdate(parsed);

    // New focus regenerated; old focus demoted into Planned.
    expect(out).toContain('## Current Focus\n**New goal**');
    expect(out).toContain('- [ ] Old goal (high priority)');
    expect(out).toContain('- [ ] Existing plan (medium priority)');
    // Notes preserved through the round-trip.
    expect(out).toContain('## Notes\n- keep me');
  });
});
