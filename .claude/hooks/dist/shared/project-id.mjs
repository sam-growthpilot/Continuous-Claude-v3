// src/shared/project-id.ts
import { createHash } from "node:crypto";
import { resolve } from "node:path";
function getProjectId(projectDir) {
  const absPath = resolve(projectDir);
  return createHash("sha256").update(absPath).digest("hex").substring(0, 16);
}
function getActiveProjectId() {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return getProjectId(dir);
}
export {
  getActiveProjectId,
  getProjectId
};
