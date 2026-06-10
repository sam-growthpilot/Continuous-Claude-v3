#!/usr/bin/env node
// code-intel.mjs -- the /code-intel facade (WS-2 Phase B, B.1/B.2).
//
// A stateless Node CLI that routes a code-intelligence query to the right L3 specialist
// per .claude/rules/code-intel-boundaries.md, honestly degrading when a specialist is not
// shell-executable. Modeled on scripts/cdp.mjs (out/ok/fail, JSON to stdout, typed dispatch).
//
// Every response is one JSON object:
//   { success, backend, routing_reason, escalated_from?, result, bus_id?, discovery?, warning? }
// Unknown/ambiguous subcommands -> { success:false, clarify:true, ... , supported:[...] }.
//
// Backends actually executable from a shell (verified):
//   - recall   -> uv run python opc/scripts/core/recall_learnings.py --query Q --k N --json [--text-only]
//   - tldr     -> on PATH; JSON out for cfg/dfg/slice/dead/diagnostics/impact/structure/search
//   - bus      -> read <projectDir>/.claude/cache/session/<bus_id>/context.json directly (read-only)
// NOT executable from a bare shell (routed with fallback / guidance, never crash):
//   - codegraph -> ABSENT (Phase C). who-calls/find-symbol/code-context fall back to TLDR.
//   - ast-grep, Serena -> MCP-only. rename-preview returns the exact guidance invocation.
//
// Bus contract: this facade READS the bus to bias ranking (focus_symbols first) but NEVER
// writes L2 (context.json) -- single-writer rule (hooks only). It DOES append one telemetry
// row per call to .claude/logs/intel-bus.jsonl (the L0 observability log, not L2 state).
// CCV3_BUS_OFF=1 disables both the bus read and the telemetry append.
//
// Usage: node scripts/code-intel.mjs <subcommand> [args...] [--bus <id>] [--k <n>] [--text-only]

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  realpathSync,
  appendFileSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BUS_OFF = process.env.CCV3_BUS_OFF === '1';
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const MAX_LINE_BYTES = 4096;
// Mirror intel-bus.ts MAX_INTEL_BUS_BYTES: rotate the live log to .1 past this size so
// this independent writer cannot grow the file unbounded (cross-model review H3).
const MAX_INTEL_BUS_BYTES = 2_000_000;

// ---------------------------------------------------------------------------
// argv parsing: cmd + positional args, with --bus / --k / --text-only flags.
// ---------------------------------------------------------------------------
function parseArgv(argv) {
  const cmd = argv[2];
  const rest = argv.slice(3);
  const opts = { bus: null, k: 5, textOnly: false };
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--bus') {
      opts.bus = rest[++i] ?? null;
    } else if (a === '--k') {
      const n = parseInt(rest[++i], 10);
      if (Number.isFinite(n) && n > 0) opts.k = n;
    } else if (a === '--text-only') {
      opts.textOnly = true;
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, opts };
}

function out(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

// Build the canonical facade response (always carries backend + routing_reason).
function respond({ backend, routing_reason, result, escalated_from, bus_id, discovery, warning, success = true }) {
  const r = { success, backend, routing_reason, result };
  if (escalated_from !== undefined) r.escalated_from = escalated_from;
  if (bus_id !== undefined) r.bus_id = bus_id;
  if (discovery !== undefined) r.discovery = discovery;
  if (warning !== undefined) r.warning = warning;
  return r;
}

// ---------------------------------------------------------------------------
// Bus id discovery + read (read-only, fail-open). Mirrors session-bus-id.ts:
//   bus_id = sanitizeBusPart(session) + "-" + sha256(realpath(cwd).toLowerCase())[:12]
// Discovery order: --bus arg -> env (COORDINATION_SESSION_ID) -> most-recent context.json.
// ---------------------------------------------------------------------------
function sanitizeBusPart(part) {
  return String(part)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 40);
}

function hashProjectPath(cwd) {
  let resolved;
  try {
    resolved = realpathSync(cwd);
  } catch {
    resolved = cwd;
  }
  return createHash('sha256').update(resolved.toLowerCase()).digest('hex').slice(0, 12);
}

function sessionCacheDir() {
  return join(PROJECT_DIR, '.claude', 'cache', 'session');
}

function busPathFor(busId) {
  return join(sessionCacheDir(), busId, 'context.json');
}

// Returns { busId, path, discovery, exists, warning? } or null when nothing is discoverable.
function discoverBus(busArg) {
  // 1. Explicit --bus wins. Sanitize it first: sanitizeBusPart strips path separators
  //    and collapses dot runs, so a crafted --bus like `../../etc` cannot escape the
  //    session cache dir via path.join (cross-model review M2).
  if (busArg) {
    const safeId = sanitizeBusPart(busArg);
    const p = busPathFor(safeId);
    return { busId: safeId, path: p, discovery: 'arg', exists: existsSync(p) };
  }
  // 2. Env-derived candidate from COORDINATION_SESSION_ID. NOTE: this is a best-effort
  //    approximation of getBusId() (which derives the session signal via getSessionId(),
  //    not the raw env var). When it misses, the most-recent fallback below is the
  //    reliable path (cross-model review M1).
  const coord = process.env.COORDINATION_SESSION_ID;
  if (coord) {
    const candidate = `${sanitizeBusPart(coord)}-${hashProjectPath(PROJECT_DIR)}`;
    const p = busPathFor(candidate);
    if (existsSync(p)) {
      return { busId: candidate, path: p, discovery: 'env', exists: true };
    }
  }
  // 3. Most-recently-modified context.json under the session cache dir.
  const dir = sessionCacheDir();
  if (!existsSync(dir)) return null;
  let candidates = [];
  try {
    candidates = readdirSync(dir)
      .map((name) => ({ name, path: join(dir, name, 'context.json') }))
      .filter((c) => existsSync(c.path))
      .map((c) => ({ ...c, mtime: statSync(c.path).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;
  const top = candidates[0];
  const result = { busId: top.name, path: top.path, discovery: 'most-recent', exists: true };
  if (candidates.length > 1) {
    result.warning = `multiple sessions found (${candidates.length}); used most-recent. Pass --bus <id> to disambiguate.`;
  }
  return result;
}

function readBus(busArg) {
  if (BUS_OFF) return { busId: null, discovery: 'bus-off', focus: { symbols: [], files: [] }, raw: null };
  const found = discoverBus(busArg);
  if (!found || !found.exists) {
    return { busId: found?.busId ?? null, discovery: found?.discovery ?? 'none', focus: { symbols: [], files: [] }, raw: null, warning: found?.warning };
  }
  try {
    const raw = JSON.parse(readFileSync(found.path, 'utf-8'));
    const symbols = Array.isArray(raw.focus_symbols) ? raw.focus_symbols : [];
    const fip = raw.files_in_play || {};
    const files = [...(fip.load_bearing || []), ...(fip.ambient || [])];
    return { busId: found.busId, discovery: found.discovery, focus: { symbols, files }, raw, warning: found.warning };
  } catch {
    // Fail-open: unreadable/corrupt bus -> empty focus, never crash.
    return { busId: found.busId, discovery: found.discovery, focus: { symbols: [], files: [] }, raw: null, warning: found.warning };
  }
}

// Strip CR/LF from every string field (recursing into objects/arrays) so one
// event serializes to exactly one JSONL line. Defense-in-depth for the nested
// corpus_signature object (C.2) and any future nested field.
function stripNewlinesDeepLocal(value) {
  if (typeof value === 'string') return value.replace(/[\r\n]+/g, ' ');
  if (Array.isArray(value)) return value.map(stripNewlinesDeepLocal);
  if (value && typeof value === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = stripNewlinesDeepLocal(v);
    return o;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Telemetry: append ONE intel-bus row per call (L0 log, not L2 state).
// Minimal safe appender: honors CCV3_BUS_OFF, strips newlines (deep), caps line
// size, rotates past the size cap. Writes ONLY allowlisted, NON-content fields:
// for non-codegraph calls the only strings are the fixed facade name, an enum-ish
// specialist/query_type, the discovered bus_id, and a uuid. For codegraph calls
// (C.2) it adds a STRUCTURED subject_id (a signature_hash, NOT the symbol name/path)
// and a corpus_signature (git_head/file_count/ignored_glob_hash -- all fingerprints,
// no raw identifiers). There is therefore still no free-text field that could carry
// a secret or a raw path/symbol, aligning with intel-bus.ts redaction (mitigation #13).
// ---------------------------------------------------------------------------
function appendIntelRow(event) {
  if (BUS_OFF) return;
  try {
    const base = { ts: new Date().toISOString(), schema_version: 1, facade: '/code-intel', ...event };
    // Deep CR/LF strip so one event == one line even with nested objects.
    const stamped = stripNewlinesDeepLocal(base);
    const line = JSON.stringify(stamped) + '\n';
    if (Buffer.byteLength(line, 'utf-8') > MAX_LINE_BYTES) return; // drop oversized (never partial)
    const path = join(PROJECT_DIR, '.claude', 'logs', 'intel-bus.jsonl');
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Size-based single-generation rotation (matches intel-bus.ts maybeRotate). Fail-open.
    try {
      if (existsSync(path) && statSync(path).size >= MAX_INTEL_BUS_BYTES) {
        renameSync(path, `${path}.1`);
      }
    } catch {
      /* rotation is best-effort; still attempt the append */
    }
    appendFileSync(path, line, 'utf-8');
  } catch {
    // Fail-open: telemetry must never break the command.
  }
}

// ---------------------------------------------------------------------------
// Backends.
// ---------------------------------------------------------------------------
function normalizeOpcDir() {
  let opc = process.env.CLAUDE_OPC_DIR;
  if (opc) {
    // Convert a git-bash drive path (/c/Users/...) to a Windows path (C:/Users/...).
    const m = opc.match(/^\/([A-Za-z])\/(.*)$/);
    if (m) opc = `${m[1].toUpperCase()}:/${m[2]}`;
    if (existsSync(opc)) return opc;
  }
  const fallback = join(PROJECT_DIR, 'opc');
  return existsSync(fallback) ? fallback : null;
}

function runRecall(query, { k, textOnly }) {
  const opc = normalizeOpcDir();
  if (!opc) return { ok: false, error: 'CLAUDE_OPC_DIR not found (memory backend unavailable)' };
  const args = ['run', 'python', 'scripts/core/recall_learnings.py', '--query', query, '--k', String(k), '--json'];
  if (textOnly) args.push('--text-only');
  let res;
  try {
    res = spawnSync('uv', args, {
      cwd: opc,
      env: { ...process.env, PYTHONPATH: '.' },
      encoding: 'utf-8',
      timeout: 60000,
      windowsHide: true,
    });
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
  if (res.error) return { ok: false, error: String(res.error.message || res.error) };
  if (res.status !== 0 || !res.stdout) return { ok: false, error: (res.stderr || 'recall failed').trim().slice(0, 500) };
  try {
    const doc = JSON.parse(res.stdout);
    if (doc.error) return { ok: false, error: String(doc.error) };
    return { ok: true, results: Array.isArray(doc.results) ? doc.results : [] };
  } catch {
    return { ok: false, error: 'recall returned non-JSON output' };
  }
}

function runTldr(args) {
  let res;
  try {
    res = spawnSync('tldr', args, { encoding: 'utf-8', timeout: 60000, windowsHide: true });
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
  if (res.error) return { ok: false, error: String(res.error.message || res.error) };
  if (res.status !== 0 || !res.stdout) return { ok: false, error: (res.stderr || 'tldr failed').trim().slice(0, 500) };
  try {
    return { ok: true, data: JSON.parse(res.stdout) };
  } catch {
    // tldr `context` emits text; others emit JSON. Surface raw if not JSON.
    return { ok: true, data: { raw: res.stdout.slice(0, 4000) } };
  }
}

// ---------------------------------------------------------------------------
// codegraph backend (WS-2 Phase C / C.2). @colbymchenry/codegraph@0.9.9, the
// first LIVE L3 specialist. Owns broad symbol FTS + reverse call graph.
//
// HARD platform constraints (from the C.1 Windows contract gate, GREEN -- see
// .claude/rules/windows-platform.md "codegraph Phase C"):
//  - The `.cmd` shim CANNOT be spawnSync'd on modern Node (EINVAL / CVE-2024-27980).
//    We invoke the REAL JS entrypoint (npm-shim.js) via process.execPath with ARRAY
//    args. Never shell:true (that defeats spaced-path safety).
//  - cwd = repo root, and codegraph's own `-p <repoRoot>` is passed, so a nested cwd
//    never indexes the wrong project (mitigation #6).
//  - JSON-parse fail-open; any failure -> { absent:true } -> unchanged TLDR fallback.
//  - Kill-switch order (lazy, every call): CCV3_KILLSWITCH -> CCV3_CODEGRAPH_OFF ->
//    resolved-binary-missing. Any -> absent -> TLDR fallback.
// ---------------------------------------------------------------------------

// Resolve the npm-shim JS entrypoint defensively (C.1 finding #1). NEVER the .cmd.
// Order: CCV3_CODEGRAPH_BIN env -> <hooksDir>/node_modules/.../npm-shim.js -> null.
// Cached per process.
let _codegraphBinResolved = false;
let _codegraphBin = null;
function resolveCodegraphBin() {
  if (_codegraphBinResolved) return _codegraphBin;
  _codegraphBinResolved = true;
  const envBin = process.env.CCV3_CODEGRAPH_BIN;
  if (envBin && existsSync(envBin)) {
    _codegraphBin = envBin;
    return _codegraphBin;
  }
  // <repoRoot>/.claude/hooks/node_modules/@colbymchenry/codegraph/npm-shim.js
  const root = repoRoot();
  const candidate = join(
    root,
    '.claude',
    'hooks',
    'node_modules',
    '@colbymchenry',
    'codegraph',
    'npm-shim.js',
  );
  if (existsSync(candidate)) {
    _codegraphBin = candidate;
    return _codegraphBin;
  }
  _codegraphBin = null; // absent -> TLDR fallback everywhere
  return _codegraphBin;
}

// Repo root, resolved once (mitigation #6). `git rev-parse --show-toplevel` from
// PROJECT_DIR; fall back to PROJECT_DIR if git is unavailable. Cached per process.
let _repoRootResolved = false;
let _repoRoot = null;
function repoRoot() {
  if (_repoRootResolved) return _repoRoot;
  _repoRootResolved = true;
  try {
    const res = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });
    if (res.status === 0 && res.stdout) {
      _repoRoot = res.stdout.trim();
      if (_repoRoot) return _repoRoot;
    }
  } catch {
    /* fall through */
  }
  _repoRoot = PROJECT_DIR;
  return _repoRoot;
}

// Codegraph is "absent" (-> TLDR fallback) when any kill-switch is set or the
// binary cannot be resolved. Checked lazily on EVERY call (mitigation).
function codegraphAbsent() {
  if (process.env.CCV3_KILLSWITCH === '1') return true;
  if (process.env.CCV3_CODEGRAPH_OFF === '1') return true;
  if (!resolveCodegraphBin()) return true;
  return false;
}

// Run a codegraph subcommand. Returns { absent } | { ok:false, error } | { ok:true, data }.
// ALWAYS invokes the JS entrypoint with array args + cwd=repoRoot + windowsHide.
function runCodegraph(args, { json = true } = {}) {
  if (codegraphAbsent()) return { absent: true };
  const bin = resolveCodegraphBin();
  const root = repoRoot();
  let res;
  try {
    res = spawnSync(process.execPath, [bin, ...args], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 60000,
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
  if (res.error) return { ok: false, error: String(res.error.message || res.error) };
  if (res.status !== 0) {
    return { ok: false, error: (res.stderr || `codegraph ${args[0]} exited ${res.status}`).trim().slice(0, 500) };
  }
  if (!json) return { ok: true, data: res.stdout };
  try {
    return { ok: true, data: JSON.parse(res.stdout) };
  } catch {
    // JSON-parse fail-open: surface as a soft error so callers degrade to TLDR.
    return { ok: false, error: 'codegraph returned non-JSON output' };
  }
}

// Build a codegraph arg array that is SAFE against option injection (codex finding
// #2). A user-controlled value beginning with `-` (e.g. `--version`) would otherwise
// be parsed as a flag. We put every facade-supplied flag FIRST, then the commander
// end-of-options separator `--`, then the user positional LAST. Verified against
// codegraph 0.9.9 (commander): `query <flags> -- <search>` treats <search> as the
// positional even when it starts with `-`. Everything after `--` is positional, so
// the user value MUST be the final token (flags cannot follow it).
//   verb:   the codegraph subcommand ('callers' | 'query' | 'impact')
//   flags:  facade-controlled flags (no user input)
//   userPositional: the single user-controlled term
function cgArgs(verb, flags, userPositional) {
  return [verb, ...flags, '--', String(userPositional)];
}

// Response-shape validation (codex finding #3). status-0 + unexpected JSON shape
// (e.g. {}, {callers:null}) must NOT silently coerce to a "valid empty" result that
// hides schema drift; instead we treat it as a soft failure so the existing TLDR
// fallback runs. Distinguishes:
//   - VALID EMPTY  (expected key present + is an array, len 0)  -> { ok:true, value:[] }
//   - VALID DATA   (expected key present + is a non-empty array) -> { ok:true, value }
//   - WRONG SHAPE  (not an object, OR key present-but-not-array,
//                   OR shape unrecognized)                       -> { ok:false }
// `kind`:
//   'array'      -> the whole response should be a top-level array (codegraph query)
//   '<keyName>'  -> the response should be an object whose <keyName> is an array
function validateCgShape(data, kind) {
  if (kind === 'array') {
    return Array.isArray(data) ? { ok: true, value: data } : { ok: false };
  }
  // object-with-array-key shape
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false };
  if (!(kind in data)) return { ok: false }; // expected key absent -> unrecognized shape
  const arr = data[kind];
  if (!Array.isArray(arr)) return { ok: false }; // key present but null/object -> wrong shape
  return { ok: true, value: arr };
}

// ---------------------------------------------------------------------------
// Freshness probe (C.1 finding #2 -- amortize the ~3-4s codegraph cold-start by
// NOT re-querying needlessly, and keep the DB honest before a query). O(1) cheap:
//   - cached `git rev-parse HEAD`  -> HEAD changed since last probe?
//   - `git status --porcelain`     -> any dirty/untracked source files?
// Trust the DB when HEAD unchanged + tree clean. Else `sync <dirtyFile>` per dirty
// file (incremental); if HEAD moved broadly, `index --force`. Bounded + fail-open:
// any probe error -> just query without sync (never throw).
// ---------------------------------------------------------------------------
let _gitHeadCache = null;
function gitHead() {
  if (_gitHeadCache !== null) return _gitHeadCache;
  try {
    const res = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot(),
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true,
    });
    _gitHeadCache = res.status === 0 && res.stdout ? res.stdout.trim() : '';
  } catch {
    _gitHeadCache = '';
  }
  return _gitHeadCache;
}

// Returns { paths, hasStructural } from `git status --porcelain`:
//   - paths: dirty/untracked source paths (repo-relative, forward-slash), bounded.
//   - hasStructural: true if any entry is a delete (D) or rename (R) -- those can
//     orphan caller edges that a per-file `sync` won't repair, so the caller forces
//     a full project sync (codex finding #1). Bounded + fail-open.
function gitDirtyStatus() {
  try {
    const res = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: repoRoot(),
      encoding: 'utf-8',
      timeout: 15000,
      windowsHide: true,
    });
    if (res.status !== 0 || !res.stdout) return { paths: [], hasStructural: false };
    let hasStructural = false;
    const paths = [];
    for (const line of res.stdout.split('\n')) {
      if (!line) continue;
      const xy = line.slice(0, 2); // porcelain status codes (e.g. ' M', 'D ', 'R ', '??')
      // D = delete, R = rename in either the index (X) or worktree (Y) column.
      if (xy.includes('D') || xy.includes('R')) hasStructural = true;
      const p = line.slice(3).trim().replace(/\\/g, '/');
      if (!p) continue;
      // A rename entry is "old -> new"; keep the NEW path for sync purposes.
      const newPath = p.includes(' -> ') ? p.split(' -> ').pop().trim() : p;
      // codegraph only cares about source files; skip the gitignored DB dir defensively.
      if (newPath.startsWith('.codegraph/')) continue;
      paths.push(newPath);
    }
    return { paths: paths.slice(0, 200), hasStructural };
  } catch {
    return { paths: [], hasStructural: false };
  }
}

// Stamp file recording the HEAD codegraph was last indexed/synced at. codegraph's
// `status -j` exposes NO indexed-commit field (verified 0.9.9), so we persist our
// own marker (machine-local; ignored via .codegraph/.gitignore) and compare it to
// the live HEAD on every freshness check (codex finding #1).
function indexedHeadStampPath() {
  return join(repoRoot(), '.codegraph', '.indexed-head');
}
function readIndexedHead() {
  try {
    const p = indexedHeadStampPath();
    if (!existsSync(p)) return null;
    const v = readFileSync(p, 'utf-8').trim();
    return v || null;
  } catch {
    return null;
  }
}
function writeIndexedHead(sha) {
  try {
    if (!sha) return;
    const p = indexedHeadStampPath();
    const dir = dirname(p);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(p, `${sha}\n`, 'utf-8');
  } catch {
    /* stamp write is best-effort; a missing stamp just forces a sync next time */
  }
}

// Run a full project sync so the DB reflects current HEAD/worktree, then refresh
// the stamp. `index --force` when the delta is broad (structural deletes/renames or
// an unknown prior HEAD); otherwise the cheaper `sync`. Returns true on success.
function syncWholeProject({ force }) {
  const root = repoRoot();
  const verb = force ? ['index', '-f', '-q', root] : ['sync', '-q', root];
  const r = runCodegraph(verb, { json: false });
  if (r.ok) {
    writeIndexedHead(gitHead());
    return true;
  }
  return false;
}

// Ensure the codegraph DB is fresh enough for a query. Fail-open: any error just
// means we query the existing DB. Returns a small provenance object for telemetry.
//
// Freshness order (codex finding #1):
//   1. HEAD moved since last index (stamp mismatch) OR structural change (delete/
//      rename) in the worktree -> FORCE a whole-project sync (these can orphan
//      cross-file edges a per-file sync won't repair). `index --force` when the
//      prior HEAD is unknown (no stamp) or HEAD moved AND there are structural
//      changes; plain `sync` otherwise.
//   2. Only ordinary M/?? edits, HEAD unchanged -> incremental per-file sync.
//   3. Clean tree + HEAD matches stamp -> trust the DB, no sync.
let _freshnessDone = false;
let _freshnessInfo = { synced: [], reindexed: false, forced_sync: false };
function ensureFresh() {
  if (_freshnessDone) return _freshnessInfo;
  _freshnessDone = true;
  try {
    const head = gitHead();
    const stamp = readIndexedHead();
    const { paths: dirty, hasStructural } = gitDirtyStatus();

    // A clean checkout/pull/delete/rename can leave the tree clean yet move HEAD;
    // the stamp is the only signal that catches it. Treat unknown stamp as "moved".
    const headMoved = !!head && head !== stamp;

    if (headMoved || hasStructural) {
      // Broad delta -> reindex when we can't trust the prior state or both signals fire.
      const force = !stamp || (headMoved && hasStructural);
      const ok = syncWholeProject({ force });
      _freshnessInfo = { synced: [], reindexed: force && ok, forced_sync: ok };
      return _freshnessInfo;
    }

    if (dirty.length === 0) {
      // HEAD matches the stamp and the tree is clean -> the DB is trustworthy.
      _freshnessInfo = { synced: [], reindexed: false, forced_sync: false };
      return _freshnessInfo;
    }

    // Incremental: sync each dirty source file so the query sees current content.
    // (C.1 finding #3: a callee-file edit can orphan cross-file caller edges; the
    // who-calls path emits a Serena-escalation hint to cover that incompleteness.)
    const synced = [];
    for (const f of dirty) {
      const r = runCodegraph(['sync', '-q', f], { json: false });
      if (r.ok) synced.push(f);
      // a sync error is non-fatal: we still query the existing DB.
    }
    _freshnessInfo = { synced, reindexed: false, forced_sync: false };
    return _freshnessInfo;
  } catch {
    _freshnessInfo = { synced: [], reindexed: false, forced_sync: false };
    return _freshnessInfo;
  }
}

// ---------------------------------------------------------------------------
// toScipId(node): the SINGLE codegraph -> SCIP coupling point (mitigation #5,
// collision-safe). Maps a codegraph node {name,filePath,qualifiedName,startLine,
// kind} to a stable SCIP-ish id. The signature_hash includes filePath + lang +
// qualifiedName + kind + startLine, so two SAME-NAMED symbols in DIFFERENT files
// (or different lines/overloads) get DIFFERENT hashes -- no merge.
// ---------------------------------------------------------------------------
const LANG_BY_EXT = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyi: 'python',
  go: 'go', rs: 'rust', java: 'java', cs: 'csharp',
  rb: 'ruby', php: 'php', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
};
function langFromPath(p) {
  const m = String(p || '').match(/\.([A-Za-z0-9]+)$/);
  if (!m) return 'unknown';
  return LANG_BY_EXT[m[1].toLowerCase()] || m[1].toLowerCase();
}

// Repo-relative, forward-slash file uri. Absolute codegraph paths are made
// repo-relative; already-relative paths are normalized.
function fileUri(filePath, root) {
  if (!filePath) return '';
  let rel = filePath;
  try {
    rel = isAbsolute(filePath) ? relative(root, filePath) : filePath;
  } catch {
    rel = filePath;
  }
  return rel.replace(/\\/g, '/');
}

function toScipId(node, opts = {}) {
  const root = opts.root || repoRoot();
  const rawFilePath = node?.filePath || node?.file_path || node?.path || '';
  const filePath = rawFilePath;
  const uri = fileUri(filePath, root);
  const name = node?.name || '';
  const rawQualified = node?.qualifiedName || node?.qualified_name || '';
  const qualifiedName = rawQualified || name;
  const kind = node?.kind || 'unknown';
  const startLine = node?.startLine ?? node?.line ?? 0;
  const lang = node?.language || langFromPath(filePath);
  // container = qualifiedName minus the leaf segment (best-effort; '.' or '#' or '/').
  const container = String(qualifiedName)
    .split(/[.#/]/)
    .slice(0, -1)
    .join('.') || null;
  // moved_flag: caller cross-checks name-match-but-path-differs; here we only carry
  // the inputs. We expose a stable signature hash that is collision-safe across files.
  const signature_hash = createHash('sha256')
    .update(`${uri}|${lang}|${qualifiedName}|${kind}|${startLine}`)
    .digest('hex')
    .slice(0, 32);
  // persistable (codex finding #5): a field-sparse node whose optional fields all
  // defaulted ('' / 0 / 'unknown') would collide with every other equally-sparse
  // node on the same signature_hash -> merged bus updates. Require at least ONE
  // strong identity field (a real filePath/uri OR a real qualifiedName) for the id
  // to be proposed to the bus. Sparse nodes still return to the user; they are just
  // omitted from focus_symbols/recent_findings/codegraphSubjectIds.
  const persistable = !!(uri || rawQualified || name);
  return {
    git_sha: gitHead().slice(0, 12) || null,
    file_uri: uri,
    lang,
    container,
    name,
    qualified_name: qualifiedName,
    kind,
    start_line: startLine,
    signature_hash,
    persistable,
  };
}

// ---------------------------------------------------------------------------
// corpus_signature (mitigation #4 -- REAL enumeration, not status parsing):
//   { git_head: rev-parse[:12], file_count: from `git ls-files | wc -l` (codegraph
//     status fileCount kept as a cross-check), ignored_glob_hash: sha256(.gitignore)[:4] }.
// Cached per process; fail-open to null.
// ---------------------------------------------------------------------------
let _corpusSigDone = false;
let _corpusSig = null;
function corpusSignature() {
  if (_corpusSigDone) return _corpusSig;
  _corpusSigDone = true;
  try {
    const root = repoRoot();
    const head = gitHead().slice(0, 12) || null;
    // Real file enumeration via git ls-files (tracked) -- NOT codegraph status.
    let fileCount = null;
    try {
      const res = spawnSync('git', ['ls-files'], {
        cwd: root,
        encoding: 'utf-8',
        timeout: 15000,
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
      });
      if (res.status === 0 && typeof res.stdout === 'string') {
        fileCount = res.stdout.split('\n').filter(Boolean).length;
      }
    } catch {
      /* leave null */
    }
    // ignored_glob_hash: fingerprint .gitignore drift (the design's ignore proxy).
    let ignoredGlobHash = null;
    try {
      const gi = join(root, '.gitignore');
      if (existsSync(gi)) {
        ignoredGlobHash = createHash('sha256').update(readFileSync(gi, 'utf-8')).digest('hex').slice(0, 4);
      }
    } catch {
      /* leave null */
    }
    _corpusSig = { git_head: head, file_count: fileCount, ignored_glob_hash: ignoredGlobHash };
    return _corpusSig;
  } catch {
    _corpusSig = null;
    return _corpusSig;
  }
}

// Light, injection-free ranking bias: results whose content mentions a focus symbol
// bubble to the top. We re-rank the RETURNED results client-side -- we never inject
// bus terms into the recall query (avoids the to_tsquery surface entirely).
function biasByFocus(results, focusSymbols) {
  if (!focusSymbols || focusSymbols.length === 0) return { results, applied: false };
  const terms = focusSymbols.map((s) => String(s).toLowerCase()).filter(Boolean);
  if (terms.length === 0) return { results, applied: false };
  const scored = results.map((r, idx) => {
    const hay = String(r.content || '').toLowerCase();
    const hit = terms.some((t) => hay.includes(t));
    return { r, idx, hit };
  });
  scored.sort((a, b) => (b.hit ? 1 : 0) - (a.hit ? 1 : 0) || a.idx - b.idx);
  return { results: scored.map((s) => s.r), applied: scored.some((s) => s.hit) };
}

function resultCount(data) {
  if (!data || typeof data !== 'object') return 0;
  for (const key of ['results', 'callers', 'matches', 'functions', 'symbols', 'items']) {
    if (Array.isArray(data[key])) return data[key].length;
  }
  return Array.isArray(data) ? data.length : undefined;
}

// ---------------------------------------------------------------------------
// Subcommand table (typed dispatch -- exact match only).
// ---------------------------------------------------------------------------
const COMMANDS = {
  'flow <file> <fn>': 'Control/data flow inside a function (tldr cfg).',
  'who-calls <fn> [path]': 'Reverse call graph -- who calls fn (codegraph callers; off/absent -> tldr impact).',
  'find-symbol <name> [path]': 'Locate a symbol (codegraph query/FTS; off/absent -> tldr search; Serena for precise identity).',
  'code-context <topic>': 'Broad context for a topic (codegraph FTS+blast-radius fused with tldr structure + archival recall).',
  'recall <query>': 'Search archival memory for prior learnings.',
  'rename-preview <pattern> [replacement]': 'ast-grep rewrite preview (MCP-only -> returns guidance).',
  'bus [--bus <id>]': 'Read the discovered session context bus (read-only).',
  'help': 'Show available subcommands.',
};

function help() {
  return { success: true, backend: 'facade', routing_reason: 'help', commands: COMMANDS };
}

function clarify(cmd) {
  return {
    success: false,
    clarify: true,
    backend: 'facade',
    routing_reason: cmd ? `unknown subcommand '${cmd}'` : 'no subcommand given',
    supported: Object.keys(COMMANDS),
  };
}

function main() {
  const { cmd, positional, opts } = parseArgv(process.argv);
  const correlation_id = randomUUID();
  const t0 = Date.now();

  if (!cmd || cmd === 'help') {
    out(help());
    return;
  }

  let response;
  let specialist = null;
  const query_type = cmd;
  // codegraph wiring (C.2): subject ids the call resolved (SCIP-shaped, NOT free
  // text) + any Serena escalation. Set inside the codegraph live paths.
  let codegraphSubjectIds = [];
  let escalatedTo = null;

  try {
  switch (cmd) {
    case 'flow': {
      if (positional.length < 2) { out(clarify('flow')); return; }
      specialist = 'tldr';
      const [file, fn] = positional;
      const r = runTldr(['cfg', file, fn]);
      response = respond({
        backend: 'tldr',
        routing_reason: 'TLDR owns control/data-flow queries',
        result: r.ok ? r.data : { error: r.error },
        success: r.ok,
      });
      break;
    }
    case 'who-calls': {
      if (positional.length < 1) { out(clarify('who-calls')); return; }
      const [fn, path] = positional;
      if (!codegraphAbsent()) {
        // LIVE path: codegraph owns reverse call graph. ensureFresh() so the DB
        // reflects current content before the query (bounded, fail-open).
        ensureFresh();
        const root = repoRoot();
        // `--` guards against option injection: a fn like `--version` is a positional.
        const cg = runCodegraph(cgArgs('callers', ['-p', root, '-j', '-l', '50'], fn));
        // Shape-validate (finding #3): status-0 but {callers:null}/{} -> fall through
        // to the TLDR fallback rather than reporting a fake "0 callers" success.
        const shape = cg.ok ? validateCgShape(cg.data, 'callers') : { ok: false };
        if (cg.ok && shape.ok) {
          specialist = 'codegraph';
          let callers = shape.value;
          // who-calls path constraint (finding #4): when a path is given, narrow the
          // live callers to that path client-side, matching the TLDR fallback's
          // `impact fn path` narrowing (otherwise live vs fallback diverge).
          if (path) {
            const needle = String(path).replace(/\\/g, '/').toLowerCase();
            callers = callers.filter((c) =>
              fileUri(c?.filePath || c?.file_path || c?.path, root).toLowerCase().includes(needle),
            );
          }
          const callerIds = callers.map((c) => toScipId(c, { root }));
          // C.1 finding #3 (edge-orphaning) + alias-proneness: emit a Serena hint
          // when callers is empty (a callee-file edit can orphan cross-file caller
          // edges from a plain sync) OR when the name looks alias-prone.
          const aliasProne = /[._#]/.test(fn) || fn.length <= 2;
          const empty = callers.length === 0;
          const serenaHint = empty || aliasProne
            ? 'codegraph reverse-edges can be incomplete after a callee-file edit (plain sync orphans cross-file caller edges) or for alias-prone names; escalate to Serena find_referencing_symbols for precise callers.'
            : undefined;
          response = respond({
            backend: 'codegraph',
            routing_reason: 'codegraph owns reverse call graph (who calls X)',
            result: {
              symbol: cg.data?.symbol ?? fn,
              callers,
              caller_ids: callerIds,
              ...(serenaHint ? { serena_hint: serenaHint } : {}),
            },
            success: true,
          });
          codegraphSubjectIds = callerIds;
          escalatedTo = (empty || aliasProne) ? 'serena' : null;
          break;
        }
        // codegraph errored at runtime OR returned a wrong-shaped payload ->
        // degrade to TLDR below (do not crash, do not report a fake empty result).
      }
      // Absent / off / codegraph runtime error: UNCHANGED TLDR fallback.
      specialist = 'tldr';
      const r = runTldr(path ? ['impact', fn, path] : ['impact', fn]);
      response = respond({
        backend: 'tldr',
        escalated_from: 'codegraph',
        routing_reason: 'codegraph absent/off -> tldr impact (reverse call graph)',
        result: r.ok ? r.data : { error: r.error },
        success: r.ok,
      });
      break;
    }
    case 'find-symbol': {
      if (positional.length < 1) { out(clarify('find-symbol')); return; }
      const [name, path] = positional;
      if (!codegraphAbsent()) {
        // LIVE path: codegraph owns broad symbol FTS.
        ensureFresh();
        const root = repoRoot();
        // `--` guards against option injection: a name like `--version` is a positional.
        const cg = runCodegraph(cgArgs('query', ['-p', root, '-j', '-l', '50'], name));
        // Shape-validate (finding #3): codegraph query MUST be a top-level array.
        // A status-0 object/null payload is schema drift -> fall through to TLDR.
        const shape = cg.ok ? validateCgShape(cg.data, 'array') : { ok: false };
        if (cg.ok && shape.ok) {
          specialist = 'codegraph';
          // codegraph query -> array of {node, score}. Client-side filter to `path`
          // (substring on the repo-relative file uri) when a path is given.
          let hits = shape.value;
          if (path) {
            const needle = String(path).replace(/\\/g, '/').toLowerCase();
            hits = hits.filter((h) => fileUri(h?.node?.filePath, root).toLowerCase().includes(needle));
          }
          const symbolIds = hits.map((h) => toScipId(h.node, { root }));
          // Serena escalation preserved: codegraph is FTS (broad, not alias-resolving);
          // Serena is terminal authority on symbol identity.
          const serenaHint =
            'codegraph query is broad FTS, not alias resolution; for precise symbol identity (through re-exports/aliases) escalate to Serena find_symbol.';
          response = respond({
            backend: 'codegraph',
            routing_reason: 'codegraph owns broad symbol FTS (find symbol X); Serena for precise identity',
            result: {
              query: name,
              matches: hits,
              symbol_ids: symbolIds,
              serena_hint: serenaHint,
            },
            success: true,
          });
          codegraphSubjectIds = symbolIds;
          escalatedTo = hits.length === 0 ? 'serena' : null;
          break;
        }
        // codegraph runtime error OR wrong-shaped payload -> degrade to TLDR below.
      }
      // Absent / off / codegraph runtime error: UNCHANGED TLDR fallback.
      specialist = 'tldr';
      const r = runTldr(path ? ['search', name, path] : ['search', name]);
      response = respond({
        backend: 'tldr',
        escalated_from: 'codegraph',
        routing_reason: 'codegraph absent/off + Serena MCP-only -> tldr search; escalate to Serena (find_symbol) for precise symbol identity',
        result: r.ok ? r.data : { error: r.error },
        success: r.ok,
      });
      break;
    }
    case 'code-context': {
      if (positional.length < 1) { out(clarify('code-context')); return; }
      const topic = positional.join(' ');
      // Existing fused base: tldr structure + bus + archival recall. UNCHANGED shape.
      const structure = runTldr(['structure', '.']);
      const bus = readBus(opts.bus);
      const recall = runRecall(topic, { k: opts.k, textOnly: opts.textOnly });
      let recallResults = recall.ok ? recall.results : [];
      const biased = biasByFocus(recallResults, bus.focus.symbols);

      // codegraph AUGMENTS (never replaces): query the topic for symbol context +
      // pull blast radius via `impact`. Graceful degrade to the current shape when
      // codegraph is off/absent.
      let codegraphBlock; // undefined when off/absent -> envelope shape unchanged
      if (!codegraphAbsent()) {
        ensureFresh();
        const root = repoRoot();
        // `--` guards against option injection on the user-controlled topic term.
        const cgQuery = runCodegraph(cgArgs('query', ['-p', root, '-j', '-l', '10'], topic));
        // Shape-validate (finding #3): query MUST be a top-level array; an object/null
        // payload is schema drift -> skip the augment (envelope shape stays unchanged).
        const qShape = cgQuery.ok ? validateCgShape(cgQuery.data, 'array') : { ok: false };
        if (cgQuery.ok && qShape.ok) {
          specialist = 'codegraph+tldr+archival_memory';
          const matches = qShape.value;
          const matchIds = matches.map((h) => toScipId(h.node, { root }));
          // Blast radius: impact on the top symbol name (best-effort, fail-soft).
          // impact returns an OBJECT (not array) so we keep it as-is when present.
          let impact;
          const top = matches[0]?.node?.name;
          if (top) {
            const cgImpact = runCodegraph(cgArgs('impact', ['-p', root, '-j'], top));
            if (cgImpact.ok && cgImpact.data && typeof cgImpact.data === 'object') impact = cgImpact.data;
          }
          codegraphBlock = { matches, match_ids: matchIds, ...(impact !== undefined ? { impact } : {}) };
          codegraphSubjectIds = matchIds;
        }
      }
      if (specialist === null) specialist = 'tldr+archival_memory';

      response = respond({
        backend: codegraphBlock ? 'codegraph+tldr+archival_memory' : 'tldr+archival_memory',
        ...(codegraphBlock ? {} : { escalated_from: 'codegraph' }),
        routing_reason: codegraphBlock
          ? 'codegraph (FTS + blast radius) fused with tldr structure + archival recall'
          : 'codegraph absent/off -> tldr structure + archival recall (FTS); report both',
        bus_id: bus.busId ?? undefined,
        discovery: bus.discovery,
        warning: bus.warning,
        result: {
          structure: structure.ok ? structure.data : { error: structure.error },
          recall: recall.ok ? biased.results : { error: recall.error },
          bus_focus_applied: biased.applied,
          ...(codegraphBlock ? { codegraph: codegraphBlock } : {}),
        },
        success: structure.ok || recall.ok || codegraphBlock !== undefined,
      });
      break;
    }
    case 'recall': {
      if (positional.length < 1) { out(clarify('recall')); return; }
      specialist = 'archival_memory';
      const query = positional.join(' ');
      const bus = readBus(opts.bus);
      const r = runRecall(query, { k: opts.k, textOnly: opts.textOnly });
      const biased = r.ok ? biasByFocus(r.results, bus.focus.symbols) : { results: [], applied: false };
      response = respond({
        backend: 'archival_memory',
        routing_reason: 'archival_memory owns "have we solved this before"',
        bus_id: bus.busId ?? undefined,
        discovery: bus.discovery,
        warning: bus.warning,
        result: r.ok ? { results: biased.results, bus_focus_applied: biased.applied } : { error: r.error },
        success: r.ok,
      });
      break;
    }
    case 'rename-preview': {
      if (positional.length < 1) { out(clarify('rename-preview')); return; }
      specialist = 'ast-grep';
      const pattern = positional[0];
      const replacement = positional[1];
      // ast-grep is MCP-only here -- return the exact guidance invocation, never crash.
      // Escape single quotes so a pattern containing `'` (e.g. it's) yields a copy-pasteable
      // shell string instead of broken syntax (cross-model review F4). Also surface the raw
      // pattern/replacement as structured fields so callers can assemble their own command.
      const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
      const invocation = replacement
        ? `ast-grep run -p ${shq(pattern)} -r ${shq(replacement)} (via ast-grep MCP, or the ast-grep-find skill)`
        : `ast-grep run -p ${shq(pattern)} (via ast-grep MCP, or the ast-grep-find skill)`;
      response = respond({
        backend: 'ast-grep',
        routing_reason: 'ast-grep is MCP-only (no bare CLI from this facade) -> guidance returned',
        result: {
          guidance: invocation,
          pattern,
          replacement: replacement ?? null,
          note: 'Run through the ast-grep MCP server / ast-grep-find skill; this facade does not execute it.',
        },
        success: true,
      });
      break;
    }
    case 'bus': {
      specialist = 'context-bus';
      const bus = readBus(opts.bus);
      response = respond({
        backend: 'context-bus',
        routing_reason: 'read-only view of the discovered session context bus',
        bus_id: bus.busId ?? undefined,
        discovery: bus.discovery,
        warning: bus.warning,
        result: bus.raw
          ? { focus_symbols: bus.focus.symbols, files_in_play: bus.focus.files, current_intent: bus.raw.current_intent, schema_version: bus.raw.schema_version }
          : { focus_symbols: [], files_in_play: [], note: BUS_OFF ? 'CCV3_BUS_OFF=1' : 'no bus found' },
        success: true,
      });
      break;
    }
    default:
      out(clarify(cmd));
      return;
  }
  } catch (e) {
    // Top-level fail-open: a synchronous throw from any backend still yields valid JSON.
    out({ success: false, backend: 'facade', routing_reason: 'internal error', error: String(e?.message || e) });
    return;
  }

  // codegraph wiring (C.2): when the codegraph live path ran, attach the corpus
  // fingerprint, a STRUCTURED subject id (the top result's signature_hash -- NOT
  // free text, mitigation #13 redaction), the Serena escalation, and a
  // PROPOSED bus update with a TTL/validity stamp (git_sha + corpus_signature,
  // mitigation #10). The facade PROPOSES only; it never writes L2 (single-writer).
  const ranCodegraph = specialist != null && specialist.startsWith('codegraph');
  let corpus_signature;
  let subject_id;
  if (ranCodegraph) {
    corpus_signature = corpusSignature() ?? undefined;
    // Collision guard (codex finding #5): ONLY persistable ids (with a real identity
    // field) are proposed to the bus. Field-sparse nodes -- whose optional fields all
    // defaulted -- share a signature_hash and would merge; we drop them from the bus
    // proposal (and from subject_id) while still returning their rows to the user.
    const persistableIds = codegraphSubjectIds.filter((s) => s && s.persistable);
    // subject_id is the top resolved (persistable) symbol's collision-safe hash. It is
    // a hash, not the symbol name/path, so it carries no raw identifier.
    subject_id = persistableIds[0]?.signature_hash;
    const sig = corpus_signature || {};
    const proposed_bus_updates = {
      focus_symbols: persistableIds.map((s) => s.signature_hash).filter(Boolean).slice(0, 16),
      recent_findings: persistableIds.slice(0, 16).map((s, i) => ({
        subject_id: s.signature_hash,
        source: 'codegraph_fts',
        rank: i,
      })),
      // TTL/validity stamp -- a downstream SubagentStop writer revalidates before
      // applying. Stale (HEAD moved or corpus drifted) -> the proposal is dropped.
      validity: {
        git_sha: sig.git_head ?? (gitHead().slice(0, 12) || null),
        corpus_signature: sig,
        generated_at: new Date().toISOString(),
      },
    };
    response.proposed_bus_updates = proposed_bus_updates;
  }

  // One telemetry row per executed (non-help, non-clarify) call. For non-codegraph
  // calls: no raw query text / file path / symbol name is logged (only the subcommand
  // as query_type). For codegraph calls: subject_id is a signature_hash (structured),
  // corpus_signature is fingerprint-only -- both safe; see appendIntelRow + intel-bus.ts.
  appendIntelRow({
    bus_id: response.bus_id || 'unknown',
    specialist,
    query_type,
    result_count: resultCount(response.result),
    escalated_from: response.escalated_from ?? null,
    escalated_to: escalatedTo ?? null,
    ...(subject_id ? { subject_id } : {}),
    ...(corpus_signature ? { corpus_signature } : {}),
    duration_ms: Date.now() - t0,
    correlation_id,
  });

  out(response);
}

// Run as a CLI when invoked directly; stay importable (no side effects) when a test
// imports this module to unit-test pure helpers like toScipId / corpusSignature.
const _invokedDirectly = (() => {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    // Fail-safe: if we cannot compare, default to running (preserves CLI behavior).
    return true;
  }
})();
if (_invokedDirectly) {
  main();
}

// Test-only surface: pure helpers a unit test can import without spawning the CLI.
// Importing this module does NOT run main() (guarded above), so these are safe.
export { toScipId, langFromPath, fileUri, cgArgs, validateCgShape };
