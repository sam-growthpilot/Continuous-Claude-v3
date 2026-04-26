/**
 * Tests for hook-trace.ts -- shared telemetry wrapper for hooks.
 *
 * The traceHook() function wraps a hook's main entrypoint and appends a
 * single JSONL record to ~/.claude/cache/hook-trace.jsonl on every call.
 *
 * Design contract (Phase 1, task 1.1 of system-coherence plan):
 *   - Records: ts, name, event, durationMs, exitCode (0=ok / 1=err), sessionId, error
 *   - Fail-safe: telemetry write errors NEVER bubble up to the caller.
 *   - Original fn() result is always returned (or original error re-thrown).
 *   - Works for both sync and async fn().
 *   - Respects CLAUDE_SESSION_ID env, falls back to process.pid.
 *
 * The tests redirect HOME/USERPROFILE to a per-test temp dir so they never
 * touch the real ~/.claude/cache/hook-trace.jsonl.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { traceHook, getTracePath, __setTraceWriter } from '../hook-trace.js';

// ---------------------------------------------------------------------------
// Per-test isolation
// ---------------------------------------------------------------------------

let tempHome: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
let originalSessionId: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-trace-test-'));
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  originalSessionId = process.env.CLAUDE_SESSION_ID;

  // os.homedir() honors USERPROFILE on Windows and HOME on POSIX.
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  delete process.env.CLAUDE_SESSION_ID;
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;

  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
  else delete process.env.USERPROFILE;

  if (originalSessionId !== undefined) process.env.CLAUDE_SESSION_ID = originalSessionId;
  else delete process.env.CLAUDE_SESSION_ID;

  fs.rmSync(tempHome, { recursive: true, force: true });
  __setTraceWriter(undefined);
  vi.restoreAllMocks();
});

// Read all JSONL records currently in the trace file.
function readRecords(): any[] {
  const tracePath = getTracePath();
  if (!fs.existsSync(tracePath)) return [];
  const raw = fs.readFileSync(tracePath, 'utf-8');
  if (!raw) return [];
  return raw.split('\n').filter(line => line.length > 0).map(line => JSON.parse(line));
}

// ---------------------------------------------------------------------------
// getTracePath
// ---------------------------------------------------------------------------

describe('getTracePath', () => {
  it('returns a path under ~/.claude/cache/hook-trace.jsonl', () => {
    const p = getTracePath();
    expect(p).toContain('.claude');
    expect(p).toContain('cache');
    expect(p.endsWith('hook-trace.jsonl')).toBe(true);
  });

  it('creates the parent cache directory if missing', () => {
    const p = getTracePath();
    expect(fs.existsSync(path.dirname(p))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sync invocation -- success path
// ---------------------------------------------------------------------------

describe('traceHook: sync success', () => {
  it('returns the wrapped function result', () => {
    const result = traceHook('sync-hook', 'PreToolUse', () => 42);
    expect(result).toBe(42);
  });

  it('writes one JSONL record with exitCode=0', () => {
    traceHook('sync-hook', 'PreToolUse', () => 'ok');
    const records = readRecords();
    expect(records).toHaveLength(1);
    expect(records[0].exitCode).toBe(0);
    expect(records[0].name).toBe('sync-hook');
    expect(records[0].event).toBe('PreToolUse');
    expect(records[0].error).toBeNull();
  });

  it('records a non-negative durationMs', () => {
    traceHook('sync-hook', 'PreToolUse', () => 'ok');
    const records = readRecords();
    expect(typeof records[0].durationMs).toBe('number');
    expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records an ISO-8601 timestamp', () => {
    traceHook('sync-hook', 'PreToolUse', () => 'ok');
    const records = readRecords();
    // ISO 8601 with millisecond precision and Z suffix
    expect(records[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('uses CLAUDE_SESSION_ID when set', () => {
    process.env.CLAUDE_SESSION_ID = 'abc-123';
    traceHook('sync-hook', 'PreToolUse', () => 'ok');
    const records = readRecords();
    expect(records[0].sessionId).toBe('abc-123');
  });

  it('falls back to process.pid (as string) when CLAUDE_SESSION_ID is absent', () => {
    traceHook('sync-hook', 'PreToolUse', () => 'ok');
    const records = readRecords();
    expect(records[0].sessionId).toBe(String(process.pid));
  });
});

// ---------------------------------------------------------------------------
// Async invocation -- success path
// ---------------------------------------------------------------------------

describe('traceHook: async success', () => {
  it('returns a promise that resolves to the wrapped result', async () => {
    const result = await traceHook('async-hook', 'PostToolUse', async () => 'async-ok');
    expect(result).toBe('async-ok');
  });

  it('writes one JSONL record after the promise settles', async () => {
    await traceHook('async-hook', 'PostToolUse', async () => {
      await new Promise(r => setTimeout(r, 5));
      return 'done';
    });
    const records = readRecords();
    expect(records).toHaveLength(1);
    expect(records[0].exitCode).toBe(0);
    expect(records[0].name).toBe('async-hook');
    expect(records[0].event).toBe('PostToolUse');
    expect(records[0].error).toBeNull();
    expect(records[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Throwing invocation -- error path
// ---------------------------------------------------------------------------

describe('traceHook: throwing fn', () => {
  it('re-throws the original sync error', () => {
    const err = new Error('boom');
    expect(() => traceHook('throw-hook', 'SessionStart', () => { throw err; })).toThrow('boom');
  });

  it('writes one JSONL record with exitCode=1 and populated error field for sync throw', () => {
    try {
      traceHook('throw-hook', 'SessionStart', () => { throw new Error('boom'); });
    } catch { /* expected */ }
    const records = readRecords();
    expect(records).toHaveLength(1);
    expect(records[0].exitCode).toBe(1);
    expect(records[0].error).toContain('boom');
  });

  it('re-rejects the original async error', async () => {
    await expect(
      traceHook('throw-async', 'PostToolUse', async () => { throw new Error('async-boom'); })
    ).rejects.toThrow('async-boom');
  });

  it('writes one JSONL record with exitCode=1 for async rejection', async () => {
    try {
      await traceHook('throw-async', 'PostToolUse', async () => { throw new Error('async-boom'); });
    } catch { /* expected */ }
    const records = readRecords();
    expect(records).toHaveLength(1);
    expect(records[0].exitCode).toBe(1);
    expect(records[0].error).toContain('async-boom');
  });
});

// ---------------------------------------------------------------------------
// Trace-write failure -- must not break the hook
// ---------------------------------------------------------------------------

describe('traceHook: telemetry write failure is fail-safe', () => {
  // Use the test seam (__setTraceWriter) instead of vi.spyOn(fs, ...) because
  // ESM module-namespace bindings are not configurable -- spying on named
  // re-exports of fs throws "Cannot redefine property" under vitest+ESM.
  const failingWriter = () => { throw new Error('disk full'); };

  it('returns sync fn result even when the writer throws', () => {
    __setTraceWriter(failingWriter);
    const result = traceHook('fs-fail', 'PreToolUse', () => 'still-ok');
    expect(result).toBe('still-ok');
  });

  it('returns async fn result even when the writer throws', async () => {
    __setTraceWriter(failingWriter);
    const result = await traceHook('fs-fail-async', 'PostToolUse', async () => 'async-still-ok');
    expect(result).toBe('async-still-ok');
  });

  it('still re-throws the original sync fn error even when telemetry write also fails', () => {
    __setTraceWriter(failingWriter);
    expect(() =>
      traceHook('fs-fail-throw', 'PreToolUse', () => { throw new Error('original'); })
    ).toThrow('original');
  });

  it('still rejects with the original async error even when telemetry write also fails', async () => {
    __setTraceWriter(failingWriter);
    await expect(
      traceHook('fs-fail-throw-async', 'PostToolUse', async () => { throw new Error('async-original'); })
    ).rejects.toThrow('async-original');
  });
});

// ---------------------------------------------------------------------------
// JSONL format
// ---------------------------------------------------------------------------

describe('traceHook: JSONL format', () => {
  it('writes each call on its own line ending in \\n', () => {
    traceHook('a', 'PreToolUse', () => 1);
    traceHook('b', 'PostToolUse', () => 2);
    const tracePath = getTracePath();
    const raw = fs.readFileSync(tracePath, 'utf-8');
    // Two lines, each terminated by \n
    expect(raw.endsWith('\n')).toBe(true);
    const lines = raw.split('\n').filter(l => l.length > 0);
    expect(lines).toHaveLength(2);
    // Each line is valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('appends -- never overwrites prior records', () => {
    traceHook('first', 'PreToolUse', () => 1);
    traceHook('second', 'PreToolUse', () => 2);
    traceHook('third', 'PreToolUse', () => 3);
    const records = readRecords();
    expect(records).toHaveLength(3);
    expect(records.map(r => r.name)).toEqual(['first', 'second', 'third']);
  });

  it('every record has the required keys', () => {
    traceHook('shape-check', 'PreToolUse', () => 'ok');
    const records = readRecords();
    const r = records[0];
    expect(r).toHaveProperty('ts');
    expect(r).toHaveProperty('name');
    expect(r).toHaveProperty('event');
    expect(r).toHaveProperty('durationMs');
    expect(r).toHaveProperty('exitCode');
    expect(r).toHaveProperty('sessionId');
    expect(r).toHaveProperty('error');
  });
});
