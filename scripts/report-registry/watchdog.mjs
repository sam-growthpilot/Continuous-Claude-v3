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
// Reuses upsert.mjs (upsertReportRun, validateRun) + config.mjs (enums) +
// project-cards/lib/notion.mjs (queryDataSource). ESM, no external deps.
import { pathToFileURL } from 'node:url';
import { queryDataSource } from '../project-cards/lib/notion.mjs';
import { REPORT_RUNS_DS_ID } from './config.mjs';
import { upsertReportRun } from './upsert.mjs';

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
// Any row of `type` whose Period equals `period`, regardless of Status — a
// Warn/Failed row still proves the run LAUNCHED (that's a different, already
// visible failure mode); the watchdog only cares about total absence.
export function hasRowForPeriod(type, period, { dsId = REPORT_RUNS_DS_ID, query = queryDataSource } = {}) {
  const rows = query(dsId, {
    filter: {
      and: [
        { property: 'Report Type', select: { equals: type } },
        { property: 'Period', rich_text: { equals: String(period) } },
      ],
    },
  }) || [];
  return rows.length > 0;
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
//   { type, checked:false }                              — not due yet / wrong day
//   { type, checked:true, period, status:'ok', ... }      — a real row exists
//   { type, checked:true, period, status:'would-write'|'written'|'error', run, ... }
export function evaluateEntry(entry, now, {
  dsId = REPORT_RUNS_DS_ID, query = queryDataSource, upsert = upsertReportRun, dryRun = false,
} = {}) {
  const c = computeCandidate(entry, now);
  if (!c.due) return { type: entry.type, checked: false };

  let present;
  try {
    present = hasRowForPeriod(entry.type, c.period, { dsId, query });
  } catch (e) {
    console.error(`[watchdog] ERROR querying "${entry.type}" period ${c.period} (non-fatal): ${e.message}`);
    return {
      type: entry.type, checked: true, period: c.period, status: 'error', error: e.message,
    };
  }

  if (present) {
    return {
      type: entry.type, checked: true, period: c.period, status: 'ok',
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
} = {}) {
  return schedule.map((entry) => evaluateEntry(entry, now, {
    dsId, query, upsert, dryRun,
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
  const now = parseNow(argv);
  if (Number.isNaN(now.getTime())) {
    throw new Error(`--now value did not parse to a valid date/time`);
  }

  const results = runWatchdog({ now, dryRun });

  console.log(`[watchdog] check instant: ${now.toISOString()} (local: ${now.toString()})`);
  for (const r of results) {
    if (!r.checked) {
      console.log(`  ${r.type}: not due (wrong weekday or grace window not yet elapsed)`);
      continue;
    }
    if (r.status === 'ok') {
      console.log(`  ${r.type}: OK — a row exists for period ${r.period}`);
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
  console.error(`[watchdog] ${dryRun ? 'DRY-RUN ' : ''}done — checked=${results.filter((r) => r.checked).length}/${results.length}, missing=${missing.length}${missing.length ? ': ' + missing.map((m) => `${m.type}(${m.period})`).join(', ') : ''}`);
  // Non-fatal by contract: this is an observability sweep, never a gate.
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
