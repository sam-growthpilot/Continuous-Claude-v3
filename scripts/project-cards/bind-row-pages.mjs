// bind-row-pages.mjs — one-shot binder (optimization 03, 2026-07-16, Dave's
// decision: bind, not retire). For each unbound roster project (state.json
// pageId=null), set the Projects-DB row's 'Project Page' url property to the
// row page's OWN Notion URL, so the card engine (refresh.mjs notionPageId)
// derives a host page and the sweep can publish the card at the top of the row
// page. A row whose Project Page currently holds a GitHub repo URL first gets
// that link preserved as a bookmark block appended to the row page body.
//
//   node scripts/project-cards/bind-row-pages.mjs --dry-run   # preview only
//   node scripts/project-cards/bind-row-pages.mjs             # write bindings
//
// Idempotent: rows whose Project Page already holds a Notion URL are skipped.
// Does NOT publish cards — run the sweep afterwards; refresh picks up the new
// pageIds and flags the cards needsPublish.
import { pathToFileURL } from 'node:url';
import {
  queryProjects, updatePageProperties, insertBlocksAfter, urlVal, title,
} from './lib/notion.mjs';
import { readState } from './lib/state.mjs';

const GITHUB_RE = /github\.com/i;
const NOTION_RE = /notion\.(so|com)/i;

// PURE, exported for tests: decide the binding action for one roster row.
//   'skip-notion'  — already bound to a Notion page
//   'bind'         — empty Project Page -> set to the row URL
//   'bind-preserve'— GitHub Project Page -> bookmark the repo, then set row URL
export function classifyBindAction(projectPageUrl) {
  if (projectPageUrl && NOTION_RE.test(projectPageUrl)) return 'skip-notion';
  if (projectPageUrl && GITHUB_RE.test(projectPageUrl)) return 'bind-preserve';
  return 'bind';
}

export function repoBookmarkBlock(repoUrl) {
  return {
    type: 'bookmark',
    bookmark: {
      url: repoUrl,
      caption: [{ type: 'text', text: { content: 'Project repository (moved from the Project Page field when the living status card was bound here)' } }],
    },
  };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const state = readState();
  const unboundRowIds = new Set(
    Object.values(state.cards || {})
      .filter((c) => c && c.projectRowId && !c.pageId)
      .map((c) => c.projectRowId),
  );
  const rows = queryProjects({ filter: { property: 'Status', status: { does_not_equal: 'Archived' } } });
  let bound = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!unboundRowIds.has(r.id)) continue;
    const name = title(r.properties?.Project);
    const cur = urlVal(r.properties?.['Project Page']);
    const action = classifyBindAction(cur);
    if (action === 'skip-notion') {
      console.error(`[bind] SKIP ${name}: Project Page already Notion (${cur})`);
      skipped += 1;
      continue;
    }
    const rowUrl = r.url;
    if (!rowUrl) {
      console.error(`[bind] SKIP ${name}: row has no url field`);
      skipped += 1;
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] ${name}: ${action} -> Project Page = ${rowUrl}${action === 'bind-preserve' ? ` (bookmark repo ${cur} first)` : ''}`);
      continue;
    }
    if (action === 'bind-preserve') {
      insertBlocksAfter(r.id, null, [repoBookmarkBlock(cur)]);
      console.error(`[bind] ${name}: repo link preserved as bookmark (${cur})`);
    }
    updatePageProperties(r.id, { 'Project Page': { url: rowUrl } });
    console.error(`[bind] ${name}: Project Page -> ${rowUrl}`);
    bound += 1;
  }
  console.error(`[bind] done — ${dryRun ? 'previewed' : 'bound'} ${dryRun ? unboundRowIds.size : bound}, skipped ${skipped}`);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main();
  } catch (e) {
    console.error(`[bind] FATAL: ${e.message}`);
    process.exit(1);
  }
}
