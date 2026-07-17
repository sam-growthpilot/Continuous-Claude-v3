// watchdog.mjs — the Report Runs "silent-miss" watchdog (Phase 5).
//
// PROBLEM: the registry is append-per-attempt, and every pipeline's registry
// emit lives at the END of its wrapper. A run that never LAUNCHES (a Task
// Scheduler logon condition blocks it) or is KILLED mid-flight (an execution
// time limit) never reaches its own make-run/upsert step, so it leaves ZERO
// rows for its expected period. Nothing before this watchdog checked "expected
// row absent by deadline" — absence itself was invisible.
//
// This module is a declarative SCHEDULE (report type -> cadence + deadline/
// grace) plus a checker: for each type whose deadline+grace has passed for the
// CURRENT expected period, query the registry (read-only) for ANY row of that
// type covering that period. If none exists, upsert ONE synthesized miss-row
// (Status=Failed, the pipeline's OWN registered Source — there is no
// "Watchdog" Source enum value and upsert.mjs hard-rejects unknown ones, see
// config.mjs SOURCES) with a summary marking it as watchdog-detected.
//
// IDEMPOTENT BY CONSTRUCTION: the miss-row's runId is DETERMINISTIC —
// `<type>|<period>|watchdog-miss` (no timestamp), mirroring backfill.mjs's
// deterministic-runId pattern. upsertReportRun() already queries by Run ID
// before creating (T5.1), so running the watchdog twice for the SAME missing
// period re-targets the SAME row (update in place) instead of duplicating —
// no separate existence check is needed; the existing upsert machinery IS the
// idempotency guarantee. A genuine LATE run that eventually lands gets its
// OWN distinct runId (a real timestamp) via its normal wrapper emit, so a
// late-but-real row and a watchdog miss-row for the same period can coexist —
// that is correct history, not a duplicate (append-all-attempts model).
//
// SCHEDULING MODEL (matches the REAL period formats each pipeline emits —
// verified against the wrapper scripts, not the README's illustrative
// examples): VP Weekly emits an ISO-week period (`Get-Date -UFormat '%Y-W%V'`,
// e.g. "2026-W29"); every other type (including the other two weekly-cadence
// types, FourthOS Sponsor and System Health) emits a plain `YYYY-MM-DD` date
// period. Weekly types are gated to their scheduled weekday ONLY — the check
// is a no-op on every other day of the week. Daily types are checked every
// day; two of them (Team Dashboard, Project Portfolio) have a
// `crossesMidnight` grace window because their expected period isn't
// complete until END of day, so — matching the "checked next morning" design
// intent — the watchdog run on day D checks day D-1's row, not day D's
// (checking "today" for those two would always be premature no matter what
// time the watchdog itself runs).
//
// All time math is LOCAL time (the machine's local zone, i.e. America/Chicago
// on this host) via plain Date getters/setters — no TZ library, per the
// "keep it simple" design intent. `--now <ISO>` overrides the check instant
// for testing; passed through `new Date(...)` and read with LOCAL getters, so
// pass a bare local-looking timestamp (no trailing `Z`) when testing, e.g.
// `--now 2026-07-16T13:00:00`.
//
// CLI:
//   node watchdog.mjs                              # real run (writes miss-rows)
//   node watchdog.mjs --dry-run                    # print only, writes NOTHING
//   node watchdog.mjs --dry-run --now <local-ISO>  # simulate a specific check instant
//
// NON-FATAL-BUT-LOUD, matching upsert.mjs's contract: a per-type query/upsert
// failure is logged and does not abort the sweep for the other types. The CLI
// always exits 0 (observability must never fail whatever wraps it — see the
// dashboard-sync wrapper wiring).
//
// SUPERSET GROUNDWORK (2026-07-17): the watchdog's write path detects ONE class
// — a period with ZERO rows (a run that never launched / was killed). The sibling
// check-drift.mjs owns two OTHER classes the watchdog historically ignored: a row
// exists but its newest Run Date is STALE (older than a threshold), or its Run
// Date is MALFORMED/absent (unparseable). To let a future consolidation collapse
// to a SINGLE superset detector, evaluateEntry now ALSO reports the freshness of
// the row(s) it finds for the expected period, routed through check-drift's OWN
// staleness core (newestRunDate + computeDrift) so both files share one definition
// of "stale". This is REPORT-ONLY and ADDITIVE: it never writes a miss-row, never
// changes the exit code, and never changes the absence→miss-row write path. See
// the detector-coverage-matrix test for the full class-by-class characterization.
//
// Reuses upsert.mjs (upsertReportRun, validateRun) + config.mjs (enums) +
// project-cards/lib/notion.mjs (queryDataSource) + check-drift.mjs (freshness
// core). ESM, no external deps.
import { pathToFileURL } from 'node:url';
import { queryDataSource } from '../project-cards/lib/notion.mjs';
import { REPORT_RUNS_DS_ID, REPORT_TYPES, PERIOD_FORMAT_BY_TYPE } from './config.mjs';
import { upsertReportRun } from './upsert.mjs';
import {
  newestRunDate, computeDrift, DEFAULT_MAX_AGE_HOURS, parseMaxAgeHours,
} from './check-drift.mjs';

// --- declarative schedule (pure data) -------------------------------------------
// weekday: JS Date#getDay() convention (Sun=0 .. Sat=6). Thursday=4, Friday=5.
// grace: local {h,m} the deadline+grace window ends at, on the CANDIDATE day's
//   calendar date (see computeCandidate below for exactly which date that is).
// periodFormat: 'isoWeek' (VP Weekly only, real-pipeline format) | 'date'.
// crossesMidnight: the expected period isn't complete until end of day, so the
//   watchdog run on day D checks day D-1's period (see module doc above).
export const SCHEDULE = [
  {
    type: 'VP Weekly', source: 'AIWeeklyReport', cadence: 'weekly', weekday: 4,
    grace: { h: 12, m: 0 }, periodFormat: 'isoWeek', crossesMidnight: false,
  },
  {
    type: 'FourthOS Sponsor', source: 'FourthOS-Weekly', cadence: 'weekly', weekday: 4,
    grace: { h: 12, m: 0 }, periodFormat: 'date', crossesMidnight: false,
  },
  {
    type: 'System Health', source: 'Health-Check', cadence: 'weekly', weekday: 5,
    grace: { h: 14, m: 0 }, periodFormat: 'date', crossesMidnight: false,
  },
  {
    type: 'Team Dashboard', source: 'Dashboard-Sync', cadence: 'daily',
    grace: { h: 6, m: 0 }, periodFormat: 'date', crossesMidnight: true,
  },
  {
    type: 'Project Portfolio', source: 'Project-Cards', cadence: 'daily',
    grace: { h: 0, m: 0 }, periodFormat: 'date', crossesMidnight: true,
  },
  {
    type: 'Self-Improvement', source: 'Self-Improvement', cadence: 'daily',
    grace: { h: 12, m: 0 }, periodFormat: 'date', crossesMidnight: false,
  },
];

// --- watchdog parity (proposal 08, 2026-07-17) -----------------------------------
// Registry convention: every new pipeline ships with a watchdog schedule entry on
// day one — a report type that exists in REPORT_TYPES but has no SCHEDULE entry
// is invisible to the silent-miss detector. Pure, exported for tests.
export function scheduleMissingTypes(schedule = SCHEDULE) {
  const covered = new Set(schedule.map((e) => e.type));
  return REPORT_TYPES.filter((t) => !covered.has(t));
}

// Registry convention: one period format per cadence, single source of truth =
// config.mjs PERIOD_FORMAT_BY_TYPE. The schedule's own `periodFormat` field is
// kept (it drives formatPeriod()) but must never independently drift from the
// config — this catches the drift instead of silently emitting the wrong
// period shape for a type. Pure, exported for tests.
export function scheduleFormatMismatches(schedule = SCHEDULE) {
  return schedule
    .filter((e) => PERIOD_FORMAT_BY_TYPE[e.type] !== e.periodFormat)
    .map((e) => ({ type: e.type, scheduled: e.periodFormat, expected: PERIOD_FORMAT_BY_TYPE[e.type] }));
}

// --- local-time date helpers (pure) ---------------------------------------------
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }
function atTime(d, { h, m }) {
  const c = new Date(d); c.setHours(h, m, 0, 0); return c;
}
function ymd(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

// ISO-8601 week number of `d` (Mon..Sun week, Thursday-rule). Matches
// PowerShell's `Get-Date -UFormat %V` used by the real VP Weekly wrapper.
export function isoWeekNumber(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (t.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  t.setUTCDate(t.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((t - firstThursday) / (7 * 86_400_000));
}

// The REAL VP Weekly wrapper formats `%Y-W%V` — %Y is the plain calendar year
// of the date (NOT the ISO week-year), %V is the ISO week number. Replicated
// exactly so the watchdog's expected period always matches what the pipeline
// itself would emit, including at year-boundary weeks.
export function isoWeekLabel(d) {
  return `${d.getFullYear()}-W${String(isoWeekNumber(d)).padStart(2, '0')}`;
}

export function formatPeriod(d, periodFormat) {
  return periodFormat === 'isoWeek' ? isoWeekLabel(d) : ymd(d);
}

// --- candidate/due computation (pure) -------------------------------------------
// Returns { due:false } when this entry's check is not applicable right now
// (a weekly type on the wrong weekday, or a daily/weekly type whose grace
// window for the current candidate day hasn't elapsed yet). Otherwise returns
// { due:true, candidate, graceEnd, period }.
export function computeCandidate(entry, now) {
  const today = startOfDay(now);
  if (entry.cadence === 'weekly') {
    if (now.getDay() !== entry.weekday) return { due: false };
    const graceEnd = atTime(today, entry.grace);
    if (now < graceEnd) return { due: false };
    return { due: true, candidate: today, graceEnd, period: formatPeriod(today, entry.periodFormat) };
  }
  // daily: crossesMidnight means the expected period is YESTERDAY (the day
  // isn't "complete" until the grace instant, which lands on TODAY regardless
  // of crossesMidnight — see module doc).
  const candidate = entry.crossesMidnight ? addDays(today, -1) : today;
  const graceEnd = atTime(today, entry.grace);
  if (now < graceEnd) return { due: false };
  return { due: true, candidate, graceEnd, period: formatPeriod(candidate, entry.periodFormat) };
}

// --- registry read (transport-injectable) ---------------------------------------
// All rows of `type` whose Period equals `period`, regardless of Status — a
// Warn/Failed row still proves the run LAUNCHED (that's a different, already
// visible failure mode); the write path only cares about total absence. The rows
// themselves are returned (not just a count) so the additive freshness assessment
// can inspect their Run Dates — see assessFreshness / the superset note up top.
export function rowsForPeriod(type, period, { dsId = REPORT_RUNS_DS_ID, query = queryDataSource } = {}) {
  return query(dsId, {
    filter: {
      and: [
        { property: 'Report Type', select: { equals: type } },
        { property: 'Period', rich_text: { equals: String(period) } },
      ],
    },
  }) || [];
}

// Presence-only convenience wrapper (unchanged public contract): true iff ANY row
// exists for the type+period, regardless of Status. This is the exact predicate
// the absence→miss-row write path keys off of.
export function hasRowForPeriod(type, period, opts = {}) {
  return rowsForPeriod(type, period, opts).length > 0;
}

// --- freshness of the present rows (superset groundwork, REPORT-ONLY) ------------
// Classifies the two check-drift classes the watchdog's presence check ignores:
//   'fresh'                 — newest Run Date within maxAgeHours
//   'stale'                 — newest Run Date older than maxAgeHours
//   'no-parseable-run-date' — malformed/absent Run Date (age unknowable)
// derived purely from the shape computeDrift returns (ageHours===null iff the
// newest date was unparseable/absent).
export function freshnessReason(drift) {
  if (!drift.drift) return 'fresh';
  return drift.ageHours === null ? 'no-parseable-run-date' : 'stale';
}

// Assess the freshness of a period's rows by routing the newest Run Date through
// check-drift's OWN computeDrift core (one shared definition of "stale"). Returns
// { newestRunDate, ageHours, stale, reason }. Pure; NEVER writes; NEVER throws for
// well-formed row arrays. `type` is only a computeDrift bucket key here (the rows
// are already period-scoped by rowsForPeriod), so a sentinel is fine.
export function assessFreshness(rows, { now = new Date(), maxAgeHours = DEFAULT_MAX_AGE_HOURS, type = '_watchdog' } = {}) {
  const newest = newestRunDate(rows);
  const [d] = computeDrift({ [type]: newest }, { maxAgeHours, now: now.getTime(), types: [type] });
  return {
    newestRunDate: d.newestRunDate, ageHours: d.ageHours, stale: d.drift, reason: freshnessReason(d),
  };
}

// --- miss-row builder (pure) -----------------------------------------------------
// Deterministic runId (no timestamp component) is the whole idempotency
// mechanism — see module doc.
export function buildMissRun(entry, period, now) {
  return {
    runId: `${entry.type}|${period}|watchdog-miss`,
    type: entry.type,
    period: String(period),
    runDate: now.toISOString(),
    status: 'Failed',
    source: entry.source,
    summary: `watchdog: no "${entry.type}" row found for period ${period} by its deadline+grace — the scheduled run likely never launched or was killed mid-flight`,
  };
}

// --- per-type evaluation (transport-injectable) ---------------------------------
// Returns one of:
//   { type, checked:false }                                        — not due / wrong day
//   { type, checked:true, period, status:'ok', freshness }          — a real row exists
//   { type, checked:true, period, status:'would-write'|'written'|'error', run, ... }
// The `freshness` field on the 'ok' result is the additive superset signal
// (stale/malformed classes). It is REPORT-ONLY — the status stays 'ok' and no
// miss-row is written for a stale/malformed present row (the write path is still
// absence-only), so existing callers/behavior are unchanged.
export function evaluateEntry(entry, now, {
  dsId = REPORT_RUNS_DS_ID, query = queryDataSource, upsert = upsertReportRun, dryRun = false,
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
} = {}) {
  const c = computeCandidate(entry, now);
  if (!c.due) return { type: entry.type, checked: false };

  let rows;
  try {
    rows = rowsForPeriod(entry.type, c.period, { dsId, query });
  } catch (e) {
    console.error(`[watchdog] ERROR querying "${entry.type}" period ${c.period} (non-fatal): ${e.message}`);
    return {
      type: entry.type, checked: true, period: c.period, status: 'error', error: e.message,
    };
  }

  if (rows.length > 0) {
    return {
      type: entry.type, checked: true, period: c.period, status: 'ok',
      freshness: assessFreshness(rows, { now, maxAgeHours, type: entry.type }),
    };
  }

  const run = buildMissRun(entry, c.period, now);
  if (dryRun) {
    return {
      type: entry.type, checked: true, period: c.period, status: 'would-write', run,
    };
  }
  try {
    const result = upsert(run, { dsId, query });
    return {
      type: entry.type, checked: true, period: c.period, status: 'written', run, result,
    };
  } catch (e) {
    console.error(`[watchdog] ERROR upserting miss-row for "${entry.type}" period ${c.period} (non-fatal): ${e.message}`);
    return {
      type: entry.type, checked: true, period: c.period, status: 'error', run, error: e.message,
    };
  }
}

// --- sweep (all types) -----------------------------------------------------------
export function runWatchdog({
  now = new Date(), dryRun = false, schedule = SCHEDULE,
  dsId = REPORT_RUNS_DS_ID, query = queryDataSource, upsert = upsertReportRun,
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
} = {}) {
  // Registry convention parity (proposal 08): warn loudly — but stay non-fatal,
  // this is an observability sweep that must always exit 0 — on any REPORT_TYPES
  // entry missing a schedule row, or a schedule entry whose periodFormat has
  // drifted from config.mjs's single source of truth.
  const missingTypes = scheduleMissingTypes(schedule);
  if (missingTypes.length) {
    console.error(`[watchdog] WARN: report type(s) with no watchdog schedule entry (registry convention: every pipeline ships with one on day one): ${missingTypes.join(', ')}`);
  }
  const formatMismatches = scheduleFormatMismatches(schedule);
  for (const m of formatMismatches) {
    console.error(`[watchdog] WARN: schedule periodFormat "${m.scheduled}" for "${m.type}" does not match config.mjs PERIOD_FORMAT_BY_TYPE "${m.expected}" (registry convention: one period format per cadence)`);
  }
  return schedule.map((entry) => evaluateEntry(entry, now, {
    dsId, query, upsert, dryRun, maxAgeHours,
  }));
}

// --- CLI ---------------------------------------------------------------------
function parseNow(argv) {
  const idx = argv.indexOf('--now');
  if (idx !== -1 && argv[idx + 1] != null) return new Date(argv[idx + 1]);
  const eq = argv.find((a) => a.startsWith('--now='));
  if (eq) return new Date(eq.slice('--now='.length));
  return new Date();
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const maxAgeHours = parseMaxAgeHours(argv);
  const now = parseNow(argv);
  if (Number.isNaN(now.getTime())) {
    throw new Error(`--now value did not parse to a valid date/time`);
  }

  const results = runWatchdog({ now, dryRun, maxAgeHours });

  console.log(`[watchdog] check instant: ${now.toISOString()} (local: ${now.toString()})`);
  for (const r of results) {
    if (!r.checked) {
      console.log(`  ${r.type}: not due (wrong weekday or grace window not yet elapsed)`);
      continue;
    }
    if (r.status === 'ok') {
      // Present-path: a row exists, so this is NOT a silent miss (no write). The
      // additive freshness verdict is REPORT-ONLY — a stale/malformed present row
      // is surfaced loudly but never written and never affects the exit code.
      if (r.freshness?.stale) {
        console.log(`  ${r.type}: OK-but-STALE — a row exists for period ${r.period}, but its newest Run Date is ${r.freshness.reason} (age=${r.freshness.ageHours ?? 'n/a'}h > ${maxAgeHours}h) [report-only, not written]`);
      } else {
        console.log(`  ${r.type}: OK — a row exists for period ${r.period} (age=${r.freshness?.ageHours ?? 'n/a'}h)`);
      }
    } else if (r.status === 'would-write') {
      console.log(`  ${r.type}: MISSING for period ${r.period} — [DRY-RUN] would upsert:`);
      console.log(`    ${JSON.stringify(r.run)}`);
    } else if (r.status === 'written') {
      console.log(`  ${r.type}: MISSING for period ${r.period} — wrote miss-row (${r.result?.action}, page ${r.result?.pageId})`);
    } else if (r.status === 'error') {
      console.log(`  ${r.type}: ERROR checking period ${r.period} — ${r.error}`);
    }
  }

  const missing = results.filter((r) => r.checked && (r.status === 'would-write' || r.status === 'written'));
  const stale = results.filter((r) => r.checked && r.status === 'ok' && r.freshness?.stale);
  console.error(`[watchdog] ${dryRun ? 'DRY-RUN ' : ''}done — checked=${results.filter((r) => r.checked).length}/${results.length}, missing=${missing.length}${missing.length ? ': ' + missing.map((m) => `${m.type}(${m.period})`).join(', ') : ''}, stale=${stale.length}${stale.length ? ': ' + stale.map((m) => `${m.type}(${m.period})`).join(', ') : ''}`);
  // Non-fatal by contract: this is an observability sweep, never a gate. The
  // stale/malformed superset signal is REPORT-ONLY and does NOT change this.
  process.exit(0);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    main();
  } catch (e) {
    console.error(`[watchdog] FATAL: ${e.message}`);
    process.exit(2);
  }
}
