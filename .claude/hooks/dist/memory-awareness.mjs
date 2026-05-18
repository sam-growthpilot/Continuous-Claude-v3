// src/memory-awareness.ts
import { readFileSync as readFileSync3, existsSync as existsSync4, mkdirSync as mkdirSync2, appendFileSync } from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

// src/shared/opc-path.ts
import { existsSync } from "fs";
import { join } from "path";
function getOpcDir() {
  const envOpcDir = process.env.CLAUDE_OPC_DIR;
  if (envOpcDir && existsSync(envOpcDir)) {
    return envOpcDir;
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const localOpc = join(projectDir, "opc");
  if (existsSync(localOpc)) {
    return localOpc;
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  if (homeDir) {
    const globalClaude = join(homeDir, ".claude");
    const globalScripts = join(globalClaude, "scripts", "core");
    if (existsSync(globalScripts) && globalClaude !== projectDir) {
      return globalClaude;
    }
  }
  return null;
}

// src/shared/output.ts
function outputContinue() {
  console.log(JSON.stringify({ result: "continue" }));
}

// src/shared/session-activity.ts
import { existsSync as existsSync2, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join as join2 } from "path";
function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || "/tmp";
}
function getActivityPath(sessionId) {
  const dir = join2(getHomeDir(), ".claude", "cache", "session-activity");
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
  }
  return join2(dir, `${sessionId}.json`);
}
function readActivity(sessionId) {
  const filePath = getActivityPath(sessionId);
  try {
    if (!existsSync2(filePath)) {
      return null;
    }
    const raw = readFileSync(filePath, "utf-8");
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function loadOrCreate(sessionId) {
  const existing = readActivity(sessionId);
  if (existing) {
    if (!existing.agents) existing.agents = [];
    if (!existing.mcp_servers) existing.mcp_servers = [];
    return existing;
  }
  return {
    session_id: sessionId,
    started_at: (/* @__PURE__ */ new Date()).toISOString(),
    skills: [],
    hooks: [],
    agents: [],
    mcp_servers: []
  };
}
function upsertEntry(entries, name) {
  const existing = entries.find((e) => e.name === name);
  if (existing) {
    existing.count++;
  } else {
    entries.push({
      name,
      first_seen: (/* @__PURE__ */ new Date()).toISOString(),
      count: 1
    });
  }
}
function logHook(sessionId, hookName) {
  const activity = loadOrCreate(sessionId);
  upsertEntry(activity.hooks, hookName);
  const filePath = getActivityPath(sessionId);
  writeFileSync(filePath, JSON.stringify(activity), { encoding: "utf-8" });
}

// src/shared/intent-extractor.ts
var STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "must",
  "can",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "s",
  "t",
  "just",
  "don",
  "now",
  "i",
  "me",
  "my",
  "you",
  "your",
  "we",
  "help",
  "with",
  "our",
  "they",
  "them",
  "their",
  "it",
  "its",
  "this",
  "that",
  "these",
  "what",
  "which",
  "who",
  "whom",
  "and",
  "but",
  "if",
  "or",
  "because",
  "until",
  "while",
  "about",
  "against",
  "also",
  "get",
  "got",
  "make",
  "want",
  "need",
  "look",
  "see",
  "use",
  "like",
  "know",
  "think",
  "take",
  "come",
  "go",
  "say",
  "said",
  "tell",
  "please",
  "help",
  "let",
  "sure",
  "recall",
  "remember",
  "similar",
  "problems",
  "issues"
]);
var META_PATTERNS = [
  /^(can you|could you|would you|please|help me|i want to|i need to|let's|lets)\s+/gi,
  /^(show me|tell me|find|search for|look for|recall|remember)\s+/gi,
  /^(how do i|how can i|how to|what is|what are|where is|where are)\s+/gi,
  /\s+(for me|please|thanks|thank you)$/gi,
  /\?$/g
];
function extractKeywords(prompt) {
  if (typeof prompt !== "string") return "";
  const words = prompt.toLowerCase().replace(/[^\w\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 5).join(" ");
}
function extractIntent(prompt) {
  if (typeof prompt !== "string") return "";
  let intent = prompt.trim();
  for (const pattern of META_PATTERNS) {
    intent = intent.replace(pattern, "");
  }
  intent = intent.trim();
  if (intent.length < 5) {
    return extractKeywords(prompt);
  }
  return intent;
}

// src/shared/embedding-client.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "fs";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join as join3, resolve } from "path";
import * as net from "net";
var DAEMON_INFO_PATH = join3(tmpdir(), "ccv3-embedding.json");
var FRAME_SIZE_CAP_BYTES = 100 * 1024 * 1024;
var DEFAULT_PING_TIMEOUT_MS = 200;
var EXPECTED_MODEL = "BAAI/bge-large-en-v1.5";
var EXPECTED_DIM = 1024;
function sendFrame(sock, obj) {
  const payload = Buffer.from(JSON.stringify(obj), "utf-8");
  if (payload.length > FRAME_SIZE_CAP_BYTES) {
    throw new Error(`frame too large: ${payload.length} bytes`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  sock.write(Buffer.concat([header, payload]));
}
function recvFrame(sock, timeoutMs) {
  return new Promise((res, rej) => {
    let received = Buffer.alloc(0);
    let expectedLen = null;
    let settled = false;
    const finish = (cb) => {
      if (settled) return;
      settled = true;
      sock.removeAllListeners("data");
      sock.removeAllListeners("error");
      sock.removeAllListeners("close");
      sock.removeAllListeners("timeout");
      sock.setTimeout(0);
      cb();
    };
    sock.setTimeout(timeoutMs, () => {
      finish(() => rej(new Error("frame read timeout")));
    });
    sock.on("error", (err) => {
      finish(() => rej(err));
    });
    sock.on("close", () => {
      finish(
        () => rej(new Error(`socket closed after ${received.length} bytes`))
      );
    });
    sock.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (expectedLen === null && received.length >= 4) {
        expectedLen = received.readUInt32BE(0);
        if (expectedLen > FRAME_SIZE_CAP_BYTES) {
          finish(() => rej(new Error(`frame too large: ${expectedLen} bytes`)));
          return;
        }
      }
      if (expectedLen !== null && received.length >= 4 + expectedLen) {
        const payload = received.subarray(4, 4 + expectedLen);
        try {
          const parsed = JSON.parse(payload.toString("utf-8"));
          finish(() => res(parsed));
        } catch (err) {
          finish(() => rej(err));
        }
      }
    });
  });
}
function readDaemonInfo() {
  if (!existsSync3(DAEMON_INFO_PATH)) return null;
  try {
    const raw = readFileSync2(DAEMON_INFO_PATH, "utf-8");
    const obj = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null || typeof obj.pid !== "number" || typeof obj.port !== "number" || typeof obj.started_at !== "number" || typeof obj.model !== "string" || typeof obj.dim !== "number") {
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}
function isDaemonAlive(info) {
  if (info.pid <= 0) return false;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "EPERM") return true;
    return false;
  }
}
async function pingDaemon(info, timeoutMs = DEFAULT_PING_TIMEOUT_MS) {
  return new Promise((res) => {
    const sock = new net.Socket();
    let settled = false;
    const cleanup = (val) => {
      if (settled) return;
      settled = true;
      try {
        sock.setTimeout(0);
        sock.destroy();
      } catch {
      }
      res(val);
    };
    const connectTimer = setTimeout(() => cleanup(null), timeoutMs);
    sock.once("error", () => {
      clearTimeout(connectTimer);
      cleanup(null);
    });
    sock.connect(info.port, "127.0.0.1", () => {
      clearTimeout(connectTimer);
      try {
        sock.setNoDelay(true);
      } catch {
      }
      try {
        sendFrame(sock, { cmd: "ping" });
      } catch {
        cleanup(null);
        return;
      }
      recvFrame(sock, timeoutMs).then((reply) => {
        if (reply && typeof reply === "object" && typeof reply.ok === "boolean" && typeof reply.ready === "boolean") {
          cleanup(reply);
        } else {
          cleanup(null);
        }
      }).catch(() => cleanup(null));
    });
  });
}
async function isDaemonReady() {
  const info = readDaemonInfo();
  if (!info) return false;
  if (!isDaemonAlive(info)) return false;
  if (info.model !== EXPECTED_MODEL || info.dim !== EXPECTED_DIM) return false;
  const reply = await pingDaemon(info);
  if (!reply) return false;
  if (!reply.ok || !reply.ready) return false;
  if (reply.model && reply.model !== EXPECTED_MODEL) return false;
  if (reply.dim && reply.dim !== EXPECTED_DIM) return false;
  return true;
}
function resolveRepoRoot() {
  const envDir = process.env.CLAUDE_PROJECT_DIR;
  if (envDir && existsSync3(join3(envDir, "opc"))) {
    return resolve(envDir);
  }
  try {
    const entry = process.argv[1];
    if (entry) {
      let dir = resolve(entry);
      for (let i = 0; i < 10; i++) {
        const parent = resolve(dir, "..");
        if (parent === dir) break;
        dir = parent;
        if (existsSync3(join3(dir, "opc", "scripts", "core", "embedding_daemon.py"))) {
          return dir;
        }
      }
    }
  } catch {
  }
  return null;
}
var _spawnAttempted = false;
function ensureDaemonRunning() {
  if (_spawnAttempted) return;
  _spawnAttempted = true;
  const info = readDaemonInfo();
  if (info && isDaemonAlive(info)) return;
  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error(
      "[embedding-client] cannot locate repo root; daemon will not be spawned"
    );
    return;
  }
  try {
    const child = spawn(
      "uv",
      ["run", "--project", "opc", "python", "opc/scripts/core/embedding_daemon.py", "--daemon"],
      {
        cwd: repoRoot,
        detached: true,
        stdio: "ignore",
        // shell: true is needed on Windows for `uv` (a .exe shim) to
        // resolve via PATH from a detached spawn -- without it, ENOENT.
        shell: process.platform === "win32"
      }
    );
    child.on("error", (err) => {
      console.error(
        `[embedding-client] daemon spawn error: ${err.message ?? err}`
      );
    });
    child.unref();
  } catch (err) {
    console.error(
      `[embedding-client] daemon spawn failed: ${err?.message ?? err}`
    );
  }
}

// src/memory-awareness.ts
var PROACTIVE_INJECTION_FLOOR = 0.05;
var LOCAL_SCORE_NORMALIZE = 0.1;
function readStdin() {
  return readFileSync3(0, "utf-8");
}
function expandGitQuery(prompt) {
  const lower = prompt.toLowerCase().trim();
  const gitExpansions = {
    "push": "git push remote fork origin upstream",
    "git push": "git push remote fork origin upstream",
    "commit": "git commit message workflow",
    "git commit": "git commit message workflow",
    "pr": "pull request pr create review",
    "create pr": "pull request pr create github",
    "pull request": "pull request pr create github",
    "merge": "git merge branch main",
    "rebase": "git rebase branch workflow",
    "checkout": "git checkout branch switch",
    "branch": "git branch create switch",
    "stash": "git stash save pop",
    "reset": "git reset hard soft",
    "force push": "git push force dangerous"
  };
  for (const [pattern, expansion] of Object.entries(gitExpansions)) {
    if (lower === pattern || lower.startsWith(pattern + " ") || lower.endsWith(" " + pattern)) {
      return expansion;
    }
  }
  const gitKeywords = ["git", "push", "commit", "pr", "merge", "rebase", "branch"];
  const hasGitContext = gitKeywords.some((kw) => lower.includes(kw));
  if (hasGitContext) {
    return prompt + " git remote workflow";
  }
  return null;
}
function checkLocalMemory(intent, projectDir) {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const projectMemoryScript = path.join(homeDir, ".claude", "scripts", "core", "project_memory.py");
  if (!existsSync4(projectMemoryScript)) return [];
  try {
    const result = spawnSync("uv", [
      "run",
      "python",
      projectMemoryScript,
      "query",
      intent,
      "--project-dir",
      projectDir,
      "-k",
      "3",
      "--json"
    ], {
      encoding: "utf-8",
      cwd: path.join(homeDir, ".claude", "scripts", "core"),
      timeout: 2e3,
      killSignal: "SIGKILL"
    });
    if (result.status !== 0 || !result.stdout) return [];
    const data = JSON.parse(result.stdout);
    if (!data.results || data.results.length === 0) return [];
    return data.results.slice(0, 3).map((r) => ({
      id: r.task_id || r.id || "local",
      type: "LOCAL_HANDOFF",
      content: r.summary || r.content || "",
      // Normalize local similarity (~0.5) into ts_rank range so the merge
      // sort/floor doesn't unfairly favor local rows.
      score: (r.similarity || 0.5) * LOCAL_SCORE_NORMALIZE
    }));
  } catch {
    return [];
  }
}
function checkDbMemory(intent, _projectDir, useHybrid) {
  const opcDir = getOpcDir();
  if (!opcDir) return [];
  const searchTerm = intent.replace(/[_\/]/g, " ").replace(/\b\w{1,2}\b/g, "").replace(/\s+/g, " ").trim();
  const args = [
    "run",
    "python",
    "scripts/core/recall_learnings.py",
    "--query",
    searchTerm,
    "--k",
    "3",
    "--json"
  ];
  if (!useHybrid) {
    args.push("--text-only");
  }
  const result = spawnSync("uv", args, {
    encoding: "utf-8",
    cwd: opcDir,
    env: {
      ...process.env,
      PYTHONPATH: opcDir
    },
    timeout: 2e3,
    killSignal: "SIGKILL"
  });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }
  try {
    const data = JSON.parse(result.stdout);
    if (!data.results || data.results.length === 0) {
      return [];
    }
    return (data.results || []).map((r) => {
      const content = r.content || "";
      const preview = content.split("\n").filter((l) => l.trim().length > 0).map((l) => l.trim()).join(" ").slice(0, 120);
      return {
        id: (r.id || "unknown").slice(0, 8),
        type: r.learning_type || r.type || "UNKNOWN",
        content: preview + (content.length > 120 ? "..." : ""),
        score: r.score || 0
      };
    });
  } catch {
    return [];
  }
}
function mergeResults(local, db) {
  if ((!local || local.length === 0) && (!db || db.length === 0)) {
    return null;
  }
  const localTagged = (local || []).map((r) => ({ ...r, __src: "local" }));
  const dbTagged = (db || []).map((r) => ({ ...r, __src: "db" }));
  const combined = [...localTagged, ...dbTagged];
  const byId = /* @__PURE__ */ new Map();
  for (const row of combined) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, { row, crossed: false });
    } else {
      const crossed = existing.crossed || existing.row.__src !== row.__src;
      const winner = row.score > existing.row.score ? row : existing.row;
      byId.set(row.id, { row: winner, crossed });
    }
  }
  const deduped = Array.from(byId.values());
  deduped.sort((a, b) => b.row.score - a.row.score);
  const top = deduped.slice(0, 3);
  if (top.length === 0) return null;
  const sources = /* @__PURE__ */ new Set();
  for (const t of top) {
    sources.add(t.row.__src);
    if (t.crossed) sources.add("merged");
  }
  const source = sources.has("merged") || sources.size > 1 ? "merged" : sources.has("local") ? "local" : "db";
  const cleaned = top.map(({ row }) => ({
    id: row.id,
    type: row.type,
    content: row.content,
    score: row.score
  }));
  return {
    count: deduped.length,
    results: cleaned,
    source
  };
}
function applyFloor(match) {
  if (!match) return null;
  const filtered = match.results.filter((r) => (r.score ?? 0) >= PROACTIVE_INJECTION_FLOOR);
  if (filtered.length === 0) return null;
  return {
    count: filtered.length,
    results: filtered,
    source: match.source
  };
}
function getRecallLogPath(projectDir) {
  const dir = path.join(projectDir, ".claude", "logs");
  try {
    mkdirSync2(dir, { recursive: true });
  } catch {
  }
  return path.join(dir, "memory-recall.jsonl");
}
function logRecallFire(entry, projectDir) {
  try {
    appendFileSync(getRecallLogPath(projectDir), JSON.stringify(entry) + "\n");
  } catch {
  }
}
async function main() {
  const t0 = Date.now();
  const input = JSON.parse(readStdin());
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd;
  if (process.env.CLAUDE_AGENT_ID) {
    outputContinue();
    return;
  }
  if (input.prompt.length < 15) {
    outputContinue();
    return;
  }
  if (input.prompt.trim().startsWith("/")) {
    outputContinue();
    return;
  }
  const gitExpanded = expandGitQuery(input.prompt);
  const intent = gitExpanded || extractIntent(input.prompt);
  if (intent.length < 3) {
    outputContinue();
    return;
  }
  let daemonReady = false;
  try {
    daemonReady = await isDaemonReady();
  } catch {
    daemonReady = false;
  }
  const mode = daemonReady ? "hybrid" : "text-only";
  if (!daemonReady) {
    try {
      ensureDaemonRunning();
    } catch {
    }
  }
  const local = checkLocalMemory(intent, projectDir);
  const db = checkDbMemory(intent, projectDir, daemonReady);
  const mergedRaw = mergeResults(local, db);
  const match = applyFloor(mergedRaw);
  const topScoreRaw = mergedRaw && mergedRaw.results.length > 0 ? mergedRaw.results.reduce((m, r) => Math.max(m, r.score ?? 0), 0) : 0;
  const logEntry = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    session_id: input.session_id || "unknown",
    subagent: process.env.CLAUDE_AGENT_ID || null,
    intent,
    results_count: mergedRaw ? mergedRaw.count : 0,
    top_score: topScoreRaw,
    kept_after_floor: match ? match.results.length : 0,
    source: match ? match.source : mergedRaw ? mergedRaw.source : "empty",
    mode,
    daemon_ready: daemonReady,
    total_elapsed_ms: Date.now() - t0
  };
  logRecallFire(logEntry, projectDir);
  if (match) {
    try {
      logHook(input.session_id, "memory-awareness");
    } catch {
    }
    const resultLines = match.results.map(
      (r, i) => `${i + 1}. [${r.type}] ${r.content} (id: ${r.id})`
    ).join("\n");
    const claudeContext = `MEMORY MATCH (${match.count} results) for "${intent}":
${resultLines}
Use /recall "${intent}" for full content. Disclose if helpful.`;
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: claudeContext
      }
    }));
  } else {
    outputContinue();
  }
}
main().catch(() => {
  outputContinue();
});
export {
  LOCAL_SCORE_NORMALIZE,
  PROACTIVE_INJECTION_FLOOR,
  applyFloor,
  extractIntent,
  extractKeywords,
  mergeResults
};
