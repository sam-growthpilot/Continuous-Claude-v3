// upsert.mjs — the Report Runs registry spine (Phase 2b).
//
// Reads one `report-run.json` (the structured-run contract every pipeline emits)
// and UPSERTS it into the Report Runs Notion DB keyed by the unique `Run ID`:
//   - query the DS for a row whose `Run ID` equals runId
//   - 1 match  -> updatePageProperties (in-place UPDATE, same run retried)
//   - 0 match  -> createPage           (APPEND, a new run — incl. failures)
//   - >1 match -> loud dedup warning, then update the NEWEST (by Run Date)
//
// Model = append-all-attempts: a DISTINCT runId always yields a NEW row (never
// overwrites a different run); the SAME runId updates in place. `Period` is a
// grouping field, NOT unique.
//
// NON-FATAL-BUT-LOUD contract: on any failure this process prints
// `[report-registry] ERROR: …` to stderr and exits NONZERO. The DESIGN INTENT is
// that CALLERS invoke it so a nonzero exit NEVER fails the parent report run —
// e.g. wrap the call in the parent bat/ps1 so a registry outage can't block a
// report. A Phase-4 missing-row detector catches any resulting drift.
//
// CLI usage (input resolved in this precedence):
//   node upsert.mjs path/to/report-run.json      # first non-flag arg = file path
//   node upsert.mjs --emit '<json-string>'        # inline JSON
//   echo '<json>' | node upsert.mjs               # stdin (no path, no --emit)
//
// Reuses scripts/project-cards/lib/notion.mjs (absolute-NTN_EXE non-interactive
// contract + queryDataSource / createPage / updatePageProperties). No new deps.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  queryDataSource, createPage, updatePageProperties, richText, dateStart,
} from '../project-cards/lib/notion.mjs';
import {
  REPORT_RUNS_DS_ID, REPORT_TYPES, STATUSES, REPORT_RUN_KEYS,
} from './config.mjs';

const REQUIRED_KEYS = ['runId', 'type', 'period', 'runDate', 'status', 'source'];

// Transient failure signature (mirrors lib/notion.mjs). A create POST that fails
// with one of these MAY have already committed server-side (a timed-out POST can
// still land), so before retrying we re-query by the unique Run ID and adopt an
// existing row instead of blindly creating a duplicate (T5.1).
const TRANSIENT_RE = /429|rate|timeout|5\d\d|ECONN|ETIMEDOUT|Failed to execute public API request|failed after \d+ attempts/i;
const CREATE_MAX_ATTEMPTS = 3;

function isTransientError(err) {
  return TRANSIENT_RE.test(String((err && err.message) || err || ''));
}

// --- validation (pure) ---------------------------------------------------------
// Throws on the first violation with an actionable message. Verified keys:
// required set present + non-empty, type in REPORT_TYPES, status in STATUSES.
export function validateRun(run) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    throw new Error('report-run must be a JSON object');
  }
  for (const k of REQUIRED_KEYS) {
    if (run[k] == null || String(run[k]).trim() === '') {
      throw new Error(`missing required field "${k}" (required: ${REQUIRED_KEYS.join(', ')})`);
    }
  }
  if (!REPORT_TYPES.includes(run.type)) {
    throw new Error(`invalid type "${run.type}" (allowed: ${REPORT_TYPES.join(', ')})`);
  }
  if (!STATUSES.includes(run.status)) {
    throw new Error(`invalid status "${run.status}" (allowed: ${STATUSES.join(', ')})`);
  }
  // Unknown keys are non-fatal but surfaced (schema-drift signal for out-of-repo
  // pipelines coding against the pinned contract).
  const known = new Set([...REPORT_RUN_KEYS, 'attempt']);
  const unknown = Object.keys(run).filter((k) => !known.has(k));
  if (unknown.length) {
    console.error(`[report-registry] WARN: unknown field(s) ignored: ${unknown.join(', ')}`);
  }
  return run;
}

const rt = (s) => [{ type: 'text', text: { content: String(s) } }];

// --- field -> Notion property mapping (pure) -----------------------------------
// Title = "<type> — <period> — <runDate>". Optional fields are omitted (not sent
// as null) when absent, so a partial retry never clobbers a prior value with null.
export function buildProperties(run) {
  const props = {
    'Report Run': { title: rt(`${run.type} — ${run.period} — ${run.runDate}`) },
    'Run ID': { rich_text: rt(run.runId) },
    'Report Type': { select: { name: run.type } },
    Status: { select: { name: run.status } },
    Source: { select: { name: run.source } },
    'Run Date': { date: { start: run.runDate } },
    Period: { rich_text: rt(run.period) },
  };
  if (run.summary != null && run.summary !== '') props.Summary = { rich_text: rt(run.summary) };
  if (run.commit != null && run.commit !== '') props.Commit = { rich_text: rt(run.commit) };
  if (run.artifactUrl != null && run.artifactUrl !== '') props['Artifact URL'] = { url: String(run.artifactUrl) };
  if (run.docxUrl != null && run.docxUrl !== '') props['Docx/Deck'] = { url: String(run.docxUrl) };
  if (run.attempt != null && Number.isFinite(Number(run.attempt))) props.Attempt = { number: Number(run.attempt) };
  return props;
}

// Pick the newest row from a >1-match dedup set: max Run Date, tie-broken by
// Notion last_edited_time. Deterministic so concurrent double-writes converge.
function newestRow(rows) {
  return [...rows].sort((a, b) => {
    const da = dateStart(a.properties?.['Run Date']) || a.last_edited_time || '';
    const db = dateStart(b.properties?.['Run Date']) || b.last_edited_time || '';
    if (da !== db) return db.localeCompare(da);
    return String(b.last_edited_time || '').localeCompare(String(a.last_edited_time || ''));
  })[0];
}

// Re-query the DS for the run's unique Run ID; return the matching rows (0..n).
function queryByRunId(run, dsId, query) {
  return query(dsId, {
    filter: { property: 'Run ID', rich_text: { equals: String(run.runId) } },
  }) || [];
}

// --- idempotent create (T5.1) --------------------------------------------------
// The create POST is NOT safe to blindly retry: a transient failure (timeout /
// 429 / 5xx / dropped connection) can surface AFTER the row has already committed
// server-side, so a naive retry appends a DUPLICATE. Guard: on a transient create
// failure, re-query by the unique Run ID BEFORE retrying — if a row now exists,
// ADOPT it (switch to update) instead of re-creating. Only when no row is found
// (the create genuinely never landed) do we retry the create, bounded. A
// non-transient failure (bad request/auth/validation) throws immediately.
function createOrAdopt(run, properties, { dsId, query, create, update }) {
  let lastErr;
  for (let attempt = 1; attempt <= CREATE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const page = create(dsId, properties);
      return { action: 'created', pageId: page?.id, duplicates: 0 };
    } catch (err) {
      lastErr = err;
      if (!isTransientError(err)) throw err;
      const rows = queryByRunId(run, dsId, query);
      if (rows.length > 0) {
        const target = rows.length > 1 ? newestRow(rows) : rows[0];
        if (rows.length > 1) {
          console.error(`[report-registry] WARN: ${rows.length} rows share Run ID "${run.runId}" after a retried create — adopting the newest (a timed-out create landed more than once).`);
        } else {
          console.error(`[report-registry] transient create failure for Run ID "${run.runId}" — the row landed server-side; adopting it instead of re-creating.`);
        }
        update(target.id, properties);
        return { action: 'adopted', pageId: target.id, duplicates: rows.length };
      }
      if (attempt < CREATE_MAX_ATTEMPTS) {
        console.error(`[report-registry] transient create failure for Run ID "${run.runId}" attempt ${attempt}/${CREATE_MAX_ATTEMPTS}; no row found on re-query — retrying create.`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// --- core upsert (transport injectable for tests) ------------------------------
// Returns { action: 'created'|'adopted'|'updated', pageId, duplicates }. Throws
// on failure.
export function upsertReportRun(run, {
  dsId = REPORT_RUNS_DS_ID,
  query = queryDataSource,
  create = createPage,
  update = updatePageProperties,
} = {}) {
  validateRun(run);
  const properties = buildProperties(run);
  const matches = queryByRunId(run, dsId, query);

  if (matches.length === 0) {
    return createOrAdopt(run, properties, { dsId, query, create, update });
  }

  if (matches.length > 1) {
    console.error(`[report-registry] WARN: ${matches.length} rows share Run ID "${run.runId}" — updating the newest (dedup drift; a distinct runId should never collide).`);
    const target = newestRow(matches);
    update(target.id, properties);
    return { action: 'updated', pageId: target.id, duplicates: matches.length };
  }

  const target = matches[0];
  update(target.id, properties);
  return { action: 'updated', pageId: target.id, duplicates: 1 };
}

// --- input resolution (CLI) ----------------------------------------------------
export function readInput(argv) {
  const emitIdx = argv.indexOf('--emit');
  if (emitIdx !== -1) {
    const val = argv[emitIdx + 1];
    if (val == null) throw new Error('--emit requires a JSON string argument');
    return val;
  }
  const eq = argv.find((a) => a.startsWith('--emit='));
  if (eq) return eq.slice('--emit='.length);
  const firstArg = argv.find((a) => !a.startsWith('--'));
  if (firstArg) return readFileSync(firstArg, 'utf8');
  // No path, no --emit: read the whole of stdin.
  return readFileSync(0, 'utf8');
}

async function main() {
  const raw = readInput(process.argv.slice(2));
  let run;
  try {
    run = JSON.parse(raw);
  } catch (e) {
    throw new Error(`input is not valid JSON: ${e.message}`);
  }
  const result = upsertReportRun(run);
  console.log(`[report-registry] ${result.action} row for Run ID "${run.runId}" (page ${result.pageId})`);
  return result;
}

// Run only when invoked directly (not when imported by tests).
const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[report-registry] ERROR: ${e.message}`);
    process.exit(1);
  });
}

// Re-export the property helper used by extractors so tests can read back rows.
export { richText };
