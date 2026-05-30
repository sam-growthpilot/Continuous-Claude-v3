/**
 * Tests for shared parseRoadmap (Phase 3A consolidation).
 *
 * Consolidates three pre-existing hook-local copies:
 *   - post-plan-roadmap.ts        -> needs sessions tracking
 *   - roadmap-completion.ts       -> needs rawContent passthrough + handles "- [ ]" current
 *   - prd-roadmap-sync.ts         -> needs rawSections line-range map + raw priority
 *
 * The shared version unions these features. Each consumer ignores fields it
 * doesn't need. Tests verify the union covers every behavior every old copy had.
 */

import { describe, it, expect } from 'vitest';
import { parseRoadmap } from '../shared/roadmap-parser.js';

describe('parseRoadmap - well-formed doc', () => {
  it('parses current, completed, planned sections', () => {
    const content = `# Project Roadmap

## Current Focus

**Build feature X**
- Description of feature
- Started: 2026-04-01

## Completed

- [x] First milestone (2026-03-01)
- [x] Second milestone (2026-03-15)

## Planned

- [ ] Future work A (high)
- [ ] Future work B (low)
`;
    const result = parseRoadmap(content);
    expect(result.current).not.toBeNull();
    expect(result.current!.title).toBe('Build feature X');
    expect(result.current!.started).toBe('2026-04-01');
    expect(result.completed).toHaveLength(2);
    expect(result.completed[0].title).toBe('First milestone');
    expect(result.completed[0].completed).toBe('2026-03-01');
    expect(result.planned).toHaveLength(2);
    expect(result.planned[0].title).toBe('Future work A');
  });
});

describe('parseRoadmap - planned section priority handling', () => {
  it('returns raw priority text and a normalized priority bucket', () => {
    const content = `## Planned
- [ ] Item A (high)
- [ ] Item B (low)
- [ ] Item C (medium)
- [ ] Item D
`;
    const result = parseRoadmap(content);
    expect(result.planned).toHaveLength(4);

    // Raw priority (used by prd-roadmap-sync, roadmap-completion)
    expect(result.planned[0].priority).toBe('high');
    expect(result.planned[1].priority).toBe('low');
    expect(result.planned[2].priority).toBe('medium');
    expect(result.planned[3].priority).toBe('normal'); // default when no parens

    // Normalized bucket (used by post-plan-roadmap)
    expect(result.planned[0].priorityBucket).toBe('high');
    expect(result.planned[1].priorityBucket).toBe('low');
    expect(result.planned[2].priorityBucket).toBe('medium');
    expect(result.planned[3].priorityBucket).toBe('medium'); // default for normal/unknown
  });

  it('keeps a parenthesized title suffix and parses the trailing priority group', () => {
    // The title itself contains "(v2)"; only the LAST parenthesized group is
    // treated as priority. Regression guard for the non-greedy title capture.
    const result = parseRoadmap('## Planned\n- [ ] Fix auth bug (v2) (high priority)');
    expect(result.planned).toHaveLength(1);
    expect(result.planned[0].title).toBe('Fix auth bug (v2)');
    expect(result.planned[0].priorityBucket).toBe('high');
  });
});

describe('parseRoadmap - current section variants', () => {
  it('handles **Title** style', () => {
    const content = `## Current Focus

**Active goal**
- Description
- Started: 2026-04-15
`;
    const result = parseRoadmap(content);
    expect(result.current!.title).toBe('Active goal');
    expect(result.current!.description).toBe('Description');
    expect(result.current!.started).toBe('2026-04-15');
  });

  it('handles "- [ ] title" style (roadmap-completion behavior)', () => {
    const content = `## Current

- [ ] Active task
`;
    const result = parseRoadmap(content);
    expect(result.current).not.toBeNull();
    expect(result.current!.title).toBe('Active task');
  });

  it('joins multiple description lines with semicolons', () => {
    const content = `## Current

**Some goal**
- First detail
- Second detail
- Started: 2026-04-15
`;
    const result = parseRoadmap(content);
    expect(result.current!.description).toBe('First detail; Second detail');
    expect(result.current!.started).toBe('2026-04-15');
  });

  it('captures progress: line (prd-roadmap-sync behavior)', () => {
    const content = `## Current

**Feature X**
- Description of feature
- Started: 2026-04-01
- Progress: 3/10 tasks (30%)
`;
    const result = parseRoadmap(content);
    expect(result.current!.progress).toBe('3/10 tasks (30%)');
  });
});

describe('parseRoadmap - planning sessions (post-plan-roadmap behavior)', () => {
  it('parses ## Recent Planning Sessions block', () => {
    const content = `## Current

**Goal**

## Completed

## Recent Planning Sessions

### 2026-04-01: First plan
- Decision A
- Decision B

### 2026-04-15: Second plan
- Decision C
`;
    const result = parseRoadmap(content);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0].date).toBe('2026-04-01');
    expect(result.sessions[0].title).toBe('First plan');
    expect(result.sessions[0].decisions).toEqual(['Decision A', 'Decision B']);
    expect(result.sessions[1].date).toBe('2026-04-15');
    expect(result.sessions[1].decisions).toEqual(['Decision C']);
  });
});

describe('parseRoadmap - rawContent passthrough (roadmap-completion behavior)', () => {
  it('returns the original input on rawContent', () => {
    const content = `## Current
**Goal**
- Started: 2026-04-01
`;
    const result = parseRoadmap(content);
    expect(result.rawContent).toBe(content);
  });
});

describe('parseRoadmap - rawSections line ranges (prd-roadmap-sync behavior)', () => {
  it('records start/end line numbers for each section', () => {
    const content = [
      '# Roadmap',         // line 0
      '',                  // line 1
      '## Current',        // line 2
      '**Goal**',          // line 3
      '',                  // line 4
      '## Completed',      // line 5
      '- [x] Done',        // line 6
      '',                  // line 7
      '## Planned',        // line 8
      '- [ ] Plan A',      // line 9
    ].join('\n');

    const result = parseRoadmap(content);
    expect(result.rawSections.has('current')).toBe(true);
    expect(result.rawSections.has('completed')).toBe(true);
    expect(result.rawSections.has('planned')).toBe(true);

    const cur = result.rawSections.get('current')!;
    expect(cur.start).toBe(2);
    expect(cur.end).toBe(5);

    const comp = result.rawSections.get('completed')!;
    expect(comp.start).toBe(5);
    expect(comp.end).toBe(8);

    const plan = result.rawSections.get('planned')!;
    expect(plan.start).toBe(8);
    expect(plan.end).toBe(10);
  });
});

describe('parseRoadmap - edge cases', () => {
  it('returns empty structure for empty input', () => {
    const result = parseRoadmap('');
    expect(result.current).toBeNull();
    expect(result.completed).toEqual([]);
    expect(result.planned).toEqual([]);
    expect(result.sessions).toEqual([]);
  });

  it('returns empty structure for missing sections', () => {
    const result = parseRoadmap('# Just a title\n\nSome free text.\n');
    expect(result.current).toBeNull();
    expect(result.completed).toEqual([]);
    expect(result.planned).toEqual([]);
    expect(result.sessions).toEqual([]);
  });

  it('handles malformed (unclosed) section header gracefully', () => {
    const content = `## Current
**Title with no close
- Description
`;
    // Unclosed bold should NOT register as a current item.
    const result = parseRoadmap(content);
    expect(result.current).toBeNull();
  });

  it('is case-insensitive for section headers', () => {
    const content = `## CURRENT FOCUS

**X**

## COMPLETED

- [x] Done

## PLANNED

- [ ] Soon
`;
    const result = parseRoadmap(content);
    expect(result.current!.title).toBe('X');
    expect(result.completed).toHaveLength(1);
    expect(result.planned).toHaveLength(1);
  });

  it('does not match completed pattern when missing checkbox', () => {
    const content = `## Completed

- Just a bullet, no checkbox
- [x] Real entry
`;
    const result = parseRoadmap(content);
    expect(result.completed).toHaveLength(1);
    expect(result.completed[0].title).toBe('Real entry');
  });

  it('handles completed entries with optional date', () => {
    const content = `## Completed

- [x] No date entry
- [x] With date (2026-01-01)
`;
    const result = parseRoadmap(content);
    expect(result.completed).toHaveLength(2);
    expect(result.completed[0].title).toBe('No date entry');
    expect(result.completed[0].completed).toBe('');
    expect(result.completed[1].completed).toBe('2026-01-01');
  });
});
