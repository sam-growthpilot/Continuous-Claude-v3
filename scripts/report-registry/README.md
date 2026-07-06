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
  appends a new row, the same runId updates its row in place).
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
const path = writeRun(run, { source: 'Project-Cards' }); // -> $TEMP/report-run-Project-Cards.json
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
callers wrap it so that nonzero exit never reddens the parent report run. A
Phase-4 missing-row detector catches any resulting drift.
