// refresh-pages.mjs — Report Runs Phase 3: deterministic (ntn-only, NO MCP) refresh
// of the 6 report child pages + the Reports hub launcher, from the newest registry
// row per report type. READ-then-splice; NEVER a full-page edit.
//
// What it does (all via lib/notion.mjs's block-level section splice — never touches
// MCP-only blocks, linked views, or human-owned sections):
//   1. Per child page (all 6 in REPORT_CHILD_PAGES): query the Report Runs DS for
//      that Report Type, newest first; render a "Current run" callout from the newest
//      row (or "No runs recorded yet." when the type has 0 rows) and splice it into
//      that page's `## Current run` section. The `## History` linked-view block is
//      left untouched (findSectionBlocks scopes the splice to the Current-run body).
//   2. Hub launcher: an ADDITIVE, machine-owned `## 🗂 Report pages` section on the
//      Reports hub — a table (one row per type → child-page link + latest Status +
//      Run Date + http Artifact link) plus a trailing link to the "All Report Runs
//      — by Type" overview view. Created near the TOP if absent; on re-run only its
//      BODY is replaced (idempotent). The human `## 📥 Latest reports` narrative and
//      every other hub section are NEVER touched.
//
// SAFETY: writes exactly two kinds of section — `## Current run` (child pages, which
// this system owns) and `## 🗂 Report pages` (hub, machine-owned). Link rich_text is
// only emitted for real http(s) URLs (a Notion link with a relative path 400s the
// whole request), so a non-URL Artifact value (a deploy-fail fallback path) degrades
// to a plain "—" cell / no callout link rather than dropping the write.
//
// NON-FATAL: each child page and the hub are independently try/caught — one failing
// page logs `[refresh-pages] ERROR …` and the sweep continues. The CLI exits 0 on
// success/partial (observability must never fail the parent sweep); a top-level
// config/spawn fatal exits 2.
//
// CLI:
//   node refresh-pages.mjs            # refresh all 6 child pages + the hub launcher
//   node refresh-pages.mjs --dry-run  # print the planned callouts + launcher table; write nothing
//
// Reuses scripts/project-cards/lib/notion.mjs (absolute-NTN_EXE non-interactive
// contract). ESM, no external deps.
import { pathToFileURL } from 'node:url';
import {
  queryDataSource, getPageBlocks, findSectionBlocks, replaceSectionBlocks,
  insertBlocksAfter, selectName, dateStart, richText, urlVal, title,
} from '../project-cards/lib/notion.mjs';
import {
  REPORT_RUNS_DS_ID, REPORT_CHILD_PAGES, REPORTS_HUB_PAGE_ID,
  REPORT_TYPES, REPORT_RUNS_VIEWS,
} from './config.mjs';

// The two section headings this refresh owns/writes.
export const CURRENT_RUN_HEADING = '## Current run';
export const HUB_LAUNCHER_HEADING = '## 🗂 Report pages';
// The heading text stored in the created hub heading_2 block (no Markdown '## ').
const HUB_LAUNCHER_TEXT = HUB_LAUNCHER_HEADING.replace(/^#+\s*/, '').trim();

// The hub overview linked view ("All Report Runs — by Type"), a block on the hub.
export const OVERVIEW_VIEW_ID = REPORT_RUNS_VIEWS['All Report Runs — by Type (hub)'];

// A Notion rich_text link REQUIRES a real URL — a bare filesystem path (a deploy-fail
// Artifact fallback) would 400 the whole PATCH. Only ever attach a link for http(s).
const HTTP_URL_RE = /^https?:\/\//i;
const isHttpUrl = (v) => typeof v === 'string' && HTTP_URL_RE.test(v);

// --- url builders (pure) -------------------------------------------------------

// Canonical Notion page URL from an id (dashes stripped).
export function notionPageUrl(id) {
  return `https://www.notion.so/${String(id).replace(/-/g, '')}`;
}

// Deep-link to a view/block that lives ON a page: `<page>#<block>` (both dash-stripped).
// Used for the "All Report Runs — by Type" overview view embedded on the hub.
export function notionViewUrl(pageId, viewId) {
  return `${notionPageUrl(pageId)}#${String(viewId).replace(/-/g, '')}`;
}

// --- rich-text segment (pure) --------------------------------------------------
// One Notion rich_text object. Truncates content to Notion's 2000-char cap. A link
// is attached ONLY when the value is a real http(s) URL (guarded here too, defense
// in depth). Bold/italic annotations added on request.
function seg(content, { link, bold, italic } = {}) {
  const o = { type: 'text', text: { content: String(content ?? '').slice(0, 2000) } };
  if (isHttpUrl(link)) o.text.link = { url: link };
  if (bold || italic) {
    o.annotations = {};
    if (bold) o.annotations.bold = true;
    if (italic) o.annotations.italic = true;
  }
  return o;
}

// A table cell is an ARRAY of rich_text segments.
const cell = (...segs) => segs;

// --- row extraction (pure) -----------------------------------------------------

// Normalize a raw Notion Report-Runs row into the fields the renderers use.
// Returns null when there is no row (a type with 0 registry rows) or no properties.
export function extractRun(row) {
  const p = row && row.properties;
  if (!p) return null;
  return {
    runDate: dateStart(p['Run Date']) || '',
    status: selectName(p.Status) || '',
    summary: richText(p.Summary) || '',
    artifactUrl: urlVal(p['Artifact URL']) || '',
    title: title(p['Report Run']) || '',
  };
}

// Chronologically newest row (defensive over the DS `Run Date descending` sort:
// mixed-tz strings from different pipelines can defeat a lexicographic pick — this
// compares by epoch ms). Returns null on an empty set; never throws.
//
// Corrective-row guard (2026-07-16): backfill/remap rows carry an OLD period but
// TODAY'S Run Date, so a naive newest-by-date pick would present a correction of
// ancient history as the "Current run". Rows whose Summary starts with
// "backfill"/"remap" (the corrective-row convention) are excluded from the pick
// unless a type has ONLY corrective rows.
function isCorrectiveRow(r) {
  const rt = r?.properties?.Summary?.rich_text;
  const s = (Array.isArray(rt) ? rt.map((t) => t?.plain_text || '').join('') : '').trim().toLowerCase();
  return s.startsWith('backfill') || s.startsWith('remap');
}
export function pickNewest(rows) {
  const all = rows || [];
  const genuine = all.filter((r) => !isCorrectiveRow(r));
  const pool = genuine.length > 0 ? genuine : all;
  let best = null;
  let bestMs = -Infinity;
  for (const r of pool) {
    const d = dateStart(r?.properties?.['Run Date']) || r?.last_edited_time || '';
    const ms = Date.parse(d);
    const cmp = Number.isNaN(ms) ? -Infinity : ms;
    if (best === null || cmp > bestMs) { best = r; bestMs = cmp; }
  }
  return best;
}

// --- Current-run callout builder (pure) ----------------------------------------
// Returns the block array to splice into a child page's `## Current run` section.
// `row` is the newest raw Notion row, or null/undefined for a type with no runs.
//   populated -> [ callout: **Latest:** <runDate> · **<status>** · <summary> (· link) ]
//   empty     -> [ callout: _No runs recorded yet._ ]
export function buildCurrentRunBlocks(row) {
  const run = extractRun(row);
  if (!run) {
    return [{
      type: 'callout',
      callout: {
        icon: { type: 'emoji', emoji: '📭' },
        rich_text: [seg('No runs recorded yet.', { italic: true })],
      },
    }];
  }
  const rich = [seg('Latest: ', { bold: true }), seg(run.runDate || 'unknown')];
  if (run.status) { rich.push(seg(' · '), seg(run.status, { bold: true })); }
  if (run.summary) { rich.push(seg(' · '), seg(run.summary)); }
  if (isHttpUrl(run.artifactUrl)) { rich.push(seg(' · '), seg('View artifact', { link: run.artifactUrl })); }
  return [{
    type: 'callout',
    callout: { icon: { type: 'emoji', emoji: '📌' }, rich_text: rich },
  }];
}

// --- Hub launcher builder (pure) -----------------------------------------------
// Returns the BODY blocks for the `## 🗂 Report pages` hub section: a 4-column table
// (Report | Status | Run date | Artifact), one row per report type linking to its
// child page, plus a trailing paragraph linking the overview view. `latestByType`
// maps a type -> its normalized run (from extractRun) or null.
export function buildHubLauncherBlocks({
  latestByType = {},
  childPages = REPORT_CHILD_PAGES,
  hubId = REPORTS_HUB_PAGE_ID,
  overviewViewId = OVERVIEW_VIEW_ID,
  types = REPORT_TYPES,
} = {}) {
  const header = {
    type: 'table_row',
    table_row: {
      cells: [
        cell(seg('Report', { bold: true })),
        cell(seg('Status', { bold: true })),
        cell(seg('Run date', { bold: true })),
        cell(seg('Artifact', { bold: true })),
      ],
    },
  };
  const rows = types.map((type) => {
    const run = latestByType[type] || null;
    const nameCell = cell(seg(type, { link: notionPageUrl(childPages[type]) }));
    const statusCell = cell(seg(run?.status || '—'));
    const dateCell = cell(seg(run?.runDate || '—'));
    const artCell = isHttpUrl(run?.artifactUrl)
      ? cell(seg('link', { link: run.artifactUrl }))
      : cell(seg('—'));
    return { type: 'table_row', table_row: { cells: [nameCell, statusCell, dateCell, artCell] } };
  });
  const table = {
    type: 'table',
    table: {
      table_width: 4,
      has_column_header: true,
      has_row_header: false,
      children: [header, ...rows],
    },
  };
  const overview = {
    type: 'paragraph',
    paragraph: {
      rich_text: [
        seg('All runs (by type): '),
        seg('All Report Runs — by Type', { link: notionViewUrl(hubId, overviewViewId) }),
      ],
    },
  };
  return [table, overview];
}

// --- dry-run rendering (pure) --------------------------------------------------
// Flatten a rich_text array to plain text (link urls surfaced in <>).
function flatRich(rich) {
  return (rich || []).map((s) => {
    const t = s.text?.content ?? '';
    return s.text?.link ? `${t} <${s.text.link.url}>` : t;
  }).join('');
}

// Human-readable one-liner(s) for a block array, for --dry-run output.
export function describeBlocks(blocks) {
  const out = [];
  for (const b of blocks || []) {
    if (b.type === 'callout') out.push(`  callout: ${flatRich(b.callout.rich_text)}`);
    else if (b.type === 'paragraph') out.push(`  paragraph: ${flatRich(b.paragraph.rich_text)}`);
    else if (b.type === 'heading_2') out.push(`  heading_2: ${flatRich(b.heading_2.rich_text)}`);
    else if (b.type === 'table') {
      out.push(`  table (${b.table.table_width} cols, ${b.table.children.length} rows):`);
      for (const r of b.table.children) {
        out.push(`    | ${r.table_row.cells.map((c) => flatRich(c)).join(' | ')} |`);
      }
    } else out.push(`  ${b.type}`);
  }
  return out.join('\n');
}

// --- per-type read (transport-injectable) --------------------------------------
// Query the DS for one Report Type, newest first. Returns { rows, newest }.
export function fetchLatest(type, { dsId = REPORT_RUNS_DS_ID, query = queryDataSource } = {}) {
  const rows = query(dsId, {
    filter: { property: 'Report Type', select: { equals: type } },
    sorts: [{ property: 'Run Date', direction: 'descending' }],
  });
  return { rows, newest: pickNewest(rows) };
}

// --- child page refresh (transport-injectable) ---------------------------------
// Query + build + splice one child page's `## Current run` section. dryRun prints and
// writes nothing. Returns { type, pageId, rows, wrote, newest }.
export function refreshChildPage(type, pageId, {
  dryRun = false, dsId = REPORT_RUNS_DS_ID,
  query = queryDataSource, replaceSection = replaceSectionBlocks,
} = {}) {
  const { rows, newest } = fetchLatest(type, { dsId, query });
  const blocks = buildCurrentRunBlocks(newest);
  if (dryRun) {
    console.log(`\n[dry-run] ${type} (${pageId}) — ${rows.length} row(s) -> "${CURRENT_RUN_HEADING}":`);
    console.log(describeBlocks(blocks));
    return { type, pageId, rows: rows.length, wrote: false, newest: extractRun(newest) };
  }
  replaceSection(pageId, CURRENT_RUN_HEADING, blocks);
  console.error(`[refresh-pages] ${type}: wrote "${CURRENT_RUN_HEADING}" (${rows.length} row(s))`);
  return { type, pageId, rows: rows.length, wrote: true, newest: extractRun(newest) };
}

// --- hub launcher refresh (transport-injectable) -------------------------------
// Maintain the ADDITIVE `## 🗂 Report pages` section. If it exists, replace ONLY its
// body (idempotent). If absent, CREATE it near the top: insert `[heading, ...body]`
// after the block immediately preceding the page's first heading (so it splits no
// existing section); if the page opens with a heading, append at the end instead.
// Returns { wrote, action }.
export function refreshHub({
  latestByType = {}, dryRun = false, hubId = REPORTS_HUB_PAGE_ID,
  childPages = REPORT_CHILD_PAGES, overviewViewId = OVERVIEW_VIEW_ID, types = REPORT_TYPES,
  getBlocks = getPageBlocks, findSection = findSectionBlocks,
  replaceSection = replaceSectionBlocks, insertAfter = insertBlocksAfter,
} = {}) {
  const body = buildHubLauncherBlocks({ latestByType, childPages, hubId, overviewViewId, types });
  if (dryRun) {
    console.log(`\n[dry-run] HUB "${HUB_LAUNCHER_HEADING}" (${hubId}):`);
    console.log(describeBlocks(body));
    return { wrote: false, action: 'dry-run' };
  }
  const blocks = getBlocks(hubId);
  if (findSection(blocks, HUB_LAUNCHER_HEADING)) {
    replaceSection(hubId, HUB_LAUNCHER_HEADING, body);
    console.error(`[refresh-pages] hub: replaced "${HUB_LAUNCHER_HEADING}" body`);
    return { wrote: true, action: 'replaced' };
  }
  const headingBlock = { type: 'heading_2', heading_2: { rich_text: [seg(HUB_LAUNCHER_TEXT)] } };
  const firstHeadingIdx = blocks.findIndex((b) => /^heading_[123]$/.test(b?.type));
  const anchorId = firstHeadingIdx > 0 ? blocks[firstHeadingIdx - 1].id : null;
  insertAfter(hubId, anchorId, [headingBlock, ...body]);
  console.error(`[refresh-pages] hub: created "${HUB_LAUNCHER_HEADING}" (${anchorId ? `after ${anchorId}` : 'appended'})`);
  return { wrote: true, action: 'created' };
}

// --- orchestrator --------------------------------------------------------------
// Refresh all 6 child pages then the hub launcher. Each child's READ happens before
// its write, so a per-page write failure still contributes its latest row to the hub
// table. Every write is independently try/caught (non-fatal). `deps` overrides the
// transport for tests. Returns { children, hub, errors }.
export function refreshAll({ dryRun = false, deps = {} } = {}) {
  const d = {
    query: queryDataSource,
    replaceSection: replaceSectionBlocks,
    getBlocks: getPageBlocks,
    findSection: findSectionBlocks,
    insertAfter: insertBlocksAfter,
    ...deps,
  };
  const results = { children: [], hub: null, errors: [] };
  const latestByType = {};

  for (const type of REPORT_TYPES) {
    const pageId = REPORT_CHILD_PAGES[type];
    let rows = [];
    let newest = null;
    try {
      ({ rows, newest } = fetchLatest(type, { query: d.query }));
    } catch (e) {
      console.error(`[refresh-pages] ERROR query "${type}" (non-fatal): ${e.message}`);
      results.errors.push({ scope: `query:${type}`, message: e.message });
      latestByType[type] = null;
      continue; // no data -> hub row shows dashes; nothing to splice into the child
    }
    latestByType[type] = extractRun(newest);

    const blocks = buildCurrentRunBlocks(newest);
    if (dryRun) {
      console.log(`\n[dry-run] ${type} (${pageId}) — ${rows.length} row(s) -> "${CURRENT_RUN_HEADING}":`);
      console.log(describeBlocks(blocks));
      results.children.push({ type, pageId, rows: rows.length, wrote: false });
      continue;
    }
    try {
      d.replaceSection(pageId, CURRENT_RUN_HEADING, blocks);
      console.error(`[refresh-pages] ${type}: wrote "${CURRENT_RUN_HEADING}" (${rows.length} row(s))`);
      results.children.push({ type, pageId, rows: rows.length, wrote: true });
    } catch (e) {
      console.error(`[refresh-pages] ERROR write "${type}" (${pageId}) (non-fatal): ${e.message}`);
      results.errors.push({ scope: `child:${type}`, message: e.message });
      results.children.push({ type, pageId, rows: rows.length, wrote: false, error: e.message });
    }
  }

  try {
    results.hub = refreshHub({
      latestByType,
      dryRun,
      getBlocks: d.getBlocks,
      findSection: d.findSection,
      replaceSection: d.replaceSection,
      insertAfter: d.insertAfter,
    });
  } catch (e) {
    console.error(`[refresh-pages] ERROR hub launcher (non-fatal): ${e.message}`);
    results.errors.push({ scope: 'hub', message: e.message });
  }

  return results;
}

// --- CLI -----------------------------------------------------------------------
function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  const results = refreshAll({ dryRun });
  const wrote = results.children.filter((c) => c.wrote).length;
  const hubAction = results.hub ? results.hub.action : 'skipped';
  console.error(
    `[refresh-pages] ${dryRun ? 'DRY-RUN ' : ''}done — children=${wrote}/${REPORT_TYPES.length} written, `
    + `hub=${hubAction}, errors=${results.errors.length}`,
  );
  // Non-fatal by contract: per-page/hub errors are logged but never fail the sweep.
  process.exit(0);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    main();
  } catch (e) {
    console.error(`[refresh-pages] FATAL: ${e.message}`);
    process.exit(2);
  }
}
