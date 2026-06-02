/**
 * L0 observability appender for the cohesive-intelligence system (WS-2 Phase A.2).
 *
 * Writes one JSON line per telemetry event to:
 *   <projectDir>/.claude/logs/intel-bus.jsonl
 * where projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()
 * (project-relative, matching the other CCv3 JSONL logs).
 *
 * Event schema: design doc "v3" section 6. Most fields are optional; the only
 * required fields are `ts` (stamped here if absent), `bus_id`, and
 * `schema_version` (forced to 1). This layer is namespaced `intel-bus` /
 * `intel_observability` so it is NOT confused with the memory-extraction "L0"
 * score-gate (a different L0).
 *
 * Append safety (design doc section 6, mitigation #16):
 *  - bare appendFileSync (matches the 6+ existing CCv3 JSONL appenders)
 *  - every string field has embedded \r / \n stripped so ONE event == ONE line
 *  - 4 KB per-line assertion: a serialized event that exceeds MAX_LINE_BYTES is
 *    never written as an over-long line -- the largest string field is truncated
 *    and, if that is still too big, the event is dropped. The file is never
 *    corrupted with a partial record.
 *
 * Fail-open: telemetry must NEVER throw into the hot path. Any serialization or
 * disk error is swallowed.
 *
 * Test seam: appendIntelBus accepts an injected `append` / `now` / `projectDir`
 * (host-ram.ts style) so tests verify behavior without touching real disk.
 *
 * ASCII only.
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Hard per-line cap. A single JSONL record must never exceed this many bytes. */
export const MAX_LINE_BYTES = 4096;

/**
 * intel-bus event (design doc section 6). Every field except the three required
 * ones is optional; callers fill in only what they have.
 */
export interface IntelBusEvent {
  /** ISO timestamp. Stamped by appendIntelBus when absent. Required on disk. */
  ts?: string;
  /** Session bus id (from shared/session-bus-id.ts). Required. */
  bus_id: string;
  /** Which agent emitted: main | kraken | codex-adversary | ... */
  agent?: string;
  /** Facade entry point, e.g. "/code-intel". */
  facade?: string;
  /** L3 specialist, e.g. "codegraph" | "serena" | "tldr" | ... */
  specialist?: string;
  /** Query type, e.g. "find_callers" | "bus_read_latency" | ... */
  query_type?: string;
  /** SCIP-style subject id the query was about. */
  subject_id?: string;
  /** Number of results returned. */
  result_count?: number;
  /** Rank of the top result for this source. */
  rank?: number;
  /** Escalation provenance. */
  escalated_from?: string | null;
  escalated_to?: string | null;
  /** Wall-clock duration of the operation in ms. */
  duration_ms?: number;
  /** Correlation id tying related events together. */
  correlation_id?: string;
  /** Parent event id for escalation chains. */
  parent_event_id?: string | null;
  /** Task id, when emitted inside a tracked task. */
  task_id?: string | null;
  /** Computed offline; emitter always leaves null. */
  downstream_used?: unknown;
  /** Summary of bus mutations this event caused, e.g. ["focus_symbols+1"]. */
  bus_updates?: string[];
  /** codegraph-only corpus fingerprint. */
  corpus_signature?: Record<string, unknown>;
  /** Schema version. Forced to 1 here. */
  schema_version?: 1;
  /** True for rows imported by the backfill script; excluded from gates. */
  backfilled?: boolean;
  /** Forward-compat: allow extra fields without a type error. */
  [key: string]: unknown;
}

/** Options for appendIntelBus -- all optional; defaults hit real disk. */
export interface AppendIntelBusOptions {
  /** Project root override (default: CLAUDE_PROJECT_DIR || cwd). */
  projectDir?: string;
  /** Clock override (default: () => new Date().toISOString()). Test seam. */
  now?: () => string;
  /** Append sink override (default: appendFileSync). Test seam. */
  append?: (path: string, line: string) => void;
}

/** Resolve the project-relative intel-bus.jsonl path. */
export function intelBusPath(projectDir?: string): string {
  const root = projectDir || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return join(root, '.claude', 'logs', 'intel-bus.jsonl');
}

/** Strip embedded CR/LF from every string field so one event stays one line. */
function stripNewlinesDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/[\r\n]+/g, ' ');
  }
  if (Array.isArray(value)) {
    return value.map(stripNewlinesDeep);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripNewlinesDeep(v);
    }
    return out;
  }
  return value;
}

/**
 * Find the longest string-valued field (top level) and return its key, so an
 * oversized event can be trimmed at the most likely offender before dropping.
 */
function longestStringKey(obj: Record<string, unknown>): string | null {
  let key: string | null = null;
  let len = -1;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.length > len) {
      len = v.length;
      key = k;
    }
  }
  return key;
}

/**
 * Append one telemetry event as a single JSONL line. Fail-open: never throws.
 *
 * @param event Partial event; `ts` is stamped and `schema_version` forced to 1.
 * @param opts  Injected seams (path/clock/append) -- defaults write to disk.
 */
export function appendIntelBus(event: IntelBusEvent, opts: AppendIntelBusOptions = {}): void {
  try {
    const now = opts.now ?? (() => new Date().toISOString());
    const append = opts.append ?? defaultAppend;
    const path = intelBusPath(opts.projectDir);

    // Normalize: stamp ts, force schema_version, strip embedded newlines.
    const normalized = stripNewlinesDeep({
      ...event,
      ts: event.ts ?? now(),
      schema_version: 1,
    }) as Record<string, unknown>;

    let line = JSON.stringify(normalized) + '\n';

    // 4 KB assertion: if the line is too long, trim the largest string field
    // once; if it is still too long, drop the event entirely. Never write a
    // line longer than MAX_LINE_BYTES.
    if (Buffer.byteLength(line, 'utf-8') > MAX_LINE_BYTES) {
      const key = longestStringKey(normalized);
      if (key) {
        // Reserve budget for the rest of the record + the truncation marker.
        const marker = '...(truncated)';
        const withoutField = { ...normalized, [key]: '' };
        const overhead = Buffer.byteLength(JSON.stringify(withoutField) + '\n', 'utf-8');
        const budget = MAX_LINE_BYTES - overhead - marker.length;
        if (budget > 0) {
          const original = String(normalized[key]);
          normalized[key] = original.slice(0, budget) + marker;
          line = JSON.stringify(normalized) + '\n';
        }
      }
      // If trimming did not get us under budget, drop the event (do not write).
      if (Buffer.byteLength(line, 'utf-8') > MAX_LINE_BYTES) {
        return;
      }
    }

    append(path, line);
  } catch {
    // Fail-open: telemetry must never break the hot path.
  }
}

/** Default disk append: ensure the logs dir exists, then bare appendFileSync. */
function defaultAppend(path: string, line: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(path, line, 'utf-8');
}
