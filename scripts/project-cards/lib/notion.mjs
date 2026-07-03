// notion.mjs — thin, deterministic wrapper over the Notion CLI (`ntn`).
// ESM, no external deps. Honors the ntn non-interactive contract on every call:
//   absolute exe, empty/closed stdin (input), hard timeout, windowsHide, fail-loud.
// See docs/notion-platform-spike-report.md and .claude/rules/notion-cli-safety.md.
import { spawnSync } from 'node:child_process';

const NTN = 'C:/Users/david.hayes/AppData/Local/Microsoft/WinGet/Packages/Notion.ntn_Microsoft.Winget.Source_8wekyb3d8bbwe/ntn-x86_64-pc-windows-msvc/ntn.exe';

// FourthOS data source ids (databases).
export const PROJECTS_DS = '852a60e1-9fa6-4361-9b55-1a9f59d566d8';
export const DECISIONS_DS = 'e209f0f0-e7a6-45f1-9d2d-bc97d9811d60';

// Run ntn with the contract enforced. `input` is fed to stdin then closed so ntn
// never blocks waiting on an open pipe. Throws with stderr context on any failure.
function runNtn(args, { input = '' } = {}) {
  const res = spawnSync(NTN, args, {
    input,
    timeout: 30000,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) throw new Error(`ntn spawn failed [${args.join(' ')}]: ${res.error.message}`);
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || '').trim();
    throw new Error(`ntn exited ${res.status} [${args.join(' ')}]: ${detail}`);
  }
  return res.stdout;
}

export function ntnVersion() {
  return runNtn(['--version']).trim();
}

// POST a JSON body to a raw API path; parse and return the response object.
function apiPost(path, body) {
  const out = runNtn(['api', path, '-X', 'POST'], { input: JSON.stringify(body) });
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`ntn api ${path} returned non-JSON: ${out.slice(0, 400)}`);
  }
}

// Query the Projects data source. filter/sorts are raw Notion query objects.
export function queryProjects({ filter, sorts, pageSize = 100 } = {}) {
  const body = { page_size: pageSize };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;
  const res = apiPost(`v1/data_sources/${PROJECTS_DS}/query`, body);
  return res.results || [];
}

// Resolve a single Projects row by (case-insensitive) title. Prefers an exact match.
export function getProjectByName(name) {
  const results = queryProjects({
    filter: { property: 'Project', title: { contains: name } },
    pageSize: 10,
  });
  if (results.length === 0) throw new Error(`No FourthOS project matched "${name}"`);
  const lower = name.toLowerCase();
  const exact = results.find((r) => title(r.properties.Project).toLowerCase() === lower);
  return exact || results[0];
}

// Recent Decisions & Outputs rows for a project, newest first.
export function queryDecisionsForProject(projectRowId, limit = 5) {
  const body = {
    filter: { property: 'Project', relation: { contains: projectRowId } },
    sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    page_size: limit,
  };
  const res = apiPost(`v1/data_sources/${DECISIONS_DS}/query`, body);
  return res.results || [];
}

// Upload an HTML string as a Notion file attachment (size/precheck path).
// The authoritative embed bind is the MCP create-attachment step; this is CLI-only.
export function uploadHtml(html, filename) {
  const out = runNtn(
    ['files', 'create', '--json', '--filename', filename, '--content-type', 'text/html'],
    { input: html },
  );
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`ntn files create returned non-JSON: ${out.slice(0, 400)}`);
  }
}

// --- property extractors (raw Notion property object -> primitive) ---
export const title = (p) => (p?.title || []).map((t) => t.plain_text).join('');
export const richText = (p) => (p?.rich_text || []).map((t) => t.plain_text).join('');
export const selectName = (p) => p?.select?.name || '';
export const statusName = (p) => p?.status?.name || p?.select?.name || '';
export const checkbox = (p) => !!p?.checkbox;
export const urlVal = (p) => p?.url || '';
export const multiSelect = (p) => (p?.multi_select || []).map((s) => s.name);
export const dateStart = (p) => p?.date?.start || '';
