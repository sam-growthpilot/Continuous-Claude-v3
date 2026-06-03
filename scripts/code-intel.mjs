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
  readdirSync,
  statSync,
  realpathSync,
  appendFileSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

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

// ---------------------------------------------------------------------------
// Telemetry: append ONE intel-bus row per call (L0 log, not L2 state).
// Minimal safe appender: honors CCV3_BUS_OFF, strips newlines, caps line size,
// rotates past the size cap. Writes ONLY allowlisted, NON-content fields -- no raw
// query text, file paths, or symbol names (cross-model review C1/H2): the only strings
// are the fixed facade name, an enum-ish specialist/query_type, the discovered bus_id,
// and a uuid. There is therefore no free-text field that could carry a secret, so no
// per-field redaction is needed here.
// ---------------------------------------------------------------------------
function appendIntelRow(event) {
  if (BUS_OFF) return;
  try {
    const stamped = { ts: new Date().toISOString(), schema_version: 1, facade: '/code-intel', ...event };
    // Strip CR/LF from string fields so one event == one line.
    for (const k of Object.keys(stamped)) {
      if (typeof stamped[k] === 'string') stamped[k] = stamped[k].replace(/[\r\n]+/g, ' ');
    }
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
  'who-calls <fn> [path]': 'Reverse call graph -- who calls fn (codegraph absent -> tldr impact).',
  'find-symbol <name> [path]': 'Locate a symbol (codegraph/Serena absent -> tldr search; Serena for precision).',
  'code-context <topic>': 'Broad context for a topic (tldr structure + archival recall).',
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
      specialist = 'tldr';
      const [fn, path] = positional;
      const r = runTldr(path ? ['impact', fn, path] : ['impact', fn]);
      response = respond({
        backend: 'tldr',
        escalated_from: 'codegraph',
        routing_reason: 'codegraph absent (Phase C) -> tldr impact (reverse call graph)',
        result: r.ok ? r.data : { error: r.error },
        success: r.ok,
      });
      break;
    }
    case 'find-symbol': {
      if (positional.length < 1) { out(clarify('find-symbol')); return; }
      specialist = 'tldr';
      const [name, path] = positional;
      const r = runTldr(path ? ['search', name, path] : ['search', name]);
      response = respond({
        backend: 'tldr',
        escalated_from: 'codegraph',
        routing_reason: 'codegraph absent + Serena MCP-only -> tldr search; escalate to Serena (find_symbol) for precise symbol identity',
        result: r.ok ? r.data : { error: r.error },
        success: r.ok,
      });
      break;
    }
    case 'code-context': {
      if (positional.length < 1) { out(clarify('code-context')); return; }
      specialist = 'tldr+archival_memory';
      const topic = positional.join(' ');
      const structure = runTldr(['structure', '.']);
      const bus = readBus(opts.bus);
      const recall = runRecall(topic, { k: opts.k, textOnly: opts.textOnly });
      let recallResults = recall.ok ? recall.results : [];
      const biased = biasByFocus(recallResults, bus.focus.symbols);
      response = respond({
        backend: 'tldr+archival_memory',
        escalated_from: 'codegraph',
        routing_reason: 'codegraph absent -> tldr structure + archival recall (FTS); report both',
        bus_id: bus.busId ?? undefined,
        discovery: bus.discovery,
        warning: bus.warning,
        result: {
          structure: structure.ok ? structure.data : { error: structure.error },
          recall: recall.ok ? biased.results : { error: recall.error },
          bus_focus_applied: biased.applied,
        },
        success: structure.ok || recall.ok,
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

  // One telemetry row per executed (non-help, non-clarify) call. NOTE: no raw query text /
  // file path / symbol name is logged (only the subcommand as query_type) -- see appendIntelRow.
  appendIntelRow({
    bus_id: response.bus_id || 'unknown',
    specialist,
    query_type,
    result_count: resultCount(response.result),
    escalated_from: response.escalated_from ?? null,
    duration_ms: Date.now() - t0,
    correlation_id,
  });

  out(response);
}

main();
