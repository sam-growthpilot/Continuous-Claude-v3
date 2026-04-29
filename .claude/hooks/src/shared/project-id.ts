/**
 * Project-ID derivation -- mirrors opc/scripts/core/project_memory.py:get_project_id().
 *
 * Phase 4 of cross-project isolation: hook state files keyed only by
 * sessionId can collide when two terminals share a session ID across
 * different projects. The fix is to scope hook state by sha256(projectDir)
 * in addition to sessionId.
 *
 * This module is the canonical TS implementation of the same hash function
 * Python uses, so a state file written from one side can be read from the
 * other.
 */

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/**
 * Generate a stable 16-char project ID from an absolute path.
 *
 * Mirrors python:
 *   abs_path = str(Path(project_dir).resolve())
 *   hashlib.sha256(abs_path.encode()).hexdigest()[:16]
 */
export function getProjectId(projectDir: string): string {
  const absPath = resolve(projectDir);
  return createHash('sha256').update(absPath).digest('hex').substring(0, 16);
}

/**
 * Derive the project ID for the currently active project, falling back to
 * CWD when no CLAUDE_PROJECT_DIR is set.
 */
export function getActiveProjectId(): string {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return getProjectId(dir);
}
