/**
 * Bus-ID derivation for the L2 Context Bus (WS-2 Phase A.0).
 *
 * getBusId() returns a stable id per (user, project, session). The Phase A.1
 * context bus uses it to compute its session-scoped file path:
 *   .claude/cache/session/<bus_id>/context.json
 *
 * BOUNDARY (finding #15): this is a SECOND exported function, NOT a merge.
 * Coordination callers (session-register.ts / file-claims.ts) keep their
 * existing COORDINATION_SESSION_ID-first chain in shared/session-id.ts
 * untouched; only bus callers use getBusId(). See the L3 boundary doc
 * (.claude/rules/code-intel-boundaries.md, added in A.3).
 *
 * Windows-correctness:
 *  - Session signal reuses getSessionId() from session-id.ts, which already
 *    resolves home as HOME || USERPROFILE || homedir() for its persistence
 *    file. The bus does not re-read home directly; the session signal carries
 *    the user dimension (finding #11). The realpath-based project hash below
 *    supplies the project dimension (finding #12).
 *  - Per-project isolation hashes sha256(realpath(cwd).toLowerCase()) -- NOT
 *    an inode (cwd_inode is 0 on NTFS -> zero isolation on Windows).
 *
 * Fail-open: getBusId() must NEVER throw. If realpath throws (missing path),
 * we hash the raw cwd string instead.
 */

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { getSessionId } from './session-id.js';

/** Length of the hex project-hash prefix embedded in the bus id. */
const PROJECT_HASH_LEN = 12;

/** Default project root: explicit env wins, else the process cwd. */
function defaultCwd(): string {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/**
 * Hash a project path into a stable, case-insensitive hex prefix.
 *
 * Resolves symlinks via the injected realpath (defaults to fs.realpathSync),
 * lowercases for NTFS case-insensitivity, then sha256 -> hex prefix. If
 * realpath throws, falls back to hashing the raw (lowercased) input.
 */
export function hashProjectPath(
  cwd: string,
  realpath: (p: string) => string = realpathSync,
): string {
  let resolved: string;
  try {
    resolved = realpath(cwd);
  } catch {
    resolved = cwd; // fail-open: missing path -> hash the raw string
  }
  const normalized = resolved.toLowerCase();
  return createHash('sha256').update(normalized).digest('hex').slice(0, PROJECT_HASH_LEN);
}

/**
 * Strip anything that is not safe in a directory name AND guarantee the result
 * can never be a traversal segment. Beyond the character whitelist we collapse
 * any RUN of dots to a single dot, so inputs like `..`, `...`, or `a..b` can
 * never survive as `..` (finding #3 hardening). Exported for direct testing.
 */
export function sanitizeBusPart(part: string): string {
  return part
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.') // collapse `..`, `...`, etc. -> a single `.`
    .slice(0, 40);
}

/**
 * Derive a stable bus id for the current (user, project, session).
 *
 * Composition: `<sessionId>-<projectHashPrefix>`. The session signal stays
 * human-readable in the path for debuggability; the project hash guarantees
 * cross-project isolation. Stable within a session+project, differs across
 * projects. Never throws.
 *
 * @param opts.cwd      Project root override (default: CLAUDE_PROJECT_DIR || cwd).
 * @param opts.realpath Symlink resolver override (default: fs.realpathSync) -- test seam.
 */
export function getBusId(opts: { cwd?: string; realpath?: (p: string) => string } = {}): string {
  try {
    const sessionId = sanitizeBusPart(getSessionId());
    const projectHash = hashProjectPath(opts.cwd ?? defaultCwd(), opts.realpath);
    return `${sessionId}-${projectHash}`;
  } catch {
    // Absolute last resort: a hash of whatever cwd we can see, never throw.
    const fallback = hashProjectPath(opts.cwd ?? defaultCwd(), opts.realpath);
    return `s-unknown-${fallback}`;
  }
}
