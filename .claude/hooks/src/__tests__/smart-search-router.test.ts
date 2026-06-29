/**
 * smart-search-router — ripgrep argv injection-safety tests (Phase 1b, ST-08 slice)
 *
 * D2b-10 / GAP4-01: the ripgrep fallback previously interpolated a
 * model-controlled Grep pattern into an execSync shell string with naive
 * escaping (only `"` and `$`). buildRipgrepArgs returns an argv array consumed
 * by spawnSync(..., {shell:false}) so no shell ever sees the pattern — closing
 * the injection. Codex #1: `-e <pattern> -- <path>` keeps a leading-dash
 * pattern literal and terminates flag parsing before the path operand.
 */
import { describe, it, expect } from 'vitest';
import { buildRipgrepArgs } from '../smart-search-router.js';

describe('buildRipgrepArgs — injection-safe ripgrep argv', () => {
  it('passes the pattern via -e so a leading-dash pattern is literal, not a flag', () => {
    const args = buildRipgrepArgs('--files', '.');
    expect(args[0]).toBe('-e');
    expect(args[1]).toBe('--files'); // verbatim, treated as the search pattern
    expect(args).toContain('--');
    expect(args[args.length - 1]).toBe('.');
    expect(args.indexOf('--')).toBeLessThan(args.length - 1);
  });

  it('hands a shell-metachar payload through as a SINGLE verbatim argv element', () => {
    const payload = 'a" & calc & "b ; $(rm -rf /) `id`';
    const args = buildRipgrepArgs(payload, '/some/dir');
    expect(args[1]).toBe(payload); // exactly one element, byte-identical, no escaping
    expect(args.filter((a) => a === payload).length).toBe(1);
  });

  it('keeps the path after the -- terminator so a dash-leading path is not a flag', () => {
    const args = buildRipgrepArgs('foo', '-rf');
    const term = args.indexOf('--');
    expect(term).toBeGreaterThanOrEqual(0);
    expect(args.slice(term + 1)).toEqual(['-rf']);
  });

  it('preserves the original ripgrep flags (type/line-number/max-count)', () => {
    const args = buildRipgrepArgs('foo', '.');
    expect(args).toContain('--type');
    expect(args).toContain('py');
    expect(args).toContain('--line-number');
    expect(args).toContain('--max-count');
    expect(args).toContain('10');
  });
});
