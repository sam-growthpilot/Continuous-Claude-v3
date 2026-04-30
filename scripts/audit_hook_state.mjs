#!/usr/bin/env node
// Read-only classifier for the hook landscape.
//
// For every .mjs in .claude/hooks/dist/ and every .ts in .claude/hooks/src/
// (excluding shared/, __tests__/, _archived/, lib/), classify into one of:
//
//   LIVE              registered + has source           -- runs as designed
//   STUB-NEEDED-LATER registered + NO source            -- placeholder (sentry, linear)
//   ZOMBIE            NOT registered + NO source        -- orphan dist .mjs, deletable
//   SOURCE-ONLY       has source + NOT registered + NOT imported by other src
//   LIB               has source + NOT registered + IMPORTED by other src (-> Phase 3 src/lib/)
//   UNCERTAIN         anything that doesn't fit cleanly
//
// Outputs JSON to stdout. Pure read; touches no source.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const REPO = process.env.REPO || join(HOME, "continuous-claude");
const ACTIVE = process.env.ACTIVE || join(HOME, ".claude");

const SRC_DIR = join(REPO, ".claude/hooks/src");
const DIST_DIR = join(REPO, ".claude/hooks/dist");
const SETTINGS = join(ACTIVE, "settings.json");

const EXCLUDE_SRC_DIRS = new Set(["shared", "__tests__", "_archived", "lib"]);

function listDirSafe(p) {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

function listMjs(dir) {
  return listDirSafe(dir)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => basename(f, ".mjs"));
}

function listTs(dir) {
  const out = [];
  for (const entry of listDirSafe(dir)) {
    const p = join(dir, entry);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (EXCLUDE_SRC_DIRS.has(entry)) continue;
      // We only want top-level hooks; subdirs (shared/, lib/, _archived/) are
      // excluded above. Don't recurse into other subdirs either.
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(basename(entry, ".ts"));
    }
  }
  return out;
}

function readSettings() {
  // Tolerate a missing or unreadable settings.json so this audit script can
  // still emit JSON on a fresh checkout (no ~/.claude yet) or in CI where
  // there is no active Claude config. Treat parse errors the same way —
  // an empty hook map is the right default and the rest of the audit will
  // simply report "no registered hooks".
  try {
    const raw = readFileSync(SETTINGS, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.name === "SyntaxError")) {
      return { hooks: {} };
    }
    throw err;
  }
}

function collectRegisteredHookNames(settings) {
  const names = new Set();
  function walk(o) {
    if (Array.isArray(o)) {
      o.forEach(walk);
      return;
    }
    if (o && typeof o === "object") {
      if (o.command && typeof o.command === "string") {
        // Accept dist/<name>.mjs from anywhere; tolerate `~/.claude/`, `C:/.../.claude/`,
        // forward or back slashes.
        const m = o.command.match(/dist[/\\]([a-zA-Z0-9._-]+)\.mjs/);
        if (m) names.add(m[1]);
      }
      Object.values(o).forEach(walk);
    }
  }
  walk(settings.hooks || {});
  return names;
}

function buildImportIndex() {
  // For every .ts in src/ (top-level hooks + shared/), record what it imports.
  // We then invert: for each candidate hook name, who imports it?
  const importsByName = new Map(); // name -> Set<importer-name>
  function recordIfRelative(name, spec, importer) {
    // Strip "./" / "../" + optional ".js"/".ts" suffix
    let bare = spec.replace(/^\.\.?[\\/]+/, "");
    bare = bare.replace(/\.(?:js|mjs|ts)$/, "");
    // Take final path segment as the imported module name.
    const seg = bare.split(/[\\/]+/).pop();
    if (!seg) return;
    if (!importsByName.has(seg)) importsByName.set(seg, new Set());
    importsByName.get(seg).add(importer);
  }
  function scan(dir, importerPrefix = "") {
    for (const entry of listDirSafe(dir)) {
      const p = join(dir, entry);
      let s;
      try {
        s = statSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        if (entry === "__tests__") continue;
        scan(p, (importerPrefix ? importerPrefix + "/" : "") + entry);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
      const importer = (importerPrefix ? importerPrefix + "/" : "") + basename(entry, ".ts");
      const txt = readFileSync(p, "utf8");
      const re = /(?:^|\n)\s*(?:import|export)\s+[^;]*?from\s+["']([^"']+)["']/g;
      let m;
      while ((m = re.exec(txt))) {
        const spec = m[1];
        if (spec.startsWith(".")) recordIfRelative(undefined, spec, importer);
      }
      const re2 = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
      while ((m = re2.exec(txt))) {
        const spec = m[1];
        if (spec.startsWith(".")) recordIfRelative(undefined, spec, importer);
      }
    }
  }
  scan(SRC_DIR);
  return importsByName;
}

function classify({ distMjs, srcTs, registered, importsByName }) {
  // Union of the two lists -- we want to surface SOURCE-ONLY (has src, no dist) too.
  const all = new Set([...distMjs, ...srcTs]);
  const rows = [];
  for (const name of [...all].sort()) {
    const hasDist = distMjs.includes(name);
    const hasSrc = srcTs.includes(name);
    const isRegistered = registered.has(name);
    const importers = importsByName.get(name) || new Set();
    // Importers that are themselves hooks shouldn't count themselves.
    // Compare full importer keys, not just basenames. Stripping the
    // directory prefix collapses distinct paths like `nested/foo` and `foo`
    // and would treat a real importer as a self-import, undercounting
    // valid importers and misclassifying LIB hooks as SOURCE-ONLY.
    const importerCount = [...importers].filter((i) => i !== name).length;

    let kind;
    let note = "";
    if (isRegistered && hasSrc) {
      kind = "LIVE";
    } else if (isRegistered && !hasSrc) {
      kind = "STUB-NEEDED-LATER";
      note = "registered placeholder; preserve, document gap";
    } else if (!isRegistered && !hasSrc) {
      kind = "ZOMBIE";
      note = "orphan dist .mjs (no source, not registered)";
    } else if (hasSrc && !isRegistered && importerCount > 0) {
      kind = "LIB";
      note = `imported by ${importerCount} other hook(s) -> src/lib/ in Phase 3`;
    } else if (hasSrc && !isRegistered && importerCount === 0) {
      kind = "SOURCE-ONLY";
      note = "source exists but not wired and not imported";
    } else {
      kind = "UNCERTAIN";
    }
    rows.push({
      name,
      kind,
      hasDist,
      hasSrc,
      registered: isRegistered,
      importers: [...importers],
      importerCount,
      note,
    });
  }
  return rows;
}

function summarize(rows) {
  const counts = {};
  for (const r of rows) counts[r.kind] = (counts[r.kind] || 0) + 1;
  return counts;
}

function main() {
  const distMjs = listMjs(DIST_DIR);
  const srcTs = listTs(SRC_DIR);
  const settings = readSettings();
  const registered = collectRegisteredHookNames(settings);
  const importsByName = buildImportIndex();
  const rows = classify({ distMjs, srcTs, registered, importsByName });
  const summary = summarize(rows);
  const result = {
    generatedAt: new Date().toISOString(),
    paths: { SRC_DIR, DIST_DIR, SETTINGS },
    totals: {
      distMjs: distMjs.length,
      srcTs: srcTs.length,
      registered: registered.size,
    },
    summary,
    rows,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main();
