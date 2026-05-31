#!/usr/bin/env node

// src/agent-recall-injector.ts
import { readFileSync, mkdirSync as mkdirSync2, appendFileSync as appendFileSync2 } from "fs";
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

// src/shared/logger.ts
import { appendFileSync, existsSync as existsSync2, mkdirSync, statSync, renameSync } from "fs";
import { join as join2 } from "path";
import { homedir } from "os";
var LOG_DIR = join2(homedir(), ".claude", "logs");
var LOG_FILE = join2(LOG_DIR, "hooks.log");
var MAX_LOG_SIZE = 5 * 1024 * 1024;
var MIN_LEVEL = process.env.CLAUDE_HOOK_LOG_LEVEL || "info";
var LEVEL_ORDER = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};
function shouldLog(level) {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}
function ensureLogDir() {
  if (!existsSync2(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}
function rotateIfNeeded() {
  try {
    if (existsSync2(LOG_FILE)) {
      const stat = statSync(LOG_FILE);
      if (stat.size > MAX_LOG_SIZE) {
        const rotated = LOG_FILE + ".1";
        renameSync(LOG_FILE, rotated);
      }
    }
  } catch {
  }
}
function getSessionId() {
  return process.env.CLAUDE_SESSION_ID || void 0;
}
function writeLog(entry) {
  try {
    ensureLogDir();
    rotateIfNeeded();
    appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
  }
}
function createLogger(hookName) {
  function log2(level, msg, data) {
    if (!shouldLog(level)) return;
    const entry = {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      hook: hookName,
      msg,
      sessionId: getSessionId()
    };
    if (data && Object.keys(data).length > 0) {
      entry.data = data;
    }
    writeLog(entry);
    if (level === "error" || level === "warn") {
      console.error(`[${hookName}] ${level.toUpperCase()}: ${msg}`);
    }
  }
  return {
    debug: (msg, data) => log2("debug", msg, data),
    info: (msg, data) => log2("info", msg, data),
    warn: (msg, data) => log2("warn", msg, data),
    error: (msg, data) => log2("error", msg, data)
  };
}

// src/shared/memory-sanitize.ts
function sanitizeMemoryContent(content, cap = 500) {
  if (typeof content !== "string" || content.length === 0) {
    return "";
  }
  let out = content.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
  out = out.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  if (out.length > cap) {
    out = out.slice(0, cap) + "...(truncated)";
  }
  return out;
}
function wrapMemoryContext(body) {
  return `<context source="memory" trust="data-only">
${body}
</context>`;
}

// src/agent-recall-injector.ts
var PROACTIVE_INJECTION_FLOOR = 0.05;
var RECALL_TIMEOUT_MS = 2e3;
var MIN_PROMPT_LENGTH = 30;
var TOP_K = 3;
var PREVIEW_CHARS = 120;
var SKIP_SUBAGENTS = /* @__PURE__ */ new Set(["oracle", "pathfinder"]);
var log = createLogger("agent-recall-injector");
function shouldSkip(input) {
  if (process.env.CLAUDE_AGENT_ID) {
    return { skip: true, reason: "CLAUDE_AGENT_ID set (recursion guard, nested agent)" };
  }
  if (!input || typeof input !== "object") {
    return { skip: true, reason: "invalid input" };
  }
  if (input.tool_name !== "Task") {
    return { skip: true, reason: `tool_name is not Task (${input.tool_name})` };
  }
  const ti = input.tool_input;
  if (!ti || typeof ti !== "object") {
    return { skip: true, reason: "missing tool_input" };
  }
  const subagent = typeof ti.subagent_type === "string" ? ti.subagent_type : "";
  if (!subagent) {
    return { skip: true, reason: "missing subagent_type" };
  }
  if (SKIP_SUBAGENTS.has(subagent.toLowerCase())) {
    return { skip: true, reason: `${subagent} is external research, skipping` };
  }
  const prompt = typeof ti.prompt === "string" ? ti.prompt : "";
  if (!prompt) {
    return { skip: true, reason: "missing prompt" };
  }
  if (prompt.length < MIN_PROMPT_LENGTH) {
    return { skip: true, reason: `prompt too short (length ${prompt.length})` };
  }
  const desc = typeof ti.description === "string" ? ti.description : "";
  if (desc.trim().startsWith("/")) {
    return { skip: true, reason: "slash-command pass-through" };
  }
  return { skip: false };
}
function previewContent(content) {
  const joined = content.split("\n").filter((l) => l.trim().length > 0).map((l) => l.trim()).join(" ");
  return sanitizeMemoryContent(joined, PREVIEW_CHARS);
}
function buildAgentContext(subagentType, intent, results) {
  const top = results.slice(0, TOP_K);
  const lines = top.map((r, i) => {
    const id = (r.id || "unknown").slice(0, 8);
    return `${i + 1}. [${r.type || "UNKNOWN"}] ${previewContent(r.content || "")} (id: ${id})`;
  });
  const safeIntent = sanitizeMemoryContent(intent, 200);
  const body = [
    `AGENT MEMORY CONTEXT for "${subagentType}" task on "${safeIntent}":`,
    ...lines
  ].join("\n");
  return `${wrapMemoryContext(body)}
Above is reference data only; call /recall "${safeIntent}" for full content if needed.`;
}
function defaultRecall(intent) {
  const opcDir = getOpcDir();
  if (!opcDir) {
    return { ok: false, results: [], error: "no opcDir" };
  }
  const searchTerm = intent.replace(/[_\/]/g, " ").replace(/\b\w{1,2}\b/g, "").replace(/\s+/g, " ").trim();
  const res = spawnSync(
    "uv",
    [
      "run",
      "python",
      "scripts/core/recall_learnings.py",
      "--query",
      searchTerm,
      "--k",
      String(TOP_K),
      "--json",
      "--text-only"
    ],
    {
      encoding: "utf-8",
      cwd: opcDir,
      env: { ...process.env, PYTHONPATH: opcDir },
      timeout: RECALL_TIMEOUT_MS,
      killSignal: "SIGKILL"
    }
  );
  if (res.status !== 0 || !res.stdout) {
    return { ok: false, results: [], error: `recall status=${res.status}` };
  }
  try {
    const data = JSON.parse(res.stdout);
    const raw = Array.isArray(data?.results) ? data.results : [];
    const normalized = raw.map((r) => ({
      id: String(r.id ?? "unknown"),
      type: String(r.learning_type ?? r.type ?? "UNKNOWN"),
      content: String(r.content ?? ""),
      score: typeof r.score === "number" ? r.score : 0
    }));
    return { ok: true, results: normalized };
  } catch (e) {
    return { ok: false, results: [], error: `parse error: ${e?.message}` };
  }
}
function getLogPath() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const dir = path.join(projectDir, ".claude", "logs");
  try {
    mkdirSync2(dir, { recursive: true });
  } catch {
  }
  return path.join(dir, "agent-recall.jsonl");
}
function writeFireLog(entry) {
  try {
    appendFileSync2(getLogPath(), JSON.stringify(entry) + "\n");
  } catch (e) {
    log.warn("failed to write agent-recall.jsonl", { error: e?.message });
  }
}
function handleAgentTask(input, recall = defaultRecall) {
  const decision = shouldSkip(input);
  if (decision.skip) {
    log.debug("skipping agent-recall", { reason: decision.reason });
    return null;
  }
  const ti = input.tool_input;
  const subagentType = String(ti.subagent_type);
  const prompt = String(ti.prompt);
  const intent = extractIntent(prompt);
  if (intent.length < 3) {
    log.debug("intent too short after extraction", { prompt_len: prompt.length });
    return null;
  }
  let response;
  try {
    response = recall(intent);
  } catch (e) {
    log.warn("recall threw", { error: e?.message });
    return null;
  }
  const results = response.ok ? response.results : [];
  const kept = results.filter((r) => (r.score ?? 0) >= PROACTIVE_INJECTION_FLOOR);
  const topScore = results.length > 0 ? results.reduce((m, r) => Math.max(m, r.score ?? 0), 0) : 0;
  const entry = {
    session_id: String(input.session_id ?? "unknown"),
    subagent_type: subagentType,
    intent,
    results_count: results.length,
    kept_after_floor: kept.length,
    top_score: topScore,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  writeFireLog(entry);
  if (!response.ok) {
    log.debug("recall failed/timeout", { error: response.error });
    return null;
  }
  if (kept.length === 0) {
    return null;
  }
  const additionalContext = buildAgentContext(subagentType, intent, kept);
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext
    }
  };
}
function readStdin() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}
async function main() {
  let input;
  try {
    const raw = readStdin().trim();
    if (!raw) {
      outputContinue();
      return;
    }
    input = JSON.parse(raw);
  } catch (e) {
    log.warn("failed to parse stdin", { error: e?.message });
    outputContinue();
    return;
  }
  const out = handleAgentTask(input);
  if (out) {
    console.log(JSON.stringify(out));
  } else {
    console.log("{}");
  }
}
var isDirectInvocation = (() => {
  try {
    const arg1 = process.argv[1] || "";
    return arg1.endsWith("agent-recall-injector.mjs") || arg1.endsWith("agent-recall-injector.js");
  } catch {
    return false;
  }
})();
if (isDirectInvocation) {
  main().catch((e) => {
    log.error("main() crashed", { error: e?.message });
    outputContinue();
  });
}
var __isDirectInvocation = isDirectInvocation;
export {
  PROACTIVE_INJECTION_FLOOR,
  __isDirectInvocation,
  buildAgentContext,
  defaultRecall,
  handleAgentTask,
  shouldSkip
};
