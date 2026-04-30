/**
 * fresh-project-fixture.mjs
 *
 * Helper for `system-coherence-stress.mjs`. Creates and tears down
 * temporary "fresh project" directories with a clean `CLAUDE_PROJECT_DIR`
 * for SessionStart hook simulation.
 *
 * No external deps -- Node built-ins only.
 */

import { mkdtemp, mkdir, writeFile, rm, copyFile, stat, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Create a temp project directory with optional seed files.
 *
 * @param {object} opts
 * @param {string} [opts.prefix]   - dir name prefix (default 'ccv3-stress-')
 * @param {string[]} [opts.files]  - relative paths to create as empty files
 * @param {Record<string,string>} [opts.contents] - relative path -> file contents
 * @returns {Promise<{dir: string, env: object}>}
 */
export async function createFreshProject(opts = {}) {
  const prefix = opts.prefix || 'ccv3-stress-';
  const dir = await mkdtemp(join(tmpdir(), prefix));

  // Optional empty files
  for (const rel of opts.files || []) {
    const full = join(dir, rel);
    const subdir = full.substring(0, full.lastIndexOf('/'));
    if (subdir && !existsSync(subdir)) {
      await mkdir(subdir, { recursive: true });
    }
    await writeFile(full, '');
  }

  // Optional file contents
  for (const [rel, content] of Object.entries(opts.contents || {})) {
    const full = join(dir, rel);
    const lastSep = Math.max(full.lastIndexOf('/'), full.lastIndexOf('\\'));
    const subdir = full.substring(0, lastSep);
    if (subdir && !existsSync(subdir)) {
      await mkdir(subdir, { recursive: true });
    }
    await writeFile(full, content);
  }

  const env = {
    ...process.env,
    CLAUDE_PROJECT_DIR: dir,
    CLAUDE_SESSION_ID: `stress-fresh-${Date.now()}`,
  };

  return { dir, env };
}

/**
 * Recursively remove a temp dir. Safe (no-op if missing).
 *
 * @param {string} dir - absolute path
 */
export async function destroyFreshProject(dir) {
  if (!dir || !dir.includes('ccv3-stress')) {
    // Defensive: only delete dirs that look like ours
    return;
  }
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * Backup a real project file before any probe touches it. Verifies via
 * sha256 hash on restore. Returns the backup path.
 *
 * @param {string} sourcePath
 * @returns {Promise<{backupPath: string, sha256: string}|null>}
 */
export async function backupFile(sourcePath) {
  if (!existsSync(sourcePath)) {
    return null;
  }
  const ts = Date.now();
  const safeName = sourcePath.replace(/[\\/:]/g, '_').slice(-80);
  const backupPath = join(tmpdir(), `ccv3-backup-${safeName}-${ts}`);
  // Capture original timestamps before copyFile (which would set the dest's
  // mtime to "now" and break our claim that backup/restore is byte-and-time
  // identical to the original).
  const srcStat = await stat(sourcePath);
  await copyFile(sourcePath, backupPath);
  await utimes(backupPath, srcStat.atime, srcStat.mtime);
  const sha256 = await hashFile(backupPath);
  return { backupPath, sha256 };
}

/**
 * Restore a file from backup, verifying sha256 match after copy.
 *
 * @param {string} backupPath
 * @param {string} targetPath
 * @param {string} expectedSha256
 * @returns {Promise<{restored: boolean, hashMatched: boolean}>}
 */
export async function restoreFile(backupPath, targetPath, expectedSha256) {
  if (!existsSync(backupPath)) {
    return { restored: false, hashMatched: false };
  }
  // The backup carries the original mtime (see backupFile). After copying
  // back to the target, replay those timestamps so callers can rely on
  // "restored == bit-for-bit and time-for-time identical to original".
  const backupStat = await stat(backupPath);
  await copyFile(backupPath, targetPath);
  await utimes(targetPath, backupStat.atime, backupStat.mtime);
  const actualSha = await hashFile(targetPath);
  return { restored: true, hashMatched: actualSha === expectedSha256 };
}

/**
 * Compute sha256 of a file as a hex string.
 *
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function hashFile(path) {
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Read a JSON file safely, returning null if missing or invalid.
 *
 * @param {string} path
 * @returns {Promise<any|null>}
 */
export async function readJsonSafe(path) {
  if (!existsSync(path)) return null;
  try {
    const { readFile } = await import('node:fs/promises');
    const txt = await readFile(path, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/**
 * Stat a file and return mtime as a Unix epoch (seconds), or null.
 *
 * @param {string} path
 * @returns {Promise<number|null>}
 */
export async function fileMtime(path) {
  try {
    const s = await stat(path);
    return Math.floor(s.mtimeMs / 1000);
  } catch {
    return null;
  }
}
