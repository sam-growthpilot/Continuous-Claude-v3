# Report Runs registry — the `report-run.json` contract

This directory is the **spine** that records every reporting-pipeline run (VP
Weekly, FourthOS Sponsor, Team Dashboard, System Health, Project Portfolio,
Self-Improvement) as a row in one Notion database, so the history of *what ran,
when, and whether it landed* is queryable in one place.

- **Canonical IDs:** `report-runs.ids.json` (Notion DB / data-source / hub ids,
  the enums, and this contract). Loaded by `config.mjs`.
- **Emit:** `make-run.mjs` — build + write a valid `report-run.json`.
- **Upsert:** `upsert.mjs` — read one `report-run.json` and UPSERT it into the DB
  keyed by the unique `Run ID` (append-all-attempts; a distinct runId always
  appends a new row, the same runId updates its row in place). The CREATE path is
  **idempotent under retries** (T5.1): a transient create failure may have already
  committed server-side, so before retrying the upsert re-queries by `Run ID` and
  **adopts** an existing row instead of blindly creating a duplicate.
- **Backfill:** `backfill.mjs` — seed the DB from existing on-disk history (VP
  archives, Sponsor decks, Self-Improvement index, System Health reports). Uses
  **deterministic** runIds (`<type>|<period>|<stable-marker>`) so re-running
  upserts in place and never duplicates. `--dry-run` previews without writing.
- **Drift:** `check-drift.mjs` — READ-ONLY freshness check. Flags any report type
  whose newest registry row is older than `--max-age-hours` (default 48) or has no
  rows at all; exits nonzero on any drift (health-check gateable).
- **Data source:** `c7d2d9e3-d388-4640-a66e-88f7dd50f854`.

The out-of-repo `ai-report-card` codebase (and any future pipeline) codes against
**this file** — it is the versioned contract. Treat the key set + `runId` format
as stable; add keys additively (the upsert warns on unknown keys but does not
fail, so a new field is forward-compatible while pipelines catch up).

## Schema (v1)

`report-run.json` is a single flat JSON object.

| Key           | Req? | Type   | Notes |
|---------------|------|--------|-------|
| `runId`       | yes  | string | Idempotency key. `` `<type>|<period>|<ISO-timestamp>` ``. The ISO-timestamp component **is** `runDate`. `make-run.mjs` computes this — pipelines should not hand-build it. |
| `type`        | yes  | enum   | One of `REPORT_TYPES`: `VP Weekly`, `FourthOS Sponsor`, `Team Dashboard`, `System Health`, `Project Portfolio`, `Self-Improvement`. |
| `period`      | yes  | string | Grouping label, **not** unique. Weekly reports use ISO week (`2026-W27`); daily reports use an ISO date (`2026-07-05`). |
| `runDate`     | yes  | string | ISO timestamp of the run. Defaults to now when omitted at build time. Also the `runId` timestamp component. |
| `status`      | yes  | enum   | One of `STATUSES`: `OK`, `Warn`, `Failed`, `Skipped`. |
| `source`      | yes  | string | Originating scheduled job (the `Source` select). Canonical values live in `sourceByType` — e.g. `Project-Cards`, `AIWeeklyReport`, `Dashboard-Sync`. |
| `artifactUrl` | no   | url    | Link to the published report/dashboard/hub. |
| `docxUrl`     | no   | url    | Link to a generated doc/deck, when the pipeline produces one. |
| `summary`     | no   | string | One-line headline for the run (counts, verdict). |
| `commit`      | no   | string | Git commit the run was produced from, when applicable. |

`Attempt` (a number property on the DB) is optional and accepted on input, but
pipelines normally omit it — the append-all-attempts model already records every
attempt as its own row.

### runId rules

- Format: `` `<type>|<period>|<ISO-timestamp>` `` with `|` (pipe) separators.
- The timestamp is the run's `runDate`. **Re-emitting with the same `runDate`
  updates the same row** (idempotent retry); a fresh `runDate` appends a new row.
- `period` is deliberately NOT unique — many runs share a period.

## Worked examples (one per Status)

**OK** — a clean daily Project-Cards sweep:

```json
{
  "runId": "Project Portfolio|2026-07-05|2026-07-05T13:30:00.000Z",
  "type": "Project Portfolio",
  "period": "2026-07-05",
  "runDate": "2026-07-05T13:30:00.000Z",
  "status": "OK",
  "source": "Project-Cards",
  "artifactUrl": "https://www.notion.so/38f76fd7ac8280478e50dd2956ba6e8a",
  "summary": "cards refreshed=8 · published=3 · failed=0 · hub=ok · cockpit=ok"
}
```

**Warn** — the sweep ran but a card publish or the hub refresh degraded:

```json
{
  "runId": "Project Portfolio|2026-07-05|2026-07-05T13:30:00.000Z",
  "type": "Project Portfolio",
  "period": "2026-07-05",
  "runDate": "2026-07-05T13:30:00.000Z",
  "status": "Warn",
  "source": "Project-Cards",
  "artifactUrl": "https://www.notion.so/38f76fd7ac8280478e50dd2956ba6e8a",
  "summary": "cards refreshed=8 · published=2 · failed=1 · hub=ok · cockpit=fail"
}
```

**Failed** — a fatal throw aborted the run:

```json
{
  "runId": "VP Weekly|2026-W27|2026-07-09T06:00:00.000Z",
  "type": "VP Weekly",
  "period": "2026-W27",
  "runDate": "2026-07-09T06:00:00.000Z",
  "status": "Failed",
  "source": "AIWeeklyReport",
  "summary": "narrator threw: collect_all_data timeout",
  "commit": "244d5a5"
}
```

**Skipped** — nothing to do this cycle (e.g. no changes, or a lock-skip):

```json
{
  "runId": "System Health|2026-07-05|2026-07-05T09:00:00.000Z",
  "type": "System Health",
  "period": "2026-07-05",
  "runDate": "2026-07-05T09:00:00.000Z",
  "status": "Skipped",
  "source": "Health-Check",
  "summary": "no health check due this cycle"
}
```

## Usage

### From a node pipeline

```js
import { buildRun, writeRun } from '../report-registry/make-run.mjs';

const run = buildRun({
  type: 'Project Portfolio',
  period: new Date().toISOString().slice(0, 10),
  status: 'OK',
  source: 'Project-Cards',
  artifactUrl: 'https://www.notion.so/38f76fd7ac8280478e50dd2956ba6e8a',
  summary: 'cards refreshed=8 · published=3 · failed=0 · hub=ok · cockpit=ok',
});
const path = writeRun(run); // -> $TEMP/report-run-Project-Cards.json (derived from run.source)
```

### From a shell / PowerShell wrapper

```
node scripts/report-registry/make-run.mjs \
  --type "Project Portfolio" --period 2026-07-05 \
  --status OK --source Project-Cards \
  --summary "cards refreshed=8"
```

The written path is printed to **stdout** (progress goes to stderr). Then hand it
to the upsert — wrap the call so a registry outage can NEVER fail the parent run:

```
node scripts/report-registry/upsert.mjs "$TEMP\report-run-Project-Cards.json"
```

`upsert.mjs` is **non-fatal-but-loud**: on any failure it prints
`[report-registry] ERROR: …` and exits nonzero, and the DESIGN INTENT is that
callers wrap it so that nonzero exit never reddens the parent report run. The
drift detector (below) catches any resulting missing-row drift.

**Event-driven hub (optimization 02, 2026-07-16):** after a SUCCESSFUL write, the
upsert CLI automatically runs `refresh-pages.mjs --type "<run.type>"` — a SCOPED
refresh of that type's child page plus the hub launcher — so the registry and its
Notion surfaces can never disagree for longer than one write. The refresh is
strictly non-fatal (any failure is logged; the upsert's exit code is unchanged).
Opt out with `--no-refresh` for bulk callers that refresh once at the end. Note
`backfill.mjs` and `watchdog.mjs` import `upsertReportRun` directly, so they do
NOT auto-refresh — run `refresh-pages.mjs` manually after a bulk backfill.

### Backfill (one-time / repeatable history seed)

```
node scripts/report-registry/backfill.mjs --dry-run   # preview counts, no writes
node scripts/report-registry/backfill.mjs             # upsert real historical rows
```

Idempotent: every backfilled row has a deterministic runId keyed to its source
artifact (archive folder / deck id / proposal file / health file stem), so a
re-run updates in place and the DS row count is unchanged. These rows are **real,
permanent history** — do not trash them.

### Drift detection (scheduler / health-check gate)

```
node scripts/report-registry/check-drift.mjs                     # 48h threshold
node scripts/report-registry/check-drift.mjs --max-age-hours 72
```

Prints a JSON array of `{ type, newestRunDate, ageHours, drift }` per report type
and exits **nonzero** if any type is in drift (stale beyond the threshold, or has
no rows at all). Read-only — it only queries the DS.

## Registry conventions (proposal 08, 2026-07-17)

Four conventions that earlier fixes established informally are now codified and
enforced. `config.mjs` is the single source of truth for the shapes; `make-run.mjs`
is where pipeline-facing emits get validated.

1. **Corrective-row prefix.** A row that RE-EMITS an old period under today's Run
   Date (a manual `backfill`/`remap` correction) must carry a summary that starts
   with `backfill:` or `remap:` (`config.mjs CORRECTIVE_PREFIX_RE`, case-insensitive).
   `refresh-pages.mjs`'s `pickNewest()` relies on exactly this prefix to exclude
   corrective rows from "Current run" (see the 2026-07-16 remap-proof fix — without
   the prefix, a correction of old history would present itself as today's run).
   Enforced in `buildRun()` (`make-run.mjs`) **bidirectionally**: pass
   `corrective: true` (CLI: `--corrective`) and it REQUIRES the prefix; a summary
   that happens to start with the prefix WITHOUT `corrective: true` is also
   rejected, so an accidental "backfill: ..." wording can't silently opt a normal
   run out of "Current run" consideration. `backfill.mjs` and `watchdog.mjs` build
   run objects directly (they don't call `buildRun()`), so this guard covers
   pipeline emits through the normal `make-run.mjs` path — not those two scripts'
   own summaries.

2. **Durable artifact URLs.** `artifactUrl`/`docxUrl` must outlive promotion —
   they're read back from Notion long after the run's temp workspace is gone, so a
   local filesystem path or `file:` URL is worthless once the row is written (and
   `upsert.mjs` already silently drops non-URL values rather than 400 the whole
   row). `buildRun()` now rejects a non-`http(s)` `artifactUrl`/`docxUrl` at EMIT
   time (`config.mjs HTTP_URL_RE`) instead of letting it be silently dropped later.

3. **One period format per cadence.** `config.mjs PERIOD_FORMAT_BY_TYPE` pins
   exactly one period shape per report type: `isoWeek` (`YYYY-Www`, e.g.
   `2026-W29`) for **VP Weekly only** — the documented lone exception — and `date`
   (`YYYY-MM-DD`) for every other type. `buildRun()` validates `--period`/`period`
   against the type's format and throws on a mismatch (e.g. a date-shaped period
   for VP Weekly, or an ISO-week period for anything else).

4. **Watchdog parity.** Every entry in `config.mjs REPORT_TYPES` must have a
   corresponding entry in `watchdog.mjs SCHEDULE` — a type with no schedule entry
   is invisible to the silent-miss detector. `watchdog.mjs` exports
   `scheduleMissingTypes()` (asserted empty by a test) and `runWatchdog()` prints a
   non-fatal `WARN` to stderr on any gap (the watchdog's contract is always-exit-0
   observability, so this is a loud warning, not a thrown error). A companion
   `scheduleFormatMismatches()` cross-checks each schedule entry's `periodFormat`
   against convention 3's `PERIOD_FORMAT_BY_TYPE`, so the schedule can't silently
   drift from the single source of truth either.

See `scripts/report-registry/test/conventions.test.mjs` for the enforcement tests.

## Reporting Health strip + trust metrics (proposals 05 + 09, 2026-07-17)

The hub launcher (`## 🗂 Report pages`) is now a single machine-owned "Reporting
Health" surface: a wider table plus an appended weekly trust-metrics rollup, all
written and replaced idempotently by `refresh-pages.mjs`'s existing section-splice
(same `HUB_LAUNCHER_HEADING` section as before — nothing new to lock or splice).

### Hub table columns

| Column | Source |
|---|---|
| Report | link to the type's child page |
| Status | the newest genuine row's `Status` (`pickNewest()`; corrective rows excluded) |
| Run date | that row's `Run Date` |
| Artifact | that row's `Artifact URL`, if http(s) |
| Next expected | `watchdog.mjs`'s `SCHEDULE` — the next deadline+period this type is due, via `nextExpectedDeadline()` (the SAME schedule the real silent-miss watchdog checks against) |
| Log | a STATIC per-type hint at that pipeline's own wrapper log location (`config.mjs LOG_HINT_BY_TYPE` — cheap by design, not a live filesystem lookup; update the map if a wrapper's log dir moves) |
| Watchdog | `refresh-pages.mjs`'s `watchdogVerdict()` — one of `present` / `stale` / `missing` / `no runs` / `unscheduled` (see below) |

**Watchdog verdict definitions** (`watchdogVerdict(type, run, opts)`):
- `missing` — the newest known row's Summary carries the `watchdog:` prefix
  (`watchdog.mjs WATCHDOG_MISS_PREFIX_RE` / `isWatchdogMissRow()`) — i.e. the last
  thing the registry knows about this type IS a synthesized silent-miss row.
- `stale` — a real row exists but its Run Date is older than `maxAgeHours`
  (default 48h, `check-drift.mjs`'s `computeDrift()` — the SAME staleness
  definition check-drift.mjs and watchdog.mjs's report-only freshness signal
  already share).
- `present` — a real, fresh row exists.
- `no runs` — the type has zero registry rows at all.
- `unscheduled` — the type has no `watchdog.mjs SCHEDULE` entry (a proposal-08
  watchdog-parity violation; should never happen in practice).

### Trust-metrics rollup (`trust-metrics.mjs`)

A pure module (`computeTrustMetrics()`) that measures the registry against
itself over a lookback window (default `DEFAULT_LOOKBACK_WEEKS = 4`):

- **Expected-vs-landed per week** — for each Mon-Sun week bucket in the window,
  sums across every `SCHEDULE` entry the number of periods whose deadline has
  elapsed (`expectedPeriodsInWeek()`, reusing `watchdog.mjs`'s `candidateForDay()`
  so this can never diverge from what the real watchdog itself checks) against
  the number of those periods with a genuine landed row (excludes both
  `watchdog:`-prefixed miss-rows and `backfill:`/`remap:` corrective rows from
  "landed" — see proposal 08's conventions above). `gap = expected - landed`.
- **`silentMissCount`** — count of `watchdog:`-prefixed rows within the lookback
  window (**target: zero**). Each one is a run that the watchdog itself had to
  synthesize because nothing else ever landed for that period.
- **`meanTimeToDetectionHours`** — mean(miss-row's `Run Date` − the expected
  deadline it detected), computed via `expectedDeadlineForPeriod()` (the
  INVERSE of `candidateForDay()`). **Only computable for `date`-format periods**
  — VP Weekly's `isoWeek` period has no single unambiguous calendar day to
  reverse to, so those samples are honestly EXCLUDED (`ttdSampleCount` reflects
  this), never fabricated as zero or averaged in incorrectly.
- **`correctiveRowRate`** — `backfill:`/`remap:`-prefixed rows as a fraction of
  all rows in the window (`config.mjs CORRECTIVE_PREFIX_RE`).

Rendered as 3 compact paragraphs (`renderTrustRollupBlocks()`) appended to the
SAME hub `## 🗂 Report pages` section body — one surface, not a second one — by
`refresh-pages.mjs`'s CLI, which computes the summary via a best-effort,
non-fatal live read (`computeHubTrustSummary()`) before every hub refresh.

Standalone CLI:

```
node scripts/report-registry/trust-metrics.mjs                 # human-readable, 4-week window
node scripts/report-registry/trust-metrics.mjs --json           # JSON summary
node scripts/report-registry/trust-metrics.mjs --weeks 8        # custom lookback
```

### Human-section freshness (reviewed-date stamp convention)

`trust-metrics.mjs`'s CLI also runs a best-effort, non-fatal freshness check on
the Reports hub's HUMAN-authored sections (everything on the hub that isn't the
machine-owned `🗂 Report pages` table) — it never edits a human section, only
reads and reports:

- **Convention:** a human section adopts freshness tracking by including the
  literal text `Reviewed: YYYY-MM-DD` anywhere in its body (e.g. as a trailing
  note under the section heading). `trust-metrics.mjs REVIEWED_DATE_RE` is the
  exact pattern matched.
- A section with **no stamp** is reported `unstamped: true` — a WARN inviting
  adoption, not an error (the convention is opt-in until a human adds the first
  stamp).
- A stamped section older than `HUMAN_SECTION_MAX_AGE_DAYS` (default 30) is
  reported `stale: true`.

### What remains manual (deferred, by design)

- **Deleting the superseded 7/02 hub callouts** — a live-surface edit to
  pre-existing hub content, out of scope for this machine-owned strip (the
  orchestrator/human handles cleaning up stale hand-written callouts).
  `buildHubLauncherBlocks()`'s section-splice REPLACES the machine-owned strip
  section idempotently on every run, so stale MACHINE content can never persist
  — only the old human callouts need a one-time manual removal.
- **Team Dashboard child-page rollup** — proposal 09 floated a rollup embedded
  on the Team Dashboard child page too; the hub strip is the single surface for
  now. A future pass can mirror the same `renderTrustRollupBlocks()` output onto
  that page's own section once there's a concrete need for a second view.

See `scripts/report-registry/test/trust-metrics.test.mjs` for the full behavior
matrix (week-bucket math, expected-vs-landed, time-to-detection reconstruction,
corrective-rate, and the freshness checker).
