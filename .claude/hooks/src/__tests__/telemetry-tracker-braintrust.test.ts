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
  buildToolResponseKeys,
} from '../telemetry-tracker.js';
import { detectToolError } from '../shared/tool-error.js';

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

// ---------------------------------------------------------------------------
// Gate B2 — integration: detectToolError → buildSkillTriggerScorePayload
//
// Plan-spec'd 6 cases: 5 error indicators + 1 "no error flags = success".
// Each case asserts the score that REACHES the payload is 0.0 (failure) or
// 1.0 (success) — proving the new detector is wired through the path that
// emits scores to Braintrust.
//
// This is the integration layer: detectToolError is unit-tested with all
// branches in __tests__/tool-error.test.ts; here we verify the composition.
// ---------------------------------------------------------------------------
describe('telemetry-tracker: detectToolError → score payload integration', () => {
  it('error indicator #1 — is_error===true → score 0.0', () => {
    const success = !detectToolError({ is_error: true });
    const payload = buildSkillTriggerScorePayload({
      sessionId: 'span-1',
      skillName: 'memory',
      triggerSource: 'llm',
      success,
    });
    expect(payload!.scores).toEqual({ skill_trigger_accuracy: 0.0 });
  });

  it('error indicator #2 — error: non-empty string → score 0.0', () => {
    const success = !detectToolError({ error: 'something broke' });
    const payload = buildSkillTriggerScorePayload({
      sessionId: 'span-2',
      skillName: 'memory',
      triggerSource: 'llm',
      success,
    });
    expect(payload!.scores).toEqual({ skill_trigger_accuracy: 0.0 });
  });

  it('error indicator #3 — error===true → score 0.0', () => {
    const success = !detectToolError({ error: true });
    const payload = buildSkillTriggerScorePayload({
      sessionId: 'span-3',
      skillName: 'memory',
      triggerSource: 'llm',
      success,
    });
    expect(payload!.scores).toEqual({ skill_trigger_accuracy: 0.0 });
  });

  it('error indicator #4 — success===false → score 0.0', () => {
    const success = !detectToolError({ success: false });
    const payload = buildSkillTriggerScorePayload({
      sessionId: 'span-4',
      skillName: 'memory',
      triggerSource: 'llm',
      success,
    });
    expect(payload!.scores).toEqual({ skill_trigger_accuracy: 0.0 });
  });

  it('error indicator #5 — status==="error" (backward compat) → score 0.0', () => {
    const success = !detectToolError({ status: 'error' });
    const payload = buildSkillTriggerScorePayload({
      sessionId: 'span-5',
      skillName: 'memory',
      triggerSource: 'llm',
      success,
    });
    expect(payload!.scores).toEqual({ skill_trigger_accuracy: 0.0 });
  });

  it('no error flags (empty object) → success → score 1.0', () => {
    const success = !detectToolError({});
    const payload = buildSkillTriggerScorePayload({
      sessionId: 'span-6',
      skillName: 'memory',
      triggerSource: 'llm',
      success,
    });
    expect(payload!.scores).toEqual({ skill_trigger_accuracy: 1.0 });
  });
});

// ---------------------------------------------------------------------------
// Gate B2 — buildToolResponseKeys instrumentation
//
// Plan-spec'd 2 cases: (1) keys populated when tool_response has fields,
// (2) keys is [] when tool_response is null/undefined. Confirms the
// empirical instrumentation field will surface field names in the jsonl
// telemetry so we can audit what Claude Code actually sends.
// ---------------------------------------------------------------------------
describe('telemetry-tracker: buildToolResponseKeys', () => {
  it('populates keys array when tool_response has fields', () => {
    const keys = buildToolResponseKeys({ is_error: true, output: 'boom' });
    expect(keys).toEqual(expect.arrayContaining(['is_error', 'output']));
    expect(keys.length).toBe(2);
  });

  it('returns [] when tool_response is undefined', () => {
    expect(buildToolResponseKeys(undefined)).toEqual([]);
  });

  it('returns [] when tool_response is null', () => {
    expect(buildToolResponseKeys(null)).toEqual([]);
  });

  it('returns [] when tool_response is not an object', () => {
    // Defensive: a non-object payload should not crash; produce []
    expect(buildToolResponseKeys('error')).toEqual([]);
    expect(buildToolResponseKeys(42)).toEqual([]);
  });

  it('returns [] for an empty object', () => {
    expect(buildToolResponseKeys({})).toEqual([]);
  });

  it('captures all four error-indicator field names when present', () => {
    // The empirical scenario we most want to detect: Claude Code emitting
    // any of the four detector fields. This test documents the expected
    // shape of a fully-populated failure payload.
    const keys = buildToolResponseKeys({
      is_error: true,
      error: 'boom',
      success: false,
      status: 'error',
    });
    expect(keys.sort()).toEqual(['error', 'is_error', 'status', 'success']);
  });
});
