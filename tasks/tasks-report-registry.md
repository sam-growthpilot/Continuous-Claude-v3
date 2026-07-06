# Tasks — Report Runs Registry (Phase 2 of the Notion Reports Home plan)

Plan: `C:\Users\david.hayes\.claude\plans\i-want-to-better-enumerated-thunder.md`
Notion IDs (already built, Phase 1): `scripts/report-registry/report-runs.ids.json`
Reuse: `scripts/project-cards/lib/notion.mjs` (`runNtn`, `queryDataSource`, `createPage`, absolute `NTN_EXE`).

Ordering = tracer bullet: prove the spine end-to-end (T1) before layering pipelines/backfill.

## T1.0 — Registry core (tracer bullet)  [agent: kraken]
- `scripts/report-registry/config.mjs` — load IDs from `report-runs.ids.json`; export `REPORT_RUNS_DS_ID`, `REPORT_RUNS_DB_ID`, `REPORT_CHILD_PAGES`, `REPORT_TYPES`, `STATUSES`, `SOURCE_BY_TYPE`, `REPORT_RUN_KEYS`.
- `scripts/report-registry/upsert.mjs` — reads a `report-run.json` (path arg or stdin), validates against `REPORT_RUN_KEYS`, **upserts by unique `Run ID`**: `queryDataSource(DS, filter Run ID == runId)` → if found update-page-properties, else `createPage`. Append-all-attempts (distinct runId ⇒ new row). **Non-fatal-but-loud**: on any failure log `[report-registry] …` to stderr and exit the *registry step* nonzero, but never throw in a way that fails a caller that ignores exit code.
- Add an **update-page-properties** helper to `lib/notion.mjs` (PATCH `v1/pages/<id>` with properties) — reuse `runNtn`.
- CLI: `node upsert.mjs <report-run.json>` and `node upsert.mjs --emit '<json>'`.
- **Verify (real Notion):** upsert a temp runId ⇒ 1 row; same runId ⇒ still 1 (update); new runId same period ⇒ 2 rows (append); then trash the temp rows (`in_trash:true`). Confirm via `ntn datasources query`.

## T2.0 — report-run.json emit contract  [agent: kraken]
- Pin the schema doc in `scripts/report-registry/README.md` (keys, runId = `<type>|<period>|<ISO-ts>`, examples). This is the versioned contract the out-of-repo `ai-report-card` codes against.
- Helper `scripts/report-registry/make-run.mjs` (build+write a valid `report-run.json` to `$TEMP/report-run-<source>.json`) so pipelines don't hand-roll JSON.

## T3.x — Wire the 6 pipelines (emit → upsert)  [kraken; can parallelize by pipeline]
- T3.1 Project-Cards: `sweep.mjs` emits report-run.json; `run-sweep.ps1` calls upsert (node-native, easiest — do first with T1).
- T3.2 AIWeeklyReport: `ai-report-card/scripts/weekly_run.py` writes report-run.json after deploy; `run-ai-weekly-report.bat` calls upsert via an **absolute node path**.
- T3.3 FourthOS-Weekly: extend `generate-prompt.md` to emit report-run.json; `scheduled-fourthos-weekly.bat` reads it + upsert (absolute node).
- T3.4 Dashboard-Sync: extend `sync-tasks-dashboard-prompt.md` to emit; `sync-tasks-dashboard.ps1` upsert + **add trailing `exit $LASTEXITCODE`** (currently swallowed).
- T3.5 Health-Check: `scheduled-health-check.bat` maps 0/1/2/3 → Status, emits + upsert.
- T3.6 Self-Improvement: `run-research.ps1` upsert in the **parent PS process after `claude -p` exits** (ntn keychain auth via absolute exe; NOTION_* already scrubbed — that's fine).

## T4.x — Backfill + drift detector  [kraken]
- T4.1 `scripts/report-registry/backfill.mjs` — seed rows from `ai-report-card/output/archive/*`, `ai-enablement-decks/decks.json` (`sponsor-updates`), `docs/self-improvement/INDEX.md`, `.claude/cache/health-checks/*`; synthesize runIds, normalize Period.
- T4.2 Missing-row detector (fold into `health_check.py` or standalone) — flag any scheduled report whose last success has no registry row within N hours.

## Not in scope (deferred)
- Phase 3 hybrid "Current run" preview embeds (MCP, size-gated).
- Hub `📥 Latest reports` launcher rewrite (human-territory edit; do deliberately later).
- View repositioning under `## History` headings (cosmetic; create-view appends at page-bottom).
