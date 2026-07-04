// config.mjs — single source of truth for the living project-card engine.
// Every id, path, and section-heading string previously copy-pasted across
// refresh.mjs / sweep.mjs / lib/notion.mjs lives here. ESM, no deps.
//
// Paths resolve relative to the project-cards ROOT (the parent of lib/), so they
// are correct no matter which cwd the entry scripts are invoked from.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// lib/ -> project-cards ROOT
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// --- filesystem paths ---
export const LIB_DIR = join(ROOT, 'lib');
export const OUT_DIR = join(ROOT, 'out');
export const LOGS_DIR = join(ROOT, 'logs');
export const STATE_PATH = join(ROOT, 'state.json');
export const REFRESH_PATH = join(ROOT, 'refresh.mjs');
export const SWEEP_PATH = join(ROOT, 'sweep.mjs');
export const TEMPLATE_PATH = join(ROOT, 'template.html');
export const SWEEP_LOG_PATH = join(LOGS_DIR, 'sweep.jsonl');

// --- ntn CLI ---
// Absolute winget package exe. lib/notion.mjs enforces the non-interactive
// contract (closed stdin, timeout, windowsHide, fail-loud) around this exe.
export const NTN_EXE = 'C:/Users/david.hayes/AppData/Local/Microsoft/WinGet/Packages/Notion.ntn_Microsoft.Winget.Source_8wekyb3d8bbwe/ntn-x86_64-pc-windows-msvc/ntn.exe';

// --- FourthOS Notion data source ids (databases) ---
export const PROJECTS_DS = '852a60e1-9fa6-4361-9b55-1a9f59d566d8';
export const DECISIONS_DS = 'e209f0f0-e7a6-45f1-9d2d-bc97d9811d60';

// --- Reporting Hub (hosts the shared project-card gallery) ---
export const REPORTING_HUB_PAGE_ID = '38f76fd7ac8280478e50dd2956ba6e8a';

// --- section headings (matched verbatim by the MCP publish/hub steps) ---
export const CARD_SECTION_HEADING = '## 📊 Living Status Card';
export const HUB_SECTION_HEADING = '## 📇 FourthOS Project Cards';

// --- timeouts (ms) ---
export const NTN_TIMEOUT_MS = 30000;
export const REFRESH_TIMEOUT_MS = 120000;
export const CLAUDE_TIMEOUT_MS = 300000; // 5 min per headless claude publish

// --- state schema version ---
// Bump when the per-card shape changes in a way that needs migration.
export const STATE_VERSION = 1;

// CCv3 is the engine's pilot but is NOT a FourthOS Projects-DB row, so it is
// merged into the hub gallery from this static list rather than the live query.
export const STATIC_EXTRA_CARDS = [
  {
    projectName: 'CCv3 (pilot)',
    health: 'Green',
    status: 'Active',
    hostKind: 'notion',
    url: 'https://app.notion.com/p/39276fd7ac8281c697b8dc65e42168cb',
  },
];
