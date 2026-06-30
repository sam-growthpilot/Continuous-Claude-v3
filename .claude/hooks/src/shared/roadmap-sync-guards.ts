/**
 * ROADMAP auto-sync write guards (QW-12 — closes D2d-09, D2d-10, D2d-13).
 *
 * Sibling to shared/project-relevance.ts (the QW-03 cross-project contamination
 * guard, D2d-01/02/03). That guard answers "does this TEXT belong to THIS
 * project vs a sibling?". The two ROADMAP auto-sync hooks need two DIFFERENT
 * axes the content-relevance guard cannot see, so they are factored here:
 *
 *  - isTasksRelatedToGoal  (D2d-09)  feature ↔ goal relatedness, so a 100%
 *    tasks-*.md does not falsely mark an UNRELATED current goal complete.
 *  - isPathInsideProject   (D2d-13)  path.relative containment, so a sibling
 *    dir sharing a name prefix (continuous-claude-x) no longer bypasses the
 *    startsWith() boundary check.
 *  - commitRanInProject    (D2d-10)  effective-cwd verification, so a
 *    `cd <other-repo> && git commit` does not write a foreign repo's commit
 *    into this project's ROADMAP. project-relevance cannot detect this — the
 *    commit message carries no foreign-project token; the signal is the `cd`.
 *
 * Used by:
 *  - prd-roadmap-sync.ts   (isTasksRelatedToGoal, isPathInsideProject)
 *  - git-commit-roadmap.ts (commitRanInProject)
 */

import * as path from 'path';
import { homedir } from 'node:os';

/**
 * Generic tokens that must NEVER, on their own, make a tasks file look related
 * to a ROADMAP goal. Mirrors the IDENTITY_STOPWORDS philosophy from
 * shared/project-relevance.ts: infrastructure-generic words appear in many
 * unrelated feature/goal titles, so they carry no distinctive relatedness
 * signal.
 */
const GOAL_STOPWORDS = new Set<string>([
  'system',
  'app',
  'platform',
  'engine',
  'server',
  'service',
  'module',
  'project',
  'feature',
  'support',
  'the',
  'and',
  'for',
  'with',
  'new',
  'update',
  'fix',
  'add',
]);

/** Distinctive lowercased word tokens (length >= 3, stopwords removed). */
function distinctiveTokens(text: string): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !GOAL_STOPWORDS.has(w)),
  );
}

/**
 * D2d-09: Is a tasks file's feature name related to a ROADMAP goal title?
 *
 * The pre-fix hook marked `roadmap.current.title` complete on ANY 100% tasks
 * file, with no relatedness check. This restores a positive-evidence
 * requirement: relatedness needs a shared DISTINCTIVE token (or a direct
 * phrase containment) — a shared generic/stopword token ("service", "system")
 * is not enough. Returns false on empty input (fail-safe: do not complete).
 */
export function isTasksRelatedToGoal(featureName: string, goalTitle: string): boolean {
  const f = (featureName || '').toLowerCase().trim();
  const g = (goalTitle || '').toLowerCase().trim();
  if (!f || !g) return false;

  // Direct phrase containment is always related.
  if (g.includes(f) || f.includes(g)) return true;

  const featureTokens = distinctiveTokens(featureName);
  const goalTokens = distinctiveTokens(goalTitle);
  // No distinctive signal on either side -> cannot establish relatedness.
  if (featureTokens.size === 0 || goalTokens.size === 0) return false;

  for (const t of goalTokens) {
    if (featureTokens.has(t)) return true;
  }
  return false;
}

/**
 * D2d-13: Is targetPath contained within projectDir?
 *
 * Uses path.relative instead of startsWith — a sibling directory sharing a name
 * prefix (e.g. `<root>/continuous-claude-x` vs `<root>/continuous-claude`) is
 * correctly reported as OUTSIDE. A relative path that starts with `..` or is
 * absolute (a different drive on Windows) means the target escapes the project.
 */
export function isPathInsideProject(targetPath: string, projectDir: string): boolean {
  if (!targetPath || !projectDir) return false;
  const rel = path.relative(path.resolve(projectDir), path.resolve(targetPath));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Extract the directory a command `cd`s into BEFORE running `git commit`, or
 * null when the command does not change directory ahead of the commit.
 *
 * Scoped to the text before the first `git ... commit` so a `cd` that appears
 * AFTER the commit (or the literal word "cd" inside the commit message) does
 * not falsely register. Handles bare, single-quoted and double-quoted targets,
 * anchored at the command start or after a shell separator (`;` `&` `|` `&&`).
 */
export function extractCdTarget(command: string): string | null {
  if (!command) return null;
  // Only consider a directory change that happens before the git commit.
  const commitIdx = command.search(/git\s+(?:-[^\s]+\s+)*commit/i);
  const scope = commitIdx >= 0 ? command.slice(0, commitIdx) : command;
  const m = scope.match(/(?:^|[;&|]\s*|&&\s*)cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/);
  if (!m) return null;
  return m[1] || m[2] || m[3] || null;
}

/**
 * D2d-10: Did a `git commit` command run inside THIS project?
 *
 * The git-commit-roadmap hook records commits into the session project's
 * ROADMAP, but a `cd <other-repo> && git commit` (routine for ~/.claude quick
 * fixes) ran in a foreign repo. We verify the effective working directory:
 *  - no `cd` before the commit  -> ran in cwd == projectDir          -> allow
 *  - `cd` into projectDir/subdir -> still inside the project          -> allow
 *  - `cd` into another/sibling dir -> foreign repo                    -> block
 *
 * Note: `git -C <dir> commit` is NOT covered (the finding is about `cd`); such
 * commands are allowed through, same as before.
 */
export function commitRanInProject(command: string, projectDir: string): boolean {
  const target = extractCdTarget(command);
  if (!target) return true; // No directory change -> runs in cwd == projectDir.

  let resolved = target;
  if (resolved === '~' || resolved.startsWith('~/') || resolved.startsWith('~\\')) {
    resolved = path.join(homedir(), resolved.slice(1));
  }
  const abs = path.isAbsolute(resolved)
    ? path.resolve(resolved)
    : path.resolve(projectDir, resolved);
  return isPathInsideProject(abs, projectDir);
}
