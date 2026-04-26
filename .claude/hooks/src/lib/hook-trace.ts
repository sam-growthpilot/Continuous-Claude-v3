/**
 * hook-trace.ts -- telemetry wrapper for Claude Code hooks (Phase 1, system-coherence).
 *
 * traceHook() wraps a hook entrypoint and appends one JSONL record per
 * invocation to ~/.claude/cache/hook-trace.jsonl. Fields: ts, name, event,
 * durationMs, exitCode (0=ok, 1=err), sessionId, error. Telemetry write
 * errors are swallowed -- a broken trace must never break a hook. Sync and
 * async fn() are both supported. sessionId comes from CLAUDE_SESSION_ID
 * env, else String(process.pid). Utility module, not a hook -- do not
 * register in settings.json. Moves to src/lib/ in Phase 3.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface TraceRecord {
  ts: string;
  name: string;
  event: string;
  durationMs: number;
  exitCode: 0 | 1;
  sessionId: string;
  error: string | null;
}

/** Resolve ~/.claude/cache/hook-trace.jsonl, mkdir -p the parent. */
export function getTracePath(): string {
  const dir = join(homedir(), '.claude', 'cache');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'hook-trace.jsonl');
}

function getSessionId(): string {
  return process.env.CLAUDE_SESSION_ID || String(process.pid);
}

// Test seam: vitest can't spy on ESM fs namespace exports, so tests swap the
// writer to simulate disk failures.
type RecordWriter = (r: TraceRecord) => void;
const defaultWriter: RecordWriter = (r) =>
  appendFileSync(getTracePath(), JSON.stringify(r) + '\n', 'utf-8');
let activeWriter: RecordWriter = defaultWriter;

/** Internal: replace the writer (tests only). Pass undefined to reset. */
export function __setTraceWriter(writer: RecordWriter | undefined): void {
  activeWriter = writer ?? defaultWriter;
}

function writeRecord(r: TraceRecord): void {
  try { activeWriter(r); } catch { /* telemetry must never break a hook */ }
}

function buildRecord(
  name: string, event: string, startedAt: number,
  exitCode: 0 | 1, error: unknown,
): TraceRecord {
  const errMsg = error == null ? null
    : error instanceof Error ? (error.message || String(error))
    : String(error);
  return {
    ts: new Date().toISOString(),
    name, event,
    durationMs: Date.now() - startedAt,
    exitCode,
    sessionId: getSessionId(),
    error: errMsg,
  };
}

/**
 * Wrap a hook entrypoint with telemetry.
 *   const result = traceHook('my-hook', 'PreToolUse', () => doWork());
 *   await traceHook('my-hook', 'PostToolUse', async () => doWorkAsync());
 */
export function traceHook<T>(
  name: string,
  event: string,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const startedAt = Date.now();
  let result: T | Promise<T>;
  try {
    result = fn();
  } catch (err) {
    writeRecord(buildRecord(name, event, startedAt, 1, err));
    throw err;
  }
  if (result && typeof (result as Promise<T>).then === 'function') {
    return (result as Promise<T>).then(
      (v) => { writeRecord(buildRecord(name, event, startedAt, 0, null)); return v; },
      (e) => { writeRecord(buildRecord(name, event, startedAt, 1, e)); throw e; },
    );
  }
  writeRecord(buildRecord(name, event, startedAt, 0, null));
  return result;
}
