/**
 * Tests for code-intel-enforcer (PreToolUse, Grep|Agent).
 *
 * Contract: DEFAULT OFF; even enabled it NEVER denies (no permissionDecision) -- it only
 * emits an `additionalContext` nudge on an EXACT route match. Activation via CCV3_FACADE_MODE
 * ("warn" enables; unset/invalid => off). Exercises the four required modes plus the
 * structural Grep matcher and the passive Agent path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { evaluate } from '../code-intel-enforcer.js';

describe('code-intel-enforcer', () => {
  const saved = process.env.CCV3_FACADE_MODE;
  beforeEach(() => {
    delete process.env.CCV3_FACADE_MODE;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CCV3_FACADE_MODE;
    else process.env.CCV3_FACADE_MODE = saved;
  });

  it('unset mode -> {} (allow, no output) even on a symbol-grep', () => {
    delete process.env.CCV3_FACADE_MODE;
    const out = evaluate({ tool: 'Grep', tool_input: { pattern: 'function foo' } });
    expect(out).toEqual({});
  });

  it('warn mode + Grep symbol-definition pattern -> additionalContext nudge (never denies)', () => {
    process.env.CCV3_FACADE_MODE = 'warn';
    const out = evaluate({ tool: 'Grep', tool_input: { pattern: 'function foo' } });
    expect(out.hookSpecificOutput?.additionalContext).toBeDefined();
    expect(out.hookSpecificOutput?.additionalContext).toMatch(/find-symbol foo/);
    // NEVER denies: no permissionDecision field anywhere.
    expect(JSON.stringify(out)).not.toMatch(/permissionDecision/);
  });

  it('warn mode + Grep non-symbol pattern -> {} (no fuzzy match)', () => {
    process.env.CCV3_FACADE_MODE = 'warn';
    const out = evaluate({ tool: 'Grep', tool_input: { pattern: 'TODO: refactor later' } });
    expect(out).toEqual({});
  });

  it('warn mode + Agent -> {} (registered but passive, no exact structural signal)', () => {
    process.env.CCV3_FACADE_MODE = 'warn';
    const out = evaluate({ tool: 'Agent', tool_input: { prompt: 'who calls parseArgs?' } });
    expect(out).toEqual({});
  });

  it('invalid mode -> treated as OFF (fail-open), {} even on a symbol-grep', () => {
    process.env.CCV3_FACADE_MODE = 'bogus-value';
    const out = evaluate({ tool: 'Grep', tool_input: { pattern: 'class Foo' } });
    expect(out).toEqual({});
  });

  it('warn mode matches def and class definition greps', () => {
    process.env.CCV3_FACADE_MODE = 'warn';
    expect(evaluate({ tool: 'Grep', tool_input: { pattern: 'def my_func' } }).hookSpecificOutput?.additionalContext).toMatch(/find-symbol my_func/);
    expect(evaluate({ tool: 'Grep', tool_input: { pattern: 'class Widget' } }).hookSpecificOutput?.additionalContext).toMatch(/find-symbol Widget/);
  });

  it('warn mode does NOT false-positive on keyword-substring words (\\b anchor)', () => {
    process.env.CCV3_FACADE_MODE = 'warn';
    expect(evaluate({ tool: 'Grep', tool_input: { pattern: 'myclass Widget' } })).toEqual({});
    expect(evaluate({ tool: 'Grep', tool_input: { pattern: 'subclass Foo' } })).toEqual({});
    expect(evaluate({ tool: 'Grep', tool_input: { pattern: 'defunct handler' } })).toEqual({});
  });

  it('activation is case/space-insensitive (intentional) but only for "warn"', () => {
    const grep = { tool: 'Grep', tool_input: { pattern: 'class Foo' } };
    // Enables: WARN / " warn " (opt-in, warn-only feature -- permissive enabling is safe).
    process.env.CCV3_FACADE_MODE = 'WARN';
    expect(evaluate(grep).hookSpecificOutput?.additionalContext).toBeDefined();
    process.env.CCV3_FACADE_MODE = '  warn  ';
    expect(evaluate(grep).hookSpecificOutput?.additionalContext).toBeDefined();
    // Stays OFF: unrelated truthy-ish values must NOT enable.
    for (const v of ['1', 'true', 'on', 'enabled', 'bogus']) {
      process.env.CCV3_FACADE_MODE = v;
      expect(evaluate(grep)).toEqual({});
    }
  });
});
