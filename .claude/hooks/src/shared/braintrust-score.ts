/**
 * Braintrust score-emit helper for TypeScript hooks.
 *
 * Companion to the Python `braintrust_hooks.py` insert-span helpers. The Python
 * hooks own span/event creation; this helper owns score (feedback) emission
 * from TS-side hooks (memory-awareness, hook-health-monitor, etc.).
 *
 * Design contract:
 *   - Fail-open: NEVER throws. All errors swallowed to stderr only.
 *   - Skips silently when TRACE_TO_BRAINTRUST != "true" or BRAINTRUST_API_KEY unset.
 *   - 2-second AbortController timeout (matches dashboard-reporter pattern).
 *   - Endpoint: POST {API_URL}/v1/project_logs/{project_id}/feedback
 *   - Payload shape: { feedback: [{ id, scores, metadata?, comment? }] }
 *
 * Project ID resolution (mirrors Python `get_project_id`):
 *   1. BRAINTRUST_CC_PROJECT_ID env var (direct, no lookup)
 *   2. BRAINTRUST_CC_PROJECT env var -> GET /v1/project?project_name=... -> cache
 *
 * Cache is in-process only; each hook invocation is a separate Node process so
 * the cache lives for one hook execution. The Python hook caches via the
 * shared `braintrust_global.json`; we don't share that file here (different
 * runtime, different lifetime).
 *
 * Environment loading:
 *   The Claude Code hook subprocess does NOT inherit `~/.claude/.env` — the
 *   Python sibling explicitly reads that file at startup. `loadEnv()` is the
 *   TS parity for that, called lazily on first `isTraceEnabled()` check so
 *   `BRAINTRUST_API_KEY` and friends are present when the hook runs.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timeout for both project lookup and feedback POST. */
export const BRAINTRUST_FEEDBACK_TIMEOUT_MS = 2000;

const DEFAULT_API_URL = 'https://api.braintrust.dev';
const DEFAULT_PROJECT_NAME = 'claude-code';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmitScoreOptions {
  /** Braintrust span_id to attach the score to. */
  spanId: string;
  /** 0-1 floats keyed by score dimension name. */
  scores: Record<string, number>;
  /** Optional metadata blob recorded alongside the score. */
  metadata?: Record<string, unknown>;
  /** Optional human-readable comment for the score. */
  comment?: string;
}

interface FeedbackEntry {
  id: string;
  scores: Record<string, number>;
  metadata?: Record<string, unknown>;
  comment?: string;
}

// ---------------------------------------------------------------------------
// In-process project-id cache
// ---------------------------------------------------------------------------

/**
 * Cached project_id keyed by project_name. Populated lazily on first lookup.
 * Lives only for the lifetime of this Node process (one hook invocation).
 */
let projectIdCache: Record<string, string> = {};

/**
 * Test-only escape hatch to reset the cache between unit tests.
 * NOT for production use.
 */
export function resetProjectIdCacheForTests(): void {
  projectIdCache = {};
}

// ---------------------------------------------------------------------------
// .env loader (parity with Python braintrust_hooks.py)
// ---------------------------------------------------------------------------

/**
 * Tracks which .env file paths have already been loaded this process, so
 * subsequent calls are no-ops. Keyed by absolute path so callers can target
 * different files in tests.
 */
const loadedEnvPaths = new Set<string>();

/**
 * Default path to the user-level .env file: `~/.claude/.env`. Resolved at
 * call time (not module-load time) so tests can spy on `os.homedir` if they
 * need to, and so the value reflects the runtime user.
 */
function defaultEnvPath(): string {
  return join(homedir(), '.claude', '.env');
}

/**
 * Load environment variables from a `KEY=VALUE` file into `process.env`.
 *
 * Parity contract with the Python sibling (`braintrust_hooks.py:854-868`):
 *   - Splits each line on the FIRST `=` (so values may contain `=`).
 *   - Skips blank lines and lines starting with `#`.
 *   - Trims surrounding whitespace from key and value.
 *   - Strips matching surrounding quotes (`"..."` or `'...'`) from value.
 *
 * Difference from Python: shell env wins. We only set keys that are NOT
 * already present in `process.env`. This is safer than the Python helper's
 * unconditional overwrite — the shell env is the authoritative source when
 * an operator deliberately exports something.
 *
 * Never throws — missing file is a silent no-op. The whole point of this
 * helper is to make the fail-open contract above actually fail open.
 *
 * Module-scope caches the result: calling `loadEnv(path)` twice with the
 * same path will only read the file once.
 *
 * @param envPath - Path to .env file. Defaults to `~/.claude/.env`.
 */
export function loadEnv(envPath?: string): void {
  const path = envPath ?? defaultEnvPath();
  if (loadedEnvPaths.has(path)) return;

  // Mark as loaded BEFORE the I/O so a transient read error doesn't
  // cause an infinite retry loop on repeated calls.
  loadedEnvPaths.add(path);

  try {
    if (!existsSync(path)) return;
    const text = readFileSync(path, 'utf8');

    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0) continue;
      if (line.startsWith('#')) continue;

      const eq = line.indexOf('=');
      if (eq <= 0) continue; // no `=` or starts with `=`

      const key = line.slice(0, eq).trim();
      if (key.length === 0) continue;

      let value = line.slice(eq + 1).trim();

      // Strip matching surrounding quotes (both ends only).
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }

      // Shell env wins — only set if not already present.
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Silent no-op on any read/parse failure; the fail-open contract is
    // more important than surfacing the error.
  }
}

/**
 * Test-only escape hatch to clear the loaded-paths cache between unit tests.
 * NOT for production use.
 */
export function resetLoadEnvCacheForTests(): void {
  loadedEnvPaths.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiUrl(): string {
  return process.env.BRAINTRUST_API_URL || DEFAULT_API_URL;
}

function getApiKey(): string | null {
  const key = process.env.BRAINTRUST_API_KEY;
  return key && key.length > 0 ? key : null;
}

function isTraceEnabled(): boolean {
  // Lazily load ~/.claude/.env so hooks running as Claude Code subprocesses
  // (which do NOT inherit that file) still see BRAINTRUST_API_KEY etc.
  // First call reads the file; subsequent calls hit the cache.
  loadEnv();
  return (process.env.TRACE_TO_BRAINTRUST || '').toLowerCase() === 'true';
}

function logErr(msg: string): void {
  // Hooks should never crash, but we still want a breadcrumb on stderr so
  // operators can grep the hook log if scores stop appearing in Braintrust.
  try {
    process.stderr.write(`[braintrust-score] ${msg}\n`);
  } catch {
    /* truly nothing we can do */
  }
}

/**
 * Resolve the Braintrust project_id from env or via API lookup.
 * Returns null on any failure (no project_id env, no project_name env,
 * lookup failure, lookup returned no objects).
 *
 * Never throws.
 */
async function resolveProjectId(apiKey: string): Promise<string | null> {
  // Prefer explicit project id env var (cheapest path)
  const directId = process.env.BRAINTRUST_CC_PROJECT_ID;
  if (directId && directId.length > 0) {
    return directId;
  }

  // Fall back to looking up by name
  const projectName = process.env.BRAINTRUST_CC_PROJECT || DEFAULT_PROJECT_NAME;

  // Cache hit?
  const cached = projectIdCache[projectName];
  if (cached) return cached;

  // GET /v1/project?project_name=<name>
  try {
    const url =
      getApiUrl() +
      '/v1/project?project_name=' +
      encodeURIComponent(projectName);

    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(BRAINTRUST_FEEDBACK_TIMEOUT_MS),
    });

    if (!resp.ok) {
      logErr(`project lookup ${projectName}: HTTP ${resp.status}`);
      return null;
    }

    const data = (await resp.json()) as { objects?: Array<{ id?: string }> };
    const objects = data?.objects;
    if (!objects || objects.length === 0) {
      logErr(`project lookup ${projectName}: no objects`);
      return null;
    }

    const id = objects[0]?.id;
    if (!id) {
      logErr(`project lookup ${projectName}: object missing id`);
      return null;
    }

    projectIdCache[projectName] = id;
    return id;
  } catch (e) {
    logErr(`project lookup ${projectName} failed: ${(e as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

/**
 * Emit a score (feedback) to Braintrust.
 *
 * Fail-open contract — never throws. Skips silently when:
 *   - TRACE_TO_BRAINTRUST is not "true"
 *   - BRAINTRUST_API_KEY is missing or empty
 *   - scores is empty
 *   - spanId is empty
 *   - project id cannot be resolved
 *   - fetch fails (network, timeout, non-2xx)
 *
 * @param opts - spanId, scores, optional metadata/comment
 */
export async function emitBraintrustScore(
  opts: EmitScoreOptions,
): Promise<void> {
  try {
    // Skip if tracing is disabled
    if (!isTraceEnabled()) return;

    const apiKey = getApiKey();
    if (!apiKey) return;

    // Skip empty payloads
    if (!opts.spanId || opts.spanId.length === 0) return;
    if (!opts.scores || Object.keys(opts.scores).length === 0) return;

    const projectId = await resolveProjectId(apiKey);
    if (!projectId) return;

    // Build feedback entry — only include optional fields when present
    const entry: FeedbackEntry = {
      id: opts.spanId,
      scores: opts.scores,
    };
    if (opts.metadata !== undefined) {
      entry.metadata = opts.metadata;
    }
    if (opts.comment !== undefined) {
      entry.comment = opts.comment;
    }

    const url = `${getApiUrl()}/v1/project_logs/${projectId}/feedback`;

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ feedback: [entry] }),
        signal: AbortSignal.timeout(BRAINTRUST_FEEDBACK_TIMEOUT_MS),
      });

      if (!resp.ok) {
        logErr(`feedback POST ${opts.spanId}: HTTP ${resp.status}`);
      }
    } catch (e) {
      logErr(`feedback POST ${opts.spanId} failed: ${(e as Error).message}`);
    }
  } catch (e) {
    // Last-resort catch — should be unreachable, but the fail-open contract
    // is non-negotiable.
    logErr(`unexpected error: ${(e as Error).message}`);
  }
}
