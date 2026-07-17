// make-run.mjs — the report-run.json EMIT contract (Phase 2a).
//
// One helper that both node pipelines (via `import { buildRun, writeRun }`) and
// shell/PowerShell wrappers (via CLI flags) use to BUILD + WRITE a valid
// `report-run.json` — the structured-run record every reporting pipeline hands
// to the registry spine (upsert.mjs). See README.md for the pinned schema.
//
// runId = `<type>|<period>|<ISO-timestamp>`, where the ISO-timestamp IS runDate
// (defaults to now). So a retry that re-emits with the SAME runDate re-targets
// the SAME registry row (idempotent update); a fresh emit (new runDate) appends.
//
// CLI:
//   node make-run.mjs --type "Project Portfolio" --period 2026-07-05 \
//     --status OK --source Project-Cards --summary "cards refreshed=8"
//   -> writes $TEMP/report-run-Project-Cards.json and prints the path to stdout.
//
// Flags: --type --period --status --source (required); --runDate --artifactUrl
//   --docxUrl --summary --commit --corrective (optional); --out <path> (override
//   target path).
//
// ESM, no external deps. Reuses the REPORT_TYPES / STATUSES enums from config.mjs
// (single source of truth) so validation here can never drift from the upsert.
//
// REGISTRY CONVENTIONS (proposal 08, 2026-07-17) — enforced here so they can't
// drift: (1) corrective (backfill/remap) rows must carry a `backfill:`/`remap:`
// summary prefix, declared via `corrective: true` / `--corrective`; (2)
// artifactUrl/docxUrl must be http(s) — artifact URLs must outlive promotion;
// (3) one period format per report-type cadence, per config.mjs
// PERIOD_FORMAT_BY_TYPE (VP Weekly's ISO-week format is the lone exception);
// (4) watchdog schedule parity is enforced in watchdog.mjs (every REPORT_TYPES
// entry needs a schedule entry). See README.md "Registry conventions".
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  REPORT_TYPES, STATUSES, SOURCES,
  PERIOD_FORMAT_BY_TYPE, ISO_WEEK_PERIOD_RE, ISO_DATE_PERIOD_RE,
  CORRECTIVE_PREFIX_RE, HTTP_URL_RE,
} from './config.mjs';

// ACCEPTED RISK (T6.1): two runs of the SAME source share the canonical
// $TEMP/report-run-<source>.json emit path, so overlapping same-job invocations could
// clobber each other's emit. That requires OVERLAPPING runs of one scheduled job, which
// Task Scheduler's no-overlap setting prevents. Not guarded; the upsert's orphan-cleanup
// is the self-heal if a duplicate ever lands.

// The optional string fields (omitted from the emitted JSON when absent, so a
// partial emit never writes empty strings the upsert would have to strip).
const OPTIONAL_STR_KEYS = ['artifactUrl', 'docxUrl', 'summary', 'commit'];

// --- pure builder --------------------------------------------------------------
// Build a validated report-run object. Throws (fail-loud) on a missing/invalid
// required field so a pipeline can never emit an un-upsertable record. runDate
// defaults to now (ISO); runId is derived from type|period|runDate.
//
// `corrective` (optional boolean) declares INTENT for a backfill/remap re-emit
// of an old period. It is enforced bidirectionally against the summary's
// `backfill:`/`remap:` prefix (proposal 08, registry conventions) — pickNewest()
// in refresh-pages.mjs relies on that exact prefix to exclude corrective rows
// from "Current run", so an accidental prefix (or a missing one on a row that
// claims to be corrective) is exactly the drift this guard prevents.
export function buildRun({
  type, period, runDate, status, source,
  artifactUrl, docxUrl, summary, commit, corrective,
} = {}) {
  const req = { type, period, status, source };
  for (const [k, v] of Object.entries(req)) {
    if (v == null || String(v).trim() === '') {
      throw new Error(`buildRun: missing required field "${k}" (required: type, period, status, source)`);
    }
  }
  if (!REPORT_TYPES.includes(type)) {
    throw new Error(`buildRun: invalid type "${type}" (allowed: ${REPORT_TYPES.join(', ')})`);
  }
  if (!STATUSES.includes(status)) {
    throw new Error(`buildRun: invalid status "${status}" (allowed: ${STATUSES.join(', ')})`);
  }
  // Guard `source` against the known Source select values so a wrapper typo can't mint
  // a stray option in the shared Notion select (T6.1 #4).
  if (!SOURCES.includes(source)) {
    throw new Error(`buildRun: invalid source "${source}" (allowed: ${SOURCES.join(', ')})`);
  }
  // Registry convention: one period format per report-type cadence (config.mjs
  // PERIOD_FORMAT_BY_TYPE is the single source of truth; VP Weekly's ISO-week
  // format is the documented lone exception).
  const periodFormat = PERIOD_FORMAT_BY_TYPE[type];
  const periodRe = periodFormat === 'isoWeek' ? ISO_WEEK_PERIOD_RE : ISO_DATE_PERIOD_RE;
  if (!periodRe.test(String(period))) {
    const example = periodFormat === 'isoWeek' ? 'YYYY-Www, e.g. "2026-W29"' : 'YYYY-MM-DD, e.g. "2026-07-17"';
    throw new Error(`buildRun: period "${period}" does not match the "${periodFormat}" format required for type "${type}" (expected ${example})`);
  }
  // Registry convention: corrective rows (backfill/remap) MUST carry the prefix,
  // and only rows that intend to be corrective may carry it.
  const summaryHasCorrectivePrefix = summary != null && CORRECTIVE_PREFIX_RE.test(String(summary));
  if (corrective && !summaryHasCorrectivePrefix) {
    throw new Error('buildRun: corrective:true requires a summary starting with "backfill:" or "remap:" (pickNewest excludes these from "Current run" by this exact prefix)');
  }
  if (!corrective && summaryHasCorrectivePrefix) {
    throw new Error('buildRun: summary starts with "backfill:"/"remap:" but corrective:true was not passed — pass corrective:true to confirm this is an intentional corrective row, or reword the summary if it is not');
  }
  // Registry convention: artifact/docx URLs must outlive promotion — a local
  // filesystem path stops resolving once the run's temp workspace is cleaned up,
  // and Notion's `url` property rejects non-URL values outright.
  for (const [field, value] of [['artifactUrl', artifactUrl], ['docxUrl', docxUrl]]) {
    if (value != null && String(value).trim() !== '' && !HTTP_URL_RE.test(String(value))) {
      throw new Error(`buildRun: "${field}" must be an http(s) URL (got "${value}") — artifact URLs must outlive promotion, so local paths are rejected here rather than silently dropped later`);
    }
  }
  const ts = (runDate != null && String(runDate).trim() !== '')
    ? String(runDate)
    : new Date().toISOString();
  const run = {
    runId: `${type}|${period}|${ts}`,
    type,
    period: String(period),
    runDate: ts,
    status,
    source,
  };
  for (const k of OPTIONAL_STR_KEYS) {
    const v = { artifactUrl, docxUrl, summary, commit }[k];
    if (v != null && String(v).trim() !== '') run[k] = String(v);
  }
  return run;
}

// --- target path ---------------------------------------------------------------
// The canonical emit path for a source: $TEMP/report-run-<source>.json. Honors
// Windows %TEMP%/%TMP% first (process.env.TEMP), then Node's tmpdir(). A source
// with path-hostile chars is slugged so the filename is always safe.
export function tempRunPath(source) {
  const dir = process.env.TEMP || process.env.TMP || tmpdir();
  const safe = String(source || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '-');
  return join(dir, `report-run-${safe}.json`);
}

// --- writer --------------------------------------------------------------------
// Write a (built) run to disk as pretty JSON. Path = `out` when given, else the
// canonical tempRunPath(run.source). Returns the absolute path written.
export function writeRun(run, { out } = {}) {
  const path = out || tempRunPath(run.source);
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return path;
}

// --- CLI -----------------------------------------------------------------------
export function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      // Guard a `--key=--value` form: a value that itself leads with `--` is almost
      // certainly a missing value swallowed from the next flag — fail loud rather than
      // write a garbage field (T6.1 #9).
      const val = a.slice(eq + 1);
      if (val.startsWith('--')) {
        throw new Error(`parseFlags: flag "${a.slice(2, eq)}" has a "--"-leading value "${val}" (likely a missing value)`);
      }
      flags[a.slice(2, eq)] = val;
    } else {
      // Space form: only consume the next token as a value when it is NOT itself a
      // flag. A following `--flag` means this flag's value was omitted, so record it
      // as a bare boolean (buildRun's required/enum checks then fail loud on it).
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) { flags[a.slice(2)] = next; i += 1; } else { flags[a.slice(2)] = true; }
    }
  }
  return flags;
}

function main() {
  const f = parseFlags(process.argv.slice(2));
  const run = buildRun({
    type: f.type, period: f.period, runDate: f.runDate, status: f.status,
    source: f.source, artifactUrl: f.artifactUrl, docxUrl: f.docxUrl,
    summary: f.summary, commit: f.commit,
    corrective: f.corrective === true || f.corrective === 'true',
  });
  const path = writeRun(run, { out: typeof f.out === 'string' ? f.out : undefined });
  console.error(`[report-registry] emitted run ${run.runId} -> ${path}`);
  console.log(path); // machine-readable: the written path on stdout
  return path;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    main();
  } catch (e) {
    console.error(`[report-registry] ERROR: ${e.message}`);
    process.exit(1);
  }
}
