/**
 * Tests for the L0 observability appender (WS-2 Phase A.2).
 *
 * intel-bus.jsonl is the telemetry spine for the cohesive-intelligence system
 * (design doc section 6). appendIntelBus(event) writes ONE parseable JSONL line
 * per event and must NEVER throw into the hot path (telemetry is fire-and-forget).
 *
 * Contract under test (design doc section 6 + plan A.2):
 *  - one append == exactly one parseable JSON line
 *  - `ts` is stamped (ISO) when absent; preserved when present
 *  - schema_version is 1
 *  - >4 KB serialized event is NOT written as a >4 KB line (no corruption, no throw)
 *  - embedded newlines in string fields are stripped (one event == one line)
 *  - any disk error is swallowed (fail-open)
 *  - path is project-relative: <projectDir>/.claude/logs/intel-bus.jsonl
 *
 * Tests inject an `append` seam (a capturing function) rather than touching
 * real disk, matching the host-ram.ts / session-bus-id.ts injected-dependency
 * style. Runner is vitest; ASCII only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  appendIntelBus,
  intelBusPath,
  MAX_LINE_BYTES,
  type IntelBusEvent,
} from '../shared/intel-bus.js';

// ---------------------------------------------------------------------------
// A capturing append seam: records (path, line) pairs without touching disk.
// ---------------------------------------------------------------------------
function makeCapture() {
  const lines: { path: string; line: string }[] = [];
  const append = (path: string, line: string) => {
    lines.push({ path, line });
  };
  return { lines, append };
}

const FIXED_NOW = () => '2026-06-01T12:00:00.000Z';

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = 'C:/tmp/proj';
});
afterEach(() => {
  if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR;
  else process.env.CLAUDE_PROJECT_DIR = saved;
});

describe('intelBusPath', () => {
  it('resolves to <projectDir>/.claude/logs/intel-bus.jsonl', () => {
    const p = intelBusPath('C:/tmp/proj');
    expect(p.replace(/\\/g, '/')).toBe('C:/tmp/proj/.claude/logs/intel-bus.jsonl');
  });

  it('defaults to CLAUDE_PROJECT_DIR when no dir is passed', () => {
    const p = intelBusPath();
    expect(p.replace(/\\/g, '/')).toContain('C:/tmp/proj/.claude/logs/intel-bus.jsonl');
  });
});

describe('appendIntelBus -- one event == one parseable line', () => {
  it('writes exactly one line that round-trips through JSON.parse', () => {
    const { lines, append } = makeCapture();
    appendIntelBus(
      { bus_id: 'abc123', specialist: 'codegraph', query_type: 'find_callers' },
      { append, now: FIXED_NOW },
    );
    expect(lines).toHaveLength(1);
    const { line } = lines[0];
    // exactly one trailing newline, none embedded
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1).includes('\n')).toBe(false);
    const parsed = JSON.parse(line);
    expect(parsed.bus_id).toBe('abc123');
    expect(parsed.specialist).toBe('codegraph');
  });

  it('stamps an ISO ts when absent and forces schema_version=1', () => {
    const { lines, append } = makeCapture();
    appendIntelBus({ bus_id: 'abc123' }, { append, now: FIXED_NOW });
    const parsed = JSON.parse(lines[0].line);
    expect(parsed.ts).toBe('2026-06-01T12:00:00.000Z');
    expect(parsed.schema_version).toBe(1);
  });

  it('preserves a caller-supplied ts', () => {
    const { lines, append } = makeCapture();
    appendIntelBus(
      { bus_id: 'abc123', ts: '2020-01-01T00:00:00.000Z' },
      { append, now: FIXED_NOW },
    );
    const parsed = JSON.parse(lines[0].line);
    expect(parsed.ts).toBe('2020-01-01T00:00:00.000Z');
  });

  it('writes to the project-relative intel-bus.jsonl path', () => {
    const { lines, append } = makeCapture();
    appendIntelBus({ bus_id: 'abc123' }, { append, now: FIXED_NOW, projectDir: 'C:/tmp/proj' });
    expect(lines[0].path.replace(/\\/g, '/')).toBe('C:/tmp/proj/.claude/logs/intel-bus.jsonl');
  });
});

describe('appendIntelBus -- embedded newline stripping', () => {
  it('strips embedded \\n / \\r from string fields so one event stays one line', () => {
    const { lines, append } = makeCapture();
    appendIntelBus(
      { bus_id: 'abc123', query_type: 'line1\nline2\r\nline3' as string },
      { append, now: FIXED_NOW },
    );
    expect(lines).toHaveLength(1);
    const { line } = lines[0];
    // The only newline is the terminator.
    expect(line.slice(0, -1).includes('\n')).toBe(false);
    expect(line.includes('\r')).toBe(false);
    const parsed = JSON.parse(line);
    expect(parsed.query_type).not.toContain('\n');
    expect(parsed.query_type).toContain('line1');
    expect(parsed.query_type).toContain('line3');
  });
});

describe('appendIntelBus -- 4 KB line-size assertion', () => {
  it('does NOT write a >4 KB line when the event is oversized', () => {
    const { lines, append } = makeCapture();
    // A huge string field that blows past 4 KB on its own.
    const huge = 'x'.repeat(MAX_LINE_BYTES * 2);
    appendIntelBus(
      { bus_id: 'abc123', query_type: huge as string },
      { append, now: FIXED_NOW },
    );
    // Either the event was dropped, or it was truncated -- but if anything was
    // written, it must be <= MAX_LINE_BYTES and must NOT corrupt the file.
    if (lines.length === 1) {
      const bytes = Buffer.byteLength(lines[0].line, 'utf-8');
      expect(bytes).toBeLessThanOrEqual(MAX_LINE_BYTES);
      // still a single parseable line
      expect(() => JSON.parse(lines[0].line.slice(0, -1))).not.toThrow();
    } else {
      expect(lines).toHaveLength(0);
    }
  });

  it('never writes a partial/corrupt line for an oversized event', () => {
    const { lines, append } = makeCapture();
    const huge = 'y'.repeat(MAX_LINE_BYTES * 4);
    expect(() =>
      appendIntelBus({ bus_id: 'abc123', subject_id: huge as string }, { append, now: FIXED_NOW }),
    ).not.toThrow();
    for (const { line } of lines) {
      expect(Buffer.byteLength(line, 'utf-8')).toBeLessThanOrEqual(MAX_LINE_BYTES);
      // whatever we wrote parses cleanly
      expect(() => JSON.parse(line.slice(0, -1))).not.toThrow();
    }
  });

  it('writes a normal-sized event unmodified', () => {
    const { lines, append } = makeCapture();
    appendIntelBus(
      { bus_id: 'abc123', query_type: 'find_callers', result_count: 7, rank: 1 },
      { append, now: FIXED_NOW },
    );
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0].line);
    expect(parsed.result_count).toBe(7);
    expect(parsed.rank).toBe(1);
  });
});

describe('appendIntelBus -- fail-open', () => {
  it('swallows a throwing append (telemetry never breaks the hot path)', () => {
    const throwingAppend = () => {
      throw new Error('EACCES: simulated disk failure');
    };
    expect(() =>
      appendIntelBus({ bus_id: 'abc123' }, { append: throwingAppend, now: FIXED_NOW }),
    ).not.toThrow();
  });

  it('swallows a serialization error without throwing', () => {
    const { append } = makeCapture();
    // A BigInt cannot be JSON.stringify'd -- must be swallowed, not thrown.
    const bad = { bus_id: 'abc123', weird: 1n } as unknown as IntelBusEvent;
    expect(() => appendIntelBus(bad, { append, now: FIXED_NOW })).not.toThrow();
  });
});
