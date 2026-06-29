/**
 * tldr-context-inject — findProjectRoot termination (F5)
 *
 * Regression guard: the prior `while (current !== '/')` never terminated on a
 * Windows drive root, and QW-04 made this hook live on every PreToolUse:Task
 * spawn. These tests would HANG (vitest test-timeout fail) if the loop ever
 * regressed to a non-terminating form.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { findProjectRoot } from '../tldr-context-inject.js';

describe('findProjectRoot', () => {
  it('terminates (does not hang) walking a deep path up to the fs root', () => {
    // The regression being guarded is non-termination on a Windows drive root.
    // The test COMPLETING is the proof (it would hit vitest's timeout if the loop
    // never terminated). We only assert it returns a string — the exact value
    // depends on whether any real ancestor happens to hold a marker.
    const deep = join(tmpdir(), 'tldr-fpr-nomarker', 'a', 'b', 'c');
    const result = findProjectRoot(deep);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('finds the nearest ancestor containing a marker', () => {
    const base = mkdtempSync(join(tmpdir(), 'tldr-fpr-'));
    try {
      writeFileSync(join(base, 'package.json'), '{}');
      const nested = join(base, 'src', 'deep');
      mkdirSync(nested, { recursive: true });
      expect(findProjectRoot(nested)).toBe(base);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
