#!/usr/bin/env node
/**
 * sync-architecture-stats.mjs
 *
 * Recounts hooks (.claude/hooks/src/*.ts) and agents (.claude/agents/*.md),
 * then patches the live counts into:
 *   - docs/architecture/system-visualization/architecture.json
 *   - docs/architecture/system-visualization/index.html (inlined JSON copy)
 *
 * Fields updated (both files, keep in sync):
 *   - nodes[id=hooks].stats.totalHooks  (integer, e.g. 107)
 *   - nodes[id=agents].stats.totalAgents (integer, e.g. 39)
 *
 * Usage:
 *   node scripts/sync-architecture-stats.mjs            # dry-run (no writes)
 *   node scripts/sync-architecture-stats.mjs --apply    # write changes
 *   node scripts/sync-architecture-stats.mjs --verbose  # show details
 *
 * Idempotent: re-running with --apply when counts already match writes nothing
 * and exits cleanly with "no changes" message.
 *
 * Exit codes:
 *   0 = success (or dry-run with no errors)
 *   1 = error (missing files, parse failure, write failure)
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

// --- CLI args ---
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const VERBOSE = args.includes("--verbose") || args.includes("-v");

// --- Paths ---
const HOOKS_DIR = join(REPO_ROOT, ".claude", "hooks", "src");
const AGENTS_DIR = join(REPO_ROOT, ".claude", "agents");
const SKILLS_DIR = join(REPO_ROOT, ".claude", "skills");
const SCRIPTS_DIR = join(REPO_ROOT, "scripts");
const ARCH_JSON = join(REPO_ROOT, "docs", "architecture", "system-visualization", "architecture.json");
const ARCH_HTML = join(REPO_ROOT, "docs", "architecture", "system-visualization", "index.html");

// MCP config locations (dedup across all three)
const MCP_PATHS = [
  join(homedir(), ".mcp.json"),
  join(homedir(), ".claude", "mcp.json"),
  join(REPO_ROOT, ".mcp.json"),
];

// --- Helpers ---
function log(msg) {
  process.stdout.write(msg + "\n");
}

function vlog(msg) {
  if (VERBOSE) log(msg);
}

function die(msg, code = 1) {
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(code);
}

/**
 * Count .ts files in a directory, non-recursive (top-level only, like the
 * src/ directory itself — subdirectories like src/shared/ and src/__tests__/
 * are intentionally excluded; hooks must live at src/<name>.ts).
 */
function countFiles(dir, ext) {
  if (!existsSync(dir)) die(`directory not found: ${dir}`);
  const entries = readdirSync(dir);
  return entries.filter((name) => {
    if (!name.endsWith(ext)) return false;
    const full = join(dir, name);
    return statSync(full).isFile();
  }).length;
}

/**
 * Count .claude/skills/ * /SKILL.md files (one level deep).
 */
function countSkills(skillsDir) {
  if (!existsSync(skillsDir)) return 0;
  const entries = readdirSync(skillsDir);
  let count = 0;
  for (const entry of entries) {
    const skillMd = join(skillsDir, entry, "SKILL.md");
    if (existsSync(skillMd) && statSync(skillMd).isFile()) count++;
  }
  return count;
}

/**
 * Count scripts in scripts/ dir by extension (.sh, .mjs, .py, .ps1).
 */
function countScripts(scriptsDir) {
  if (!existsSync(scriptsDir)) return 0;
  const exts = [".sh", ".mjs", ".py", ".ps1"];
  const entries = readdirSync(scriptsDir);
  return entries.filter((name) => {
    if (!exts.some((e) => name.endsWith(e))) return false;
    return statSync(join(scriptsDir, name)).isFile();
  }).length;
}

/**
 * Count unique MCP server names across all 3 config files.
 */
function countMcpServers(mcpPaths) {
  const allNames = new Set();
  for (const p of mcpPaths) {
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(readFileSync(p, "utf8"));
      const servers = data.mcpServers || {};
      for (const key of Object.keys(servers)) allNames.add(key);
    } catch (_) {
      // skip malformed files
    }
  }
  return allNames.size;
}

/**
 * Get today's date as YYYY-MM-DD using local wall clock.
 */
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Get the ISO 8601 commit timestamp of HEAD via git log.
 * Returns empty string on failure.
 */
function gitHeadCommit() {
  const result = spawnSync("git", ["log", "-1", "--format=%cI", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0 || result.error) return "";
  return (result.stdout || "").trim();
}

/**
 * Update architecture.json (parsed JSON, then re-serialized).
 * Returns { changed: boolean, before: {hooks, agents}, after: {hooks, agents} }.
 */
function updateJson(filePath, newHookCount, newAgentCount, newMetaStats, today, lastCommit) {
  const raw = readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data.nodes)) {
    die(`${filePath}: expected top-level 'nodes' array`);
  }

  const hooksNode = data.nodes.find((n) => n.id === "hooks");
  const agentsNode = data.nodes.find((n) => n.id === "agents");

  if (!hooksNode) die(`${filePath}: no node with id='hooks'`);
  if (!agentsNode) die(`${filePath}: no node with id='agents'`);
  if (!hooksNode.stats) hooksNode.stats = {};
  if (!agentsNode.stats) agentsNode.stats = {};

  const before = {
    hooks: hooksNode.stats.totalHooks,
    agents: agentsNode.stats.totalAgents,
    lastVerified: data.meta && data.meta.lastVerified,
    lastCommit: data.meta && data.meta.lastCommit,
    metaStats: data.meta && data.meta.stats ? JSON.stringify(data.meta.stats) : undefined,
  };

  hooksNode.stats.totalHooks = newHookCount;
  agentsNode.stats.totalAgents = newAgentCount;

  // Update meta fields
  if (!data.meta) data.meta = {};
  data.meta.lastVerified = today;
  if (lastCommit) data.meta.lastCommit = lastCommit;
  data.meta.stats = newMetaStats;

  const after = {
    hooks: hooksNode.stats.totalHooks,
    agents: agentsNode.stats.totalAgents,
    lastVerified: data.meta.lastVerified,
    lastCommit: data.meta.lastCommit,
    metaStats: JSON.stringify(data.meta.stats),
  };

  // Preserve trailing newline if present in source.
  const trailing = raw.endsWith("\n") ? "\n" : "";
  const serialized = JSON.stringify(data, null, 2) + trailing;
  const changed = serialized !== raw;

  if (changed && APPLY) {
    writeFileSync(filePath, serialized, "utf8");
  }

  return { changed, before, after, serialized };
}

/**
 * Update index.html (string replace inside the inlined JSON literals).
 *
 * The HTML contains two specific stats lines that must match what's in
 * architecture.json:
 *   "stats": { "totalHooks": <V>, "events": 7, "blockingHooks": 5 }
 *   "stats": { "totalAgents": <V>, "categories": 8 }
 *
 * Strategy: regex-target only the totalHooks: and totalAgents: integer values
 * inside the stats object, leaving everything else untouched. Both can appear
 * with either int or string values (e.g. "90+") so the pattern accepts both.
 */
function updateHtml(filePath, newHookCount, newAgentCount) {
  if (!existsSync(filePath)) die(`file not found: ${filePath}`);
  const raw = readFileSync(filePath, "utf8");

  // Match `"totalHooks": <int-or-string>` and replace with `"totalHooks": <int>`.
  // Value pattern: either a quoted string ("90+") or an integer (107).
  const hooksRe = /("totalHooks"\s*:\s*)(?:"[^"]*"|\d+)/g;
  const agentsRe = /("totalAgents"\s*:\s*)(?:"[^"]*"|\d+)/g;

  let hooksMatches = 0;
  let agentsMatches = 0;
  const beforeHookValues = [];
  const beforeAgentValues = [];

  let updated = raw.replace(hooksRe, (_m, prefix) => {
    hooksMatches += 1;
    // capture original value for verbose log
    const orig = _m.slice(prefix.length);
    beforeHookValues.push(orig);
    return `${prefix}${newHookCount}`;
  });

  updated = updated.replace(agentsRe, (_m, prefix) => {
    agentsMatches += 1;
    const orig = _m.slice(prefix.length);
    beforeAgentValues.push(orig);
    return `${prefix}${newAgentCount}`;
  });

  if (hooksMatches === 0) die(`${filePath}: no 'totalHooks' field found`);
  if (agentsMatches === 0) die(`${filePath}: no 'totalAgents' field found`);

  const changed = updated !== raw;

  if (changed && APPLY) {
    writeFileSync(filePath, updated, "utf8");
  }

  return {
    changed,
    hooksMatches,
    agentsMatches,
    beforeHookValues,
    beforeAgentValues,
  };
}

// --- Main ---
function main() {
  const hookCount = countFiles(HOOKS_DIR, ".ts");
  const agentCount = countFiles(AGENTS_DIR, ".md");
  const skillCount = countSkills(SKILLS_DIR);
  const mcpCount = countMcpServers(MCP_PATHS);
  const scriptCount = countScripts(SCRIPTS_DIR);
  const today = todayIso();
  const lastCommit = gitHeadCommit();

  const newMetaStats = {
    totalHooks: hookCount,
    totalAgents: agentCount,
    totalSkills: skillCount,
    mcpServers: mcpCount,
    scripts: scriptCount,
  };

  log(`mode:        ${APPLY ? "APPLY (writing changes)" : "DRY-RUN (no writes; pass --apply to write)"}`);
  log(`hooks dir:   ${HOOKS_DIR}`);
  log(`agents dir:  ${AGENTS_DIR}`);
  log(`skills dir:  ${SKILLS_DIR}`);
  log(`scripts dir: ${SCRIPTS_DIR}`);
  log(`hook count:  ${hookCount} (.ts files)`);
  log(`agent count: ${agentCount} (.md files)`);
  log(`skill count: ${skillCount} (SKILL.md files)`);
  log(`mcp servers: ${mcpCount} (unique across 3 config files)`);
  log(`script count: ${scriptCount} (.sh/.mjs/.py/.ps1 files)`);
  log(`today:       ${today}`);
  log(`lastCommit:  ${lastCommit || "(git unavailable)"}`);
  log("");

  // architecture.json
  log(`-- ${ARCH_JSON}`);
  const jsonResult = updateJson(ARCH_JSON, hookCount, agentCount, newMetaStats, today, lastCommit);
  log(`   before: totalHooks=${JSON.stringify(jsonResult.before.hooks)}, totalAgents=${JSON.stringify(jsonResult.before.agents)}`);
  log(`   after:  totalHooks=${jsonResult.after.hooks}, totalAgents=${jsonResult.after.agents}`);
  log(`   before lastVerified: ${JSON.stringify(jsonResult.before.lastVerified)}`);
  log(`   after  lastVerified: ${jsonResult.after.lastVerified}`);
  log(`   before meta.stats: ${jsonResult.before.metaStats || "(none)"}`);
  log(`   after  meta.stats: ${jsonResult.after.metaStats}`);
  log(`   ${jsonResult.changed ? (APPLY ? "WROTE changes" : "would change (dry-run)") : "no changes"}`);

  // index.html
  log("");
  log(`-- ${ARCH_HTML}`);
  const htmlResult = updateHtml(ARCH_HTML, hookCount, agentCount);
  log(`   totalHooks matches:  ${htmlResult.hooksMatches} (originals: ${htmlResult.beforeHookValues.join(", ")})`);
  log(`   totalAgents matches: ${htmlResult.agentsMatches} (originals: ${htmlResult.beforeAgentValues.join(", ")})`);
  log(`   ${htmlResult.changed ? (APPLY ? "WROTE changes" : "would change (dry-run)") : "no changes"}`);

  log("");
  if (jsonResult.changed || htmlResult.changed) {
    if (APPLY) {
      log("done: stats synced.");
    } else {
      log("done: dry-run only; re-run with --apply to write.");
    }
  } else {
    log("done: stats already in sync, nothing to do.");
  }
}

main();
