// src/shared/session-isolation.ts
import { tmpdir, hostname } from "os";
import { join } from "path";
import { existsSync, readdirSync, statSync, unlinkSync } from "fs";
function getSessionId() {
  if (process.env.CLAUDE_SESSION_ID) {
    return process.env.CLAUDE_SESSION_ID;
  }
  const host = hostname().replace(/[^a-zA-Z0-9]/g, "").substring(0, 8);
  return `${host}-${process.pid}`;
}
function getSessionStatePath(baseName, sessionId) {
  const sid = sessionId || getSessionId();
  const safeSid = sid.replace(/[^a-zA-Z0-9-_]/g, "_").substring(0, 32);
  return join(tmpdir(), `claude-${baseName}-${safeSid}.json`);
}
function getLegacyStatePath(baseName) {
  return join(tmpdir(), `claude-${baseName}.json`);
}
function getStatePathWithMigration(baseName, sessionId) {
  const sessionPath = getSessionStatePath(baseName, sessionId);
  const legacyPath = getLegacyStatePath(baseName);
  if (existsSync(sessionPath)) {
    return sessionPath;
  }
  if (existsSync(legacyPath)) {
    try {
      const stat = statSync(legacyPath);
      const oneHourAgo = Date.now() - 60 * 60 * 1e3;
      if (stat.mtimeMs > oneHourAgo) {
        return legacyPath;
      }
    } catch {
    }
  }
  return sessionPath;
}
function getProjectScopedStatePath(baseName, projectId, sessionId) {
  const sid = sessionId || getSessionId();
  const safeSid = sid.replace(/[^a-zA-Z0-9-_]/g, "_").substring(0, 32);
  const safePid = projectId.replace(/[^a-zA-Z0-9]/g, "").substring(0, 16);
  return join(tmpdir(), `claude-${baseName}-${safePid}-${safeSid}.json`);
}
function getProjectScopedStatePathWithMigration(baseName, projectId, sessionId) {
  const scoped = getProjectScopedStatePath(baseName, projectId, sessionId);
  const legacySession = getSessionStatePath(baseName, sessionId);
  if (existsSync(scoped)) return scoped;
  if (existsSync(legacySession)) {
    try {
      const stat = statSync(legacySession);
      const oneHourAgo = Date.now() - 60 * 60 * 1e3;
      if (stat.mtimeMs > oneHourAgo) return legacySession;
    } catch {
    }
  }
  return scoped;
}
function cleanupOldStateFiles(baseName, maxAgeMs = 24 * 60 * 60 * 1e3) {
  const tmpDir = tmpdir();
  const pattern = new RegExp(`^claude-${baseName}-.*\\.json$`);
  let cleaned = 0;
  try {
    const files = readdirSync(tmpDir);
    const now = Date.now();
    for (const file of files) {
      if (!pattern.test(file)) continue;
      const fullPath = join(tmpDir, file);
      try {
        const stat = statSync(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          unlinkSync(fullPath);
          cleaned++;
        }
      } catch {
      }
    }
  } catch {
  }
  return cleaned;
}
function listActiveSessions(baseName, ttlMs = 4 * 60 * 60 * 1e3) {
  const tmpDir = tmpdir();
  const pattern = new RegExp(`^claude-${baseName}-(.*)\\.json$`);
  const sessions = [];
  try {
    const files = readdirSync(tmpDir);
    const now = Date.now();
    for (const file of files) {
      const match = file.match(pattern);
      if (!match) continue;
      const fullPath = join(tmpDir, file);
      try {
        const stat = statSync(fullPath);
        if (now - stat.mtimeMs < ttlMs) {
          sessions.push(match[1]);
        }
      } catch {
      }
    }
  } catch {
  }
  return sessions;
}
function hasOtherActiveSessions(baseName, currentSessionId) {
  const current = currentSessionId || getSessionId();
  const active = listActiveSessions(baseName);
  return active.some((sid) => sid !== current);
}
export {
  cleanupOldStateFiles,
  getLegacyStatePath,
  getProjectScopedStatePath,
  getProjectScopedStatePathWithMigration,
  getSessionId,
  getSessionStatePath,
  getStatePathWithMigration,
  hasOtherActiveSessions,
  listActiveSessions
};
