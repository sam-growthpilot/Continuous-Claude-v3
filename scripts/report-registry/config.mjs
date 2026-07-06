// config.mjs — single source of truth for the Report Runs registry spine.
// Loads the canonical Notion IDs from report-runs.ids.json (built Phase 1) and
// re-exports them as named constants for the upsert + downstream wiring.
// ESM, no external deps. Path resolves relative to THIS module, so it is correct
// no matter which cwd the entry scripts are invoked from.
//
// Model = append-all-attempts. Idempotency key = `Run ID` (unique). A retry of
// the SAME run (identical runId) updates its row; a NEW run appends a new row.
// `Period` is a grouping field, NOT unique.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// report-registry ROOT (this dir).
export const ROOT = dirname(fileURLToPath(import.meta.url));

// Canonical IDs captured by Phase 1 (2026-07-05). Single source of truth.
export const IDS_PATH = join(ROOT, 'report-runs.ids.json');

const ids = JSON.parse(readFileSync(IDS_PATH, 'utf8'));

// --- Notion object ids ---
// Persist ALL THREE (mitigation #5): the container DB id (view repair needs it),
// the data source id (query/create target under the 2025-09-03 API), and the hub.
export const REPORT_RUNS_DB_ID = ids.reportRunsDatabaseId;
export const REPORT_RUNS_DS_ID = ids.reportRunsDataSourceId;
export const REPORTS_HUB_PAGE_ID = ids.reportsHubPageId;

// The 6 report child pages (one per report type) and the 7 linked views.
export const REPORT_CHILD_PAGES = ids.childPages;
export const REPORT_RUNS_VIEWS = ids.reportRunsViews;

// --- enumerations (validated by the upsert) ---
export const REPORT_TYPES = ids.reportTypes;
export const STATUSES = ids.statuses;
// type -> originating scheduled job (Source select value). Callers that omit an
// explicit `source` in report-run.json can derive it from the report type.
export const SOURCE_BY_TYPE = ids.sourceByType;
// The KNOWN Source select values (dedup of SOURCE_BY_TYPE's values). The upsert +
// make-run validate `source` against this set so a typo can't mint a stray Notion
// select option (T6.1 #4). Single source of truth = SOURCE_BY_TYPE.
export const SOURCES = [...new Set(Object.values(SOURCE_BY_TYPE))];

// --- report-run.json contract keys (Phase 2a) ---
// runId = `<type>|<period>|<ISO-timestamp>`. Required vs optional split lives in
// upsert.mjs; this is the full key set the pipelines emit.
export const REPORT_RUN_KEYS = ids.reportRunContract.keys;

// --- ntn CLI (absolute winget exe — solves the ntn-PATH problem) ---
// Re-exported for callers that want the exe path without importing project-cards
// config. lib/notion.mjs already enforces the non-interactive contract around it.
export const NTN_EXE = 'C:/Users/david.hayes/AppData/Local/Microsoft/WinGet/Packages/Notion.ntn_Microsoft.Winget.Source_8wekyb3d8bbwe/ntn-x86_64-pc-windows-msvc/ntn.exe';
