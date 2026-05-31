/**
 * Tests for agent-recall-injector PreToolUse hook (Task matcher).
 *
 * The hook fires on PreToolUse for the Task tool. Before a subagent runs,
 * it:
 *   1. Extracts intent from the agent prompt
 *   2. Calls recall_learnings.py --text-only --k 3 --json
 *   3. Applies PROACTIVE_INJECTION_FLOOR = 0.05
 *   4. Injects top 3 results into the agent's `additionalContext`
 *   5. Logs the fire to .claude/logs/agent-recall.jsonl
 *
 * Tests target the exported logic units (no subprocess). The recall
 * function is injected as a dependency so tests can mock it without
 * hitting the real Postgres backend.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  shouldSkip,
  buildAgentContext,
  handleAgentTask,
  main,
  PROACTIVE_INJECTION_FLOOR,
  type RecallFn,
  type RecallResult,
  type TaskHookInput,
} from '../agent-recall-injector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_SESSION = 'agent-recall-test-session';

function makeInput(overrides: Partial<TaskHookInput> = {}): TaskHookInput {
  return {
    session_id: TEST_SESSION,
    tool_name: 'Task',
    tool_input: {
      subagent_type: 'kraken',
      prompt: 'fix the memory leak in the kernel pool that happens under load',
      description: 'Fix memory leak',
    },
    ...overrides,
  };
}

/** Build a successful recall response with N results, each at the given score. */
function recallReturning(results: RecallResult[]): RecallFn {
  return () => ({ ok: true, results });
}

const FAKE_RESULT_A: RecallResult = {
  id: 'abcd1234',
  type: 'ERROR_FIX',
  content: 'Kernel pool memory leak fixed by adding refcount on close.',
  score: 0.42,
};

const FAKE_RESULT_B: RecallResult = {
  id: 'efgh5678',
  type: 'CODEBASE_PATTERN',
  content: 'Use scope:project tags to limit recall to repo-specific learnings.',
  score: 0.18,
};

const FAKE_RESULT_C: RecallResult = {
  id: 'ijkl9012',
  type: 'WORKING_SOLUTION',
  content: 'Pool ref-counting with weak refs avoids cycles on long-lived workers.',
  score: 0.07,
};

const LOW_SCORE_RESULT: RecallResult = {
  id: 'zzz00000',
  type: 'NOISE',
  content: 'Unrelated text below the floor.',
  score: 0.02,
};

// ---------------------------------------------------------------------------
// Log file isolation -- redirect logs to a temp dir
// ---------------------------------------------------------------------------

let tempLogsDir: string;
let prevProjectDir: string | undefined;

beforeEach(() => {
  tempLogsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-recall-logs-'));
  prevProjectDir = process.env.CLAUDE_PROJECT_DIR;
  // Tell the hook to log under our temp dir
  process.env.CLAUDE_PROJECT_DIR = tempLogsDir;
});

afterEach(() => {
  if (prevProjectDir === undefined) {
    delete process.env.CLAUDE_PROJECT_DIR;
  } else {
    process.env.CLAUDE_PROJECT_DIR = prevProjectDir;
  }
  // Recursive cleanup
  try {
    fs.rmSync(tempLogsDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  // Clear any stray CLAUDE_AGENT_ID set by tests
  delete process.env.CLAUDE_AGENT_ID;
});

// =============================================================================
// shouldSkip -- skip conditions
// =============================================================================

describe('shouldSkip', () => {
  it('returns false for kraken with a meaningful prompt', () => {
    const decision = shouldSkip(makeInput());
    expect(decision.skip).toBe(false);
  });

  it('returns true if tool_name is not Task', () => {
    const decision = shouldSkip(makeInput({ tool_name: 'Bash' }));
    expect(decision.skip).toBe(true);
    expect(decision.reason).toMatch(/not.*task/i);
  });

  it('does NOT skip when tool_name is Agent (Claude Code sends "Agent")', () => {
    // Activation fix: Claude Code emits tool_name="Agent" for the Agent tool.
    // shouldSkip must accept it so spawned agents actually get memory recall.
    const decision = shouldSkip(makeInput({ tool_name: 'Agent' }));
    expect(decision.skip).toBe(false);
  });

  it('returns true for subagent_type=oracle (external research)', () => {
    const decision = shouldSkip(
      makeInput({
        tool_input: {
          subagent_type: 'oracle',
          prompt: 'research the latest Vercel AI SDK changes please please',
          description: 'Research SDK',
        },
      }),
    );
    expect(decision.skip).toBe(true);
    expect(decision.reason).toMatch(/oracle|external/i);
  });

  it('returns true for subagent_type=pathfinder', () => {
    const decision = shouldSkip(
      makeInput({
        tool_input: {
          subagent_type: 'pathfinder',
          prompt: 'find some external services that do X',
          description: 'Find services',
        },
      }),
    );
    expect(decision.skip).toBe(true);
  });

  it('returns true for very short prompts (<30 chars)', () => {
    const decision = shouldSkip(
      makeInput({
        tool_input: {
          subagent_type: 'kraken',
          prompt: 'do it',
          description: 'do it',
        },
      }),
    );
    expect(decision.skip).toBe(true);
    expect(decision.reason).toMatch(/short|length/i);
  });

  it('returns true when description starts with slash (slash command)', () => {
    const decision = shouldSkip(
      makeInput({
        tool_input: {
          subagent_type: 'kraken',
          prompt: 'run a long enough prompt with enough characters here',
          description: '/build feature x',
        },
      }),
    );
    expect(decision.skip).toBe(true);
    expect(decision.reason).toMatch(/slash/i);
  });

  it('returns true when CLAUDE_AGENT_ID is set (recursion guard)', () => {
    process.env.CLAUDE_AGENT_ID = 'parent-agent-uuid';
    const decision = shouldSkip(makeInput());
    expect(decision.skip).toBe(true);
    expect(decision.reason).toMatch(/recursion|agent_id|nested/i);
  });

  it('returns true when prompt is missing entirely', () => {
    const decision = shouldSkip({
      session_id: TEST_SESSION,
      tool_name: 'Task',
      tool_input: { subagent_type: 'kraken' } as any,
    });
    expect(decision.skip).toBe(true);
  });

  it('returns true when subagent_type is missing', () => {
    const decision = shouldSkip({
      session_id: TEST_SESSION,
      tool_name: 'Task',
      tool_input: {
        prompt: 'a long enough prompt with no agent type set here at all',
      } as any,
    });
    expect(decision.skip).toBe(true);
  });
});

// =============================================================================
// buildAgentContext -- shape of the injected text
// =============================================================================

describe('buildAgentContext', () => {
  it('builds context with 3 numbered results', () => {
    const ctx = buildAgentContext('kraken', 'fix memory leak', [
      FAKE_RESULT_A,
      FAKE_RESULT_B,
      FAKE_RESULT_C,
    ]);
    expect(ctx).toContain('AGENT MEMORY CONTEXT');
    expect(ctx).toContain('"kraken"');
    expect(ctx).toContain('"fix memory leak"');
    expect(ctx).toMatch(/1\. \[ERROR_FIX\]/);
    expect(ctx).toMatch(/2\. \[CODEBASE_PATTERN\]/);
    expect(ctx).toMatch(/3\. \[WORKING_SOLUTION\]/);
    expect(ctx).toContain('id: abcd1234');
  });

  it('truncates previews to 120 chars', () => {
    const longContent = 'X'.repeat(300);
    const ctx = buildAgentContext('spark', 'do something', [
      { id: 'aaaaaaaa', type: 'WORKING_SOLUTION', content: longContent, score: 0.5 },
    ]);
    // The preview line for the result should not contain 300 chars of X
    const previewLines = ctx.split('\n').filter((l) => l.includes('WORKING_SOLUTION'));
    expect(previewLines.length).toBeGreaterThan(0);
    // ellipsis appended when truncated
    expect(previewLines[0]).toContain('...');
    // 120-char preview means the line should have far fewer than 300 Xs
    const xCount = (previewLines[0].match(/X/g) || []).length;
    expect(xCount).toBeLessThanOrEqual(125);
  });

  it('sanitizes and caps result ids to 16 chars', () => {
    const ctx = buildAgentContext('kraken', 'intent', [
      {
        id: 'super-long-uuid-that-should-be-shortened',
        type: 'ERROR_FIX',
        content: 'thing',
        score: 0.5,
      },
    ]);
    // id is sanitized and capped to 16 chars: "super-long-uuid-...(truncated)"
    // The 16-char prefix survives
    expect(ctx).toContain('super-long-uuid-');
    // The tail beyond 16 chars is gone
    expect(ctx).not.toContain('that-should-be-shortened');
    // Truncation marker is present
    expect(ctx).toContain('...(truncated)');
  });

  it('caps at top 3 even when more provided', () => {
    const five: RecallResult[] = [1, 2, 3, 4, 5].map((n) => ({
      id: `id${n}xxxx`,
      type: 'ERROR_FIX',
      content: `content ${n}`,
      score: 0.5,
    }));
    const ctx = buildAgentContext('kraken', 'intent', five);
    expect(ctx).toMatch(/3\. \[ERROR_FIX\]/);
    expect(ctx).not.toMatch(/4\. \[/);
  });
});

// =============================================================================
// handleAgentTask -- end-to-end (with injected recall)
// =============================================================================

describe('handleAgentTask -- injection', () => {
  it('injects context for kraken with matching results', () => {
    const recall = recallReturning([FAKE_RESULT_A, FAKE_RESULT_B]);
    const out = handleAgentTask(makeInput(), recall);
    expect(out).not.toBeNull();
    expect(out!.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(out!.hookSpecificOutput?.additionalContext).toContain('AGENT MEMORY CONTEXT');
    expect(out!.hookSpecificOutput?.additionalContext).toContain('ERROR_FIX');
  });

  it('returns null (no context) for oracle subagent', () => {
    const recall = recallReturning([FAKE_RESULT_A]);
    const out = handleAgentTask(
      makeInput({
        tool_input: {
          subagent_type: 'oracle',
          prompt: 'research external library trends for a while now please',
          description: 'Research',
        },
      }),
      recall,
    );
    expect(out).toBeNull();
  });

  it('returns null when prompt is empty/short', () => {
    const recall = recallReturning([FAKE_RESULT_A]);
    const out = handleAgentTask(
      makeInput({
        tool_input: {
          subagent_type: 'kraken',
          prompt: '',
          description: 'empty',
        },
      }),
      recall,
    );
    expect(out).toBeNull();
  });

  it('returns null when recall returns 0 results', () => {
    const recall: RecallFn = () => ({ ok: true, results: [] });
    const out = handleAgentTask(makeInput(), recall);
    expect(out).toBeNull();
  });

  it('returns null when recall times out (ok=false)', () => {
    const recall: RecallFn = () => ({ ok: false, results: [], error: 'timeout' });
    const out = handleAgentTask(makeInput(), recall);
    expect(out).toBeNull();
  });

  it('filters out results below PROACTIVE_INJECTION_FLOOR', () => {
    const recall = recallReturning([LOW_SCORE_RESULT]); // score 0.02 < 0.05
    const out = handleAgentTask(makeInput(), recall);
    expect(out).toBeNull();
  });

  it('keeps results at or above the floor', () => {
    const onFloor: RecallResult = { ...FAKE_RESULT_C, score: PROACTIVE_INJECTION_FLOOR };
    const recall = recallReturning([onFloor]);
    const out = handleAgentTask(makeInput(), recall);
    expect(out).not.toBeNull();
    expect(out!.hookSpecificOutput?.additionalContext).toContain('WORKING_SOLUTION');
  });

  it('returns null when CLAUDE_AGENT_ID is set (recursion guard)', () => {
    process.env.CLAUDE_AGENT_ID = 'parent-agent-uuid';
    const recall = recallReturning([FAKE_RESULT_A]);
    const out = handleAgentTask(makeInput(), recall);
    expect(out).toBeNull();
  });

  it('returns null when recall throws unexpectedly', () => {
    const recall: RecallFn = () => {
      throw new Error('boom');
    };
    expect(() => handleAgentTask(makeInput(), recall)).not.toThrow();
    const out = handleAgentTask(makeInput(), recall);
    expect(out).toBeNull();
  });
});

// =============================================================================
// Log file accumulation
// =============================================================================

describe('agent-recall.jsonl logging', () => {
  it('writes one log entry per fire when context is injected', () => {
    const recall = recallReturning([FAKE_RESULT_A]);
    handleAgentTask(makeInput(), recall);

    const logPath = path.join(tempLogsDir, '.claude', 'logs', 'agent-recall.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);

    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(1);

    const entry = JSON.parse(lines[0]);
    expect(entry.session_id).toBe(TEST_SESSION);
    expect(entry.subagent_type).toBe('kraken');
    expect(entry.results_count).toBe(1);
    expect(entry.kept_after_floor).toBe(1);
    expect(typeof entry.timestamp).toBe('string');
    expect(typeof entry.top_score).toBe('number');
    expect(entry.intent).toContain('memory leak');
  });

  it('logs even when 0 results returned (with results_count=0)', () => {
    const recall: RecallFn = () => ({ ok: true, results: [] });
    handleAgentTask(makeInput(), recall);

    const logPath = path.join(tempLogsDir, '.claude', 'logs', 'agent-recall.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.results_count).toBe(0);
    expect(entry.kept_after_floor).toBe(0);
  });

  it('does NOT log when hook skips (oracle subagent)', () => {
    const recall = recallReturning([FAKE_RESULT_A]);
    handleAgentTask(
      makeInput({
        tool_input: {
          subagent_type: 'oracle',
          prompt: 'long enough research prompt that meets the length floor here',
          description: 'Research',
        },
      }),
      recall,
    );

    const logPath = path.join(tempLogsDir, '.claude', 'logs', 'agent-recall.jsonl');
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it('accumulates multiple entries across fires', () => {
    const recall = recallReturning([FAKE_RESULT_A]);
    handleAgentTask(makeInput(), recall);
    handleAgentTask(
      makeInput({
        tool_input: {
          subagent_type: 'spark',
          prompt: 'small tweak to the ralph progress reminder hook output format',
          description: 'small tweak',
        },
      }),
      recall,
    );

    const logPath = path.join(tempLogsDir, '.claude', 'logs', 'agent-recall.jsonl');
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
    const entries = lines.map((l) => JSON.parse(l));
    expect(entries[0].subagent_type).toBe('kraken');
    expect(entries[1].subagent_type).toBe('spark');
  });

  it('records floor-filtered count correctly', () => {
    const recall = recallReturning([
      FAKE_RESULT_A, // 0.42 — kept
      LOW_SCORE_RESULT, // 0.02 — dropped
    ]);
    handleAgentTask(makeInput(), recall);

    const logPath = path.join(tempLogsDir, '.claude', 'logs', 'agent-recall.jsonl');
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    const entry = JSON.parse(lines[0]);
    expect(entry.results_count).toBe(2);
    expect(entry.kept_after_floor).toBe(1);
    expect(entry.top_score).toBeCloseTo(0.42, 3);
  });
});

// =============================================================================
// Activation: tool_name="Agent" reaches the recall path end-to-end
// =============================================================================

describe('handleAgentTask -- Agent tool_name activation', () => {
  it('injects context when tool_name is "Agent" (reaches recall, mocked)', () => {
    // Proves the activation fix: an "Agent" tool call is NOT skipped and
    // flows all the way through to injection. recall is mocked (no subprocess).
    const recall = recallReturning([FAKE_RESULT_A, FAKE_RESULT_B]);
    const out = handleAgentTask(makeInput({ tool_name: 'Agent' }), recall);
    expect(out).not.toBeNull();
    expect(out!.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(out!.hookSpecificOutput?.additionalContext).toContain('AGENT MEMORY CONTEXT');
    expect(out!.hookSpecificOutput?.additionalContext).toContain('ERROR_FIX');
  });
});

// =============================================================================
// Kill-switch: CCV3_AGENT_RECALL_OFF short-circuits main() to continue
// =============================================================================

describe('CCV3_AGENT_RECALL_OFF kill-switch', () => {
  let prevOff: string | undefined;

  beforeEach(() => {
    prevOff = process.env.CCV3_AGENT_RECALL_OFF;
  });

  afterEach(() => {
    if (prevOff === undefined) {
      delete process.env.CCV3_AGENT_RECALL_OFF;
    } else {
      process.env.CCV3_AGENT_RECALL_OFF = prevOff;
    }
  });

  it('main() emits a continue and injects nothing when set to "1"', async () => {
    process.env.CCV3_AGENT_RECALL_OFF = '1';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let calls: unknown[][];
    try {
      // The guard returns before stdin is read, so no stdin mock is needed.
      await main();
      // Snapshot recorded calls BEFORE mockRestore() — restore clears them.
      calls = logSpy.mock.calls.map((c) => [...c]);
    } finally {
      logSpy.mockRestore();
    }

    expect(calls.length).toBe(1);
    const emitted = String(calls[0][0]);
    // Standard continue/no-op shape — never an injected memory context.
    expect(emitted).toContain('continue');
    expect(emitted).not.toContain('AGENT MEMORY CONTEXT');
    expect(emitted).not.toContain('additionalContext');
  });
});
