/**
 * no-haiku-enforcer — regression tests for BOTH deny paths (env-var standing guard
 * + haiku block). The env value is injected explicitly so tests are deterministic
 * regardless of the real process environment.
 */
import { describe, it, expect } from 'vitest';
import { decide } from '../no-haiku-enforcer.js';

describe('no-haiku-enforcer — CLAUDE_CODE_SUBAGENT_MODEL standing guard', () => {
  it('denies a Task spawn when the env var is set', () => {
    const out = decide({ tool: 'Task', tool_input: {} }, 'opus');
    expect(out?.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out?.hookSpecificOutput.permissionDecisionReason).toContain('CLAUDE_CODE_SUBAGENT_MODEL');
  });

  it('denies an Agent spawn too, even with an otherwise-valid model', () => {
    expect(decide({ tool: 'Agent', tool_input: { model: 'sonnet' } }, 'sonnet')?.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('ignores non-spawn tools even when the env var is set', () => {
    expect(decide({ tool: 'Bash', tool_input: {} }, 'opus')).toBeNull();
  });
});

describe('no-haiku-enforcer — haiku block (env unset)', () => {
  it('denies model=haiku', () => {
    const out = decide({ tool: 'Task', tool_input: { model: 'haiku' } }, undefined);
    expect(out?.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out?.hookSpecificOutput.permissionDecisionReason).toContain('haiku');
  });

  it('denies case-insensitively (HAIKU)', () => {
    expect(decide({ tool: 'Agent', tool_input: { model: 'HAIKU' } }, undefined)?.hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('no-haiku-enforcer — passthrough (env unset)', () => {
  it('allows sonnet', () => {
    expect(decide({ tool: 'Task', tool_input: { model: 'sonnet' } }, undefined)).toBeNull();
  });

  it('allows opus', () => {
    expect(decide({ tool: 'Task', tool_input: { model: 'opus' } }, undefined)).toBeNull();
  });

  it('allows omitted model', () => {
    expect(decide({ tool: 'Task', tool_input: {} }, undefined)).toBeNull();
  });

  it('ignores non-spawn tools', () => {
    expect(decide({ tool: 'Bash', tool_input: { model: 'haiku' } }, undefined)).toBeNull();
  });
});
