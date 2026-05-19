/**
 * Tests for plan-mode-approval-gate PreToolUse hook.
 *
 * The gate forces an interactive approval dialog before ExitPlanMode runs,
 * even in --dangerously-skip-permissions mode. PreToolUse "ask" decisions
 * survive bypass mode (unlike PermissionRequest, which is skipped entirely).
 *
 * Decision matrix:
 *   - Non-ExitPlanMode tool                              -> allow
 *   - ExitPlanMode + BYPASS_PLAN_GATE=1                  -> allow
 *   - ExitPlanMode + /goal active                        -> allow
 *   - ExitPlanMode + Ralph active                        -> allow
 *   - ExitPlanMode + no bypass + no goal + no Ralph      -> ask
 */

import { describe, it, expect } from 'vitest';
import {
  decideGate,
  detectGoalActiveFromTranscript,
  mangleProjectDir,
} from '../plan-mode-approval-gate.js';

describe('decideGate', () => {
  const base = {
    toolName: 'ExitPlanMode',
    bypassEnv: false,
    ralphActive: false,
    goalActive: false,
  };

  it('allows non-ExitPlanMode tools', () => {
    expect(decideGate({ ...base, toolName: 'Bash' }).action).toBe('allow');
  });

  it('allows when toolName is undefined', () => {
    expect(decideGate({ ...base, toolName: undefined }).action).toBe('allow');
  });

  it('allows ExitPlanMode when BYPASS_PLAN_GATE=1', () => {
    expect(decideGate({ ...base, bypassEnv: true }).action).toBe('allow');
  });

  it('allows ExitPlanMode when /goal is active', () => {
    expect(decideGate({ ...base, goalActive: true }).action).toBe('allow');
  });

  it('allows ExitPlanMode when Ralph is active', () => {
    expect(decideGate({ ...base, ralphActive: true }).action).toBe('allow');
  });

  it('asks for confirmation when no bypass signal is set', () => {
    const result = decideGate(base);
    expect(result.action).toBe('ask');
    if (result.action === 'ask') {
      expect(result.reason).toContain('Plan-mode approval gate');
      expect(result.reason).toContain('BYPASS_PLAN_GATE=1');
      expect(result.reason).toContain('/goal');
      expect(result.reason).toContain('/ralph');
    }
  });

  it('bypass env takes priority over ask', () => {
    expect(decideGate({ ...base, bypassEnv: true, goalActive: false, ralphActive: false }).action).toBe('allow');
  });
});

describe('mangleProjectDir', () => {
  it('replaces non-alphanumeric characters with dashes', () => {
    expect(mangleProjectDir('C:/Users/david.hayes/continuous-claude')).toBe(
      'C--Users-david-hayes-continuous-claude',
    );
  });

  it('handles backslash paths', () => {
    expect(mangleProjectDir('C:\\Users\\david.hayes\\project')).toBe(
      'C--Users-david-hayes-project',
    );
  });

  it('handles unix paths', () => {
    expect(mangleProjectDir('/home/user/proj')).toBe('-home-user-proj');
  });
});

describe('detectGoalActiveFromTranscript', () => {
  function attachmentLine(att: Record<string, unknown>): string {
    return JSON.stringify({ type: 'attachment', attachment: att, otherField: 1 });
  }

  it('returns null for empty input', () => {
    expect(detectGoalActiveFromTranscript('')).toBe(null);
  });

  it('returns null when no goal_status attachments exist', () => {
    const text = ['{"type":"user","content":"hi"}', '{"type":"assistant","content":"hello"}'].join('\n');
    expect(detectGoalActiveFromTranscript(text)).toBe(null);
  });

  it('returns true when latest goal_status is sentinel=true, met=false', () => {
    const text = [
      attachmentLine({ type: 'goal_status', sentinel: true, met: false, condition: 'do X' }),
      '{"type":"assistant","content":"working"}',
    ].join('\n');
    expect(detectGoalActiveFromTranscript(text)).toBe(true);
  });

  it('returns false when latest goal_status is met=true (goal complete)', () => {
    const text = [
      attachmentLine({ type: 'goal_status', sentinel: true, met: false }),
      attachmentLine({ type: 'goal_status', sentinel: true, met: true }),
    ].join('\n');
    expect(detectGoalActiveFromTranscript(text)).toBe(false);
  });

  it('returns false when latest goal_status is sentinel=false (goal cleared)', () => {
    const text = [
      attachmentLine({ type: 'goal_status', sentinel: true, met: false }),
      attachmentLine({ type: 'goal_status', sentinel: false, met: false }),
    ].join('\n');
    expect(detectGoalActiveFromTranscript(text)).toBe(false);
  });

  it('returns true when a single goal_status (sentinel/active) is the only entry', () => {
    // Real-world case: harness emits one goal_status when /goal fires.
    const text = attachmentLine({ type: 'goal_status', sentinel: true, met: false });
    expect(detectGoalActiveFromTranscript(text)).toBe(true);
  });

  it('skips lines that mention goal_status but are not valid attachments', () => {
    // E.g., a bash command that grepped for "goal_status" leaves traces.
    const text = [
      '{"type":"tool_use","input":{"command":"grep goal_status"}}',
      attachmentLine({ type: 'goal_status', sentinel: true, met: false }),
    ].join('\n');
    expect(detectGoalActiveFromTranscript(text)).toBe(true);
  });

  it('returns null when the only match is a bash command mentioning goal_status', () => {
    const text = '{"type":"tool_use","input":{"command":"grep goal_status"}}';
    expect(detectGoalActiveFromTranscript(text)).toBe(null);
  });

  it('ignores malformed JSON lines', () => {
    const text = [
      '{this is not json but mentions "goal_status"}',
      attachmentLine({ type: 'goal_status', sentinel: true, met: false }),
    ].join('\n');
    expect(detectGoalActiveFromTranscript(text)).toBe(true);
  });
});
