// src/hook-trace.ts
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
function getTracePath() {
  const dir = join(homedir(), ".claude", "cache");
  mkdirSync(dir, { recursive: true });
  return join(dir, "hook-trace.jsonl");
}
function getSessionId() {
  return process.env.CLAUDE_SESSION_ID || String(process.pid);
}
var defaultWriter = (r) => appendFileSync(getTracePath(), JSON.stringify(r) + "\n", "utf-8");
var activeWriter = defaultWriter;
function __setTraceWriter(writer) {
  activeWriter = writer ?? defaultWriter;
}
function writeRecord(r) {
  try {
    activeWriter(r);
  } catch {
  }
}
function buildRecord(name, event, startedAt, exitCode, error) {
  const errMsg = error == null ? null : error instanceof Error ? error.message || String(error) : String(error);
  return {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    name,
    event,
    durationMs: Date.now() - startedAt,
    exitCode,
    sessionId: getSessionId(),
    error: errMsg
  };
}
function traceHook(name, event, fn) {
  const startedAt = Date.now();
  let result;
  try {
    result = fn();
  } catch (err) {
    writeRecord(buildRecord(name, event, startedAt, 1, err));
    throw err;
  }
  if (result && typeof result.then === "function") {
    return result.then(
      (v) => {
        writeRecord(buildRecord(name, event, startedAt, 0, null));
        return v;
      },
      (e) => {
        writeRecord(buildRecord(name, event, startedAt, 1, e));
        throw e;
      }
    );
  }
  writeRecord(buildRecord(name, event, startedAt, 0, null));
  return result;
}
export {
  __setTraceWriter,
  getTracePath,
  traceHook
};
