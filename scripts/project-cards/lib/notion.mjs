// notion.mjs — thin, deterministic wrapper over the Notion CLI (`ntn`).
// ESM, no external deps. Honors the ntn non-interactive contract on every call:
//   absolute exe, empty/closed stdin (input), hard timeout, windowsHide, fail-loud.
// See docs/notion-platform-spike-report.md and .claude/rules/notion-cli-safety.md.
import { spawnSync } from 'node:child_process';
import {
  NTN_EXE, NTN_TIMEOUT_MS, PROJECTS_DS as PROJECTS_DS_ID,
  DECISIONS_DS as DECISIONS_DS_ID, CARD_SECTION_HEADING,
} from './config.mjs';

const NTN = NTN_EXE;

// FourthOS data source ids (databases). Re-exported from config (single source
// of truth) so existing importers of these names keep working.
export const PROJECTS_DS = PROJECTS_DS_ID;
export const DECISIONS_DS = DECISIONS_DS_ID;

// Transient failure signature — retry only these. A nonzero exit whose output
// matches rate-limiting (429/rate), a timeout, a 5xx, or a dropped connection is
// worth a backoff; anything else (bad request, auth, 4xx) fails loud immediately.
const TRANSIENT_RE = /429|rate|timeout|5\d\d|ECONN/i;
const MAX_ATTEMPTS = 3;

// Blocking sleep (spawnSync is synchronous, so async timers won't help here).
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Run ntn with the contract enforced. `input` is fed to stdin then closed so ntn
// never blocks waiting on an open pipe. Transient failures are retried up to 3
// times with exponential backoff (~0.5s / 1s / 2s); non-transient failures throw
// immediately with stderr context.
function runNtn(args, { input = '' } = {}) {
  let lastDetail = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const res = spawnSync(NTN, args, {
      input,
      timeout: NTN_TIMEOUT_MS,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });

    if (!res.error && res.status === 0) return res.stdout;

    const detail = res.error
      ? `spawn failed: ${res.error.message}`
      : (res.stderr || res.stdout || '').trim();
    lastDetail = detail;
    const transient = TRANSIENT_RE.test(detail);

    if (transient && attempt < MAX_ATTEMPTS) {
      const backoff = 500 * 2 ** (attempt - 1); // 500, 1000, 2000
      console.error(`[ntn] transient failure [${args.join(' ')}] attempt ${attempt}/${MAX_ATTEMPTS}: ${detail} — retrying in ${backoff}ms`);
      sleepMs(backoff);
      continue;
    }

    if (res.error) throw new Error(`ntn spawn failed [${args.join(' ')}]: ${res.error.message}`);
    throw new Error(`ntn exited ${res.status} [${args.join(' ')}]: ${detail}`);
  }
  // Exhausted retries on a transient failure.
  throw new Error(`ntn failed after ${MAX_ATTEMPTS} attempts [${args.join(' ')}]: ${lastDetail}`);
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

// GET a raw API path; parse and return the response object.
function apiGet(path) {
  const out = runNtn(['api', path]);
  try {
    return JSON.parse(out);
  } catch (e) {
    throw new Error(`ntn api ${path} returned non-JSON: ${out.slice(0, 400)}`);
  }
}

// The card heading text as stored in a Notion heading block (no Markdown '## ').
const CARD_HEADING_TEXT = CARD_SECTION_HEADING.replace(/^#+\s*/, '').trim();

// Read-back verification: true iff the page currently has an 'embed' block within
// the "## 📊 Living Status Card" section (i.e. at/after that heading and before the
// next heading_2). Used by the sweep to confirm a publish landed instead of
// trusting the claude -p stdout marker. Best-effort: returns false (not throws)
// on any read error, so a failed verification simply re-flags the card.
// Read-back verify: true iff an 'embed' block sits within the section whose
// heading_2 text matches `sectionHeading` (default: the card section). Pass the
// cockpit heading ('🎯 Portfolio Cockpit') to verify the hub cockpit embed —
// the hub and the card use DIFFERENT section headings.
export function verifyCardEmbed(pageId, sectionHeading = CARD_SECTION_HEADING) {
  if (!pageId) return false;
  const wanted = String(sectionHeading).replace(/^#+\s*/, '').trim();
  let res;
  try {
    res = apiGet(`v1/blocks/${pageId}/children`);
  } catch (e) {
    console.error(`[ntn] verifyCardEmbed read failed for ${pageId}: ${e.message}`);
    return false;
  }
  const blocks = (res && res.results) || [];
  let inSection = false;
  for (const b of blocks) {
    if (!b || typeof b.type !== 'string') continue;
    if (b.type === 'heading_2') {
      const text = (b.heading_2?.rich_text || []).map((t) => t.plain_text).join('').trim();
      // Entering the wanted section, or leaving it at the next heading_2.
      inSection = text === wanted;
      continue;
    }
    if (inSection && b.type === 'embed') return true;
  }
  return false;
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
