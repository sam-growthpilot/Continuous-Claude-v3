/**
 * Tests for ralph-task-monitor.ts Phase 3a Braintrust score emit.
 *
 * Validates the pure-helper layer for the agent_task_success score:
 *   * computeAgentTaskScore rubric: complete+0 retries = 1.0,
 *     complete+N retries = 0.5, failed = 0.0
 *   * buildAgentTaskScorePayload returns the expected score + metadata
 *   * buildAgentTaskScorePayload returns null when BRAINTRUST_SESSION_ID
 *     is unset (no orphan scores)
 *
 * The actual emit call from the hook is fire-and-forget against the shared
 * emitBraintrustScore helper, which has its own 19-case test suite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  computeAgentTaskScore,
  buildAgentTaskScorePayload,
} from '../ralph-task-monitor.js';

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

describe('ralph-task-monitor: computeAgentTaskScore', () => {
  it('returns 1.0 for clean completion (complete + 0 retries)', () => {
    expect(computeAgentTaskScore({
      taskId: '1.0',
      transition: 'complete',
      retries: 0,
    })).toBe(1.0);
  });

  it('returns 0.5 for recovered completion (complete + N retries)', () => {
    expect(computeAgentTaskScore({
      taskId: '1.0',
      transition: 'complete',
      retries: 1,
    })).toBe(0.5);
    expect(computeAgentTaskScore({
      taskId: '1.0',
      transition: 'complete',
      retries: 3,
    })).toBe(0.5);
  });

  it('returns 0.0 for failed transition regardless of retries', () => {
    expect(computeAgentTaskScore({
      taskId: '1.0',
      transition: 'failed',
      retries: 0,
    })).toBe(0.0);
    expect(computeAgentTaskScore({
      taskId: '1.0',
      transition: 'failed',
      retries: 2,
    })).toBe(0.0);
  });

  it('treats missing retries field as 0 (defensive default)', () => {
    expect(computeAgentTaskScore({
      taskId: '1.0',
      transition: 'complete',
    })).toBe(1.0);
  });
});

describe('ralph-task-monitor: buildAgentTaskScorePayload', () => {
  let envSnap: Record<string, string | undefined>;

  beforeEach(() => {
    envSnap = snapshotEnv();
    delete process.env.BRAINTRUST_SESSION_ID;
  });

  afterEach(() => {
    restoreEnv(envSnap);
  });

  it('returns null when BRAINTRUST_SESSION_ID is unset (no orphan scores)', () => {
    const payload = buildAgentTaskScorePayload({
      taskId: '1.0',
      transition: 'complete',
      retries: 0,
    });
    expect(payload).toBeNull();
  });

  it('returns null when BRAINTRUST_SESSION_ID is empty string', () => {
    process.env.BRAINTRUST_SESSION_ID = '';
    const payload = buildAgentTaskScorePayload({
      taskId: '1.0',
      transition: 'complete',
      retries: 0,
    });
    expect(payload).toBeNull();
  });

  it('emits agent_task_success score with span id and metadata', () => {
    process.env.BRAINTRUST_SESSION_ID = 'span-root-abc';
    const payload = buildAgentTaskScorePayload({
      taskId: '2.0',
      taskName: 'Phase 2 - Easy wins',
      agent: 'kraken',
      retries: 0,
      durationS: 13894.4,
      transition: 'complete',
    });
    expect(payload).not.toBeNull();
    expect(payload!.spanId).toBe('span-root-abc');
    expect(payload!.scores).toEqual({ agent_task_success: 1.0 });
    expect(payload!.metadata).toEqual({
      task_id: '2.0',
      task_name: 'Phase 2 - Easy wins',
      agent: 'kraken',
      retries: 0,
      duration_s: 13894.4,
      transition: 'complete',
      hook: 'ralph-task-monitor',
    });
  });

  it('emits 0.5 score with retries > 0', () => {
    process.env.BRAINTRUST_SESSION_ID = 'span-root-abc';
    const payload = buildAgentTaskScorePayload({
      taskId: '3.0',
      agent: 'spark',
      retries: 2,
      transition: 'complete',
    });
    expect(payload!.scores).toEqual({ agent_task_success: 0.5 });
    expect(payload!.metadata).toMatchObject({
      task_id: '3.0',
      retries: 2,
      transition: 'complete',
    });
  });

  it('emits 0.0 score on failed transition', () => {
    process.env.BRAINTRUST_SESSION_ID = 'span-root-abc';
    const payload = buildAgentTaskScorePayload({
      taskId: '4.0',
      transition: 'failed',
      retries: 1,
    });
    expect(payload!.scores).toEqual({ agent_task_success: 0.0 });
    expect(payload!.metadata).toMatchObject({
      transition: 'failed',
      retries: 1,
    });
  });

  it('fills defensive defaults when optional fields are missing', () => {
    process.env.BRAINTRUST_SESSION_ID = 'span-root-abc';
    const payload = buildAgentTaskScorePayload({
      taskId: '1.0',
      transition: 'complete',
    });
    expect(payload!.metadata).toEqual({
      task_id: '1.0',
      task_name: '',
      agent: 'unknown',
      retries: 0,
      duration_s: 0,
      transition: 'complete',
      hook: 'ralph-task-monitor',
    });
  });
});
