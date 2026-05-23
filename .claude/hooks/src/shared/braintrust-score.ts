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
 */

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
