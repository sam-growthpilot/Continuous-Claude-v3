/**
 * Tests for telemetry-tracker.ts Phase 3a Braintrust score emit.
 *
 * Validates the pure-helper layer for the skill_trigger_accuracy score:
 *   * resolveScoreSpanId prefers BRAINTRUST_SESSION_ID over payload session_id
 *   * buildSkillTriggerScorePayload returns the expected score + metadata
 *   * buildSkillTriggerScorePayload returns null when no spanId is available
 *
 * The actual emit call inside main() is fire-and-forget against the shared
 * emitBraintrustScore helper, which has its own 19-case test suite. We do not
 * re-test the network path here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  resolveScoreSpanId,
  buildSkillTriggerScorePayload,
} from '../telemetry-tracker.js';

function snapshotEnv(): Record<string, string | undefined> {
  return {
    BRAINTRUST_SESSION_ID: process.env.BRAINTRUST_SESSION_ID,
  };
}

function restoreEnv(snap: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

describe('telemetry-tracker: resolveScoreSpanId', () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    delete process.env.BRAINTRUST_SESSION_ID;
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it('prefers BRAINTRUST_SESSION_ID env when set', () => {
    process.env.BRAINTRUST_SESSION_ID = 'env-span-abc';
    expect(resolveScoreSpanId('payload-session-xyz')).toBe('env-span-abc');
  });

  it('falls back to payload session_id when env is unset', () => {
    expect(resolveScoreSpanId('payload-session-xyz')).toBe('payload-session-xyz');
  });

  it('falls back to payload session_id when env is empty string', () => {
    process.env.BRAINTRUST_SESSION_ID = '';
    expect(resolveScoreSpanId('payload-session-xyz')).toBe('payload-session-xyz');
  });

  it('trims whitespace from env value', () => {
    process.env.BRAINTRUST_SESSION_ID = '  env-span-trimmed  ';
    expect(resolveScoreSpanId('payload-session-xyz')).toBe('env-span-trimmed');
  });

  it('returns empty string when both sources are missing', () => {
    expect(resolveScoreSpanId(undefined)).toBe('');
  });
});

describe('telemetry-tracker: buildSkillTriggerScorePayload', () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    delete process.env.BRAINTRUST_SESSION_ID;
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it('returns null when no spanId is available', () => {
    const payload = buildSkillTriggerScorePayload({
      sessionId: undefined,
      skillName: 'memory',
      triggerSource: 'llm',
      success: true,
    });
    expect(payload).toBeNull();
  });

  it('emits 1.0 score when success is true', () => {
    const payload = buildSkillTriggerScorePayload({
      sessionId: 'span-abc',
      skillName: 'memory',
      triggerSource: 'llm',
      success: true,
    });
    expect(payload).not.toBeNull();
    expect(payload!.spanId).toBe('span-abc');
    expect(payload!.scores).toEqual({ skill_trigger_accuracy: 1.0 });
  });

  it('emits 0.0 score when success is false', () => {
    const payload = buildSkillTriggerScorePayload({
      sessionId: 'span-abc',
      skillName: 'memory',
      triggerSource: 'llm',
      success: false,
    });
    expect(payload).not.toBeNull();
    expect(payload!.scores).toEqual({ skill_trigger_accuracy: 0.0 });
  });

  it('includes skill_name, trigger_source, hook in metadata', () => {
    const payload = buildSkillTriggerScorePayload({
      sessionId: 'span-abc',
      skillName: 'systematic-debugging',
      triggerSource: 'explicit',
      success: true,
    });
    expect(payload!.metadata).toEqual({
      skill_name: 'systematic-debugging',
      trigger_source: 'explicit',
      hook: 'telemetry-tracker',
    });
  });

  it('prefers BRAINTRUST_SESSION_ID env over sessionId arg', () => {
    process.env.BRAINTRUST_SESSION_ID = 'env-span-xyz';
    const payload = buildSkillTriggerScorePayload({
      sessionId: 'payload-span-abc',
      skillName: 'memory',
      triggerSource: 'hook',
      success: true,
    });
    expect(payload!.spanId).toBe('env-span-xyz');
  });
});
