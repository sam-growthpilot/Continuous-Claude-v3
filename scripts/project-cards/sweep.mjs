// sweep.mjs — daily automated sweep for the living project-card engine.
//   node scripts/project-cards/sweep.mjs            run the full sweep
//   node scripts/project-cards/sweep.mjs --dry-run  safe: refresh + preview only
//
// Flow: refresh every roster card (refresh.mjs --all) -> per-card MCP embed
// publish for changed/unpublished cards -> refresh the Reporting Hub gallery
// table -> append a run-log line. The per-card publish and the hub refresh are
// the ONE step the ntn CLI cannot do (S5): they run through the claude.ai Notion
// connector via headless `claude -p`. The connector only loads when
// ANTHROPIC_API_KEY is UNSET, so every spawned claude gets an env copy with that
// key deleted. --dry-run spawns NO claude and mutates neither state nor Notion.
import { spawnSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, appendFileSync, realpathSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ntnVersion, queryProjects, title, selectName, statusName, urlVal,
} from './lib/notion.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REFRESH = join(HERE, 'refresh.mjs');
const STATE_PATH = join(HERE, 'state.json');
const LOGS_DIR = join(HERE, 'logs');
const LOG_PATH = join(LOGS_DIR, 'sweep.jsonl');

// Absolute ntn exe (winget package path) — mirrors lib/notion.mjs. Kept here as
// the documented reference for the ntn non-interactive contract; direct ntn calls
// in this file go through lib/notion.mjs, which enforces the contract.
const NTN = 'C:/Users/david.hayes/AppData/Local/Microsoft/WinGet/Packages/Notion.ntn_Microsoft.Winget.Source_8wekyb3d8bbwe/ntn-x86_64-pc-windows-msvc/ntn.exe';

// The Reporting Hub page that hosts the shared project-card gallery.
const REPORTING_HUB_PAGE_ID = '38f76fd7ac8280478e50dd2956ba6e8a';
const CARD_HEADING = '## 📊 Living Status Card';
const HUB_SECTION_HEADING = '## 📇 FourthOS Project Cards';

// CCv3 is the engine's pilot but is NOT a FourthOS Projects-DB row, so it is
// merged into the hub gallery from this static list rather than the live query.
const STATIC_EXTRA_CARDS = [
  {
    projectName: 'CCv3 (pilot)',
    health: 'Green',
    status: 'Active',
    hostKind: 'notion',
    url: 'https://app.notion.com/p/39276fd7ac8281c697b8dc65e42168cb',
  },
];

const CLAUDE_TIMEOUT_MS = 300000; // 5 min per headless claude publish
const REFRESH_TIMEOUT_MS = 120000;

// --- pure, exported helpers (unit-tested without spawning claude/ntn) ---

// Classify a Project Page URL into the card's host kind.
export function classifyHostKind(url) {
  if (!url) return 'none';
  if (/notion\.(so|com)/i.test(url)) return 'notion';
  if (/github\.com/i.test(url)) return 'github';
  return 'none';
}

// Render the hub gallery Markdown table from classified roster rows.
export function buildHubTable(rows) {
  const header = '| Project | Health | Status | Card |\n| --- | --- | --- | --- |';
  const body = rows.map((r) => {
    let card;
    if (r.hostKind === 'notion') card = `[Live card](${r.url})`;
    else if (r.hostKind === 'github') card = 'GitHub-only — no Notion host page';
    else card = 'Pending host page';
    return `| ${r.projectName} | ${r.health || '—'} | ${r.status || '—'} | ${card} |`;
  });
  return [header, ...body].join('\n');
}

// --- small local utilities ---

// Human-readable stamp for the as-of captions.
function humanDate(d = new Date()) {
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function readState() {
  if (!existsSync(STATE_PATH)) return { cards: {} };
  const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  raw.cards = raw.cards || {};
  return raw;
}

function atomicWrite(path, contents) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  renameSync(tmp, path);
}

// Record a successful publish for one slug (attachmentId + lastPublished).
function recordPublish(slug, attachmentId) {
  const state = readState();
  const prev = state.cards[slug] || {};
  state.cards[slug] = { ...prev, attachmentId, lastPublished: new Date().toISOString() };
  atomicWrite(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

// Spawn headless claude with the connector enabled (ANTHROPIC_API_KEY deleted).
function spawnClaude(prompt) {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return spawnSync('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
    input: '',
    env,
    timeout: CLAUDE_TIMEOUT_MS,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

// Run refresh.mjs --all and parse its stdout manifest (stderr carries the banner).
function runRefreshAll() {
  const res = spawnSync(process.execPath, [REFRESH, '--all'], {
    input: '',
    timeout: REFRESH_TIMEOUT_MS,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw new Error(`refresh.mjs spawn failed: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`refresh.mjs exited ${res.status}: ${(res.stderr || '').trim()}`);
  }
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    throw new Error(`refresh.mjs returned non-JSON: ${res.stdout.slice(0, 400)}`);
  }
}

// Fetch non-archived roster rows and classify each into a hub-table row.
function fetchRoster() {
  const filter = { property: 'Status', status: { does_not_equal: 'Archived' } };
  const pages = queryProjects({ filter, pageSize: 100 });
  return pages.map((pg) => {
    const p = pg.properties || {};
    const url = urlVal(p['Project Page']);
    return {
      projectName: title(p.Project),
      health: selectName(p.Health),
      status: statusName(p.Status),
      hostKind: classifyHostKind(url),
      url,
    };
  });
}

// --- prompt builders (mirror the /project-card skill Step 2 + the hub contract) ---

function buildPublishPrompt({ projectName, pageId, html, asOfHuman }) {
  const caption = `Machine-maintained · auto-generated by the project-card engine · as of ${asOfHuman}`;
  return [
    `You are publishing the living status card for the FourthOS project "${projectName}".`,
    `Target Notion page id: ${pageId}`,
    '',
    'Using the claude.ai Notion connector tools, do exactly these steps and nothing else:',
    '1. Call notion-create-attachment with the HTML string below as the file content'
      + ' (content type text/html). It returns file-upload://<id>.',
    `2. Call notion-update-page on page ${pageId} to insert-or-replace the job-owned section`
      + ` titled exactly "${CARD_HEADING}" at the TOP of the page. The section body, in order, is:`,
    '   - an <embed src="file-upload://<id>"> block (the interactive sandboxed card)',
    `   - immediately below it, an italic caption line: "${caption}"`,
    `   If the "${CARD_HEADING}" section already exists, REPLACE only its content. Never touch,`,
    '   reorder, or overwrite any other section or content on the page.',
    '3. On success, print a single line exactly: PUBLISHED attachment=<id> (the id from step 1).',
    'If any step fails, print a single line: FAILED <reason> and stop.',
    '',
    '--- BEGIN CARD HTML ---',
    html,
    '--- END CARD HTML ---',
  ].join('\n');
}

function buildHubPrompt({ table, asOfHuman, rowCount }) {
  const intro = 'Living status cards for every active FourthOS project.'
    + ' Machine-maintained — do not edit by hand.';
  return [
    'You are refreshing the FourthOS Project Cards gallery on the Reporting Hub.',
    `Target Notion page id: ${REPORTING_HUB_PAGE_ID}`,
    '',
    `Using the claude.ai Notion connector, REPLACE only the body of the section titled exactly`,
    `"${HUB_SECTION_HEADING}" with the content below. If that section does not exist, insert it`,
    'at the TOP of the page. Do not touch, reorder, or overwrite any other section or content.',
    '',
    'The section body, in order, must be exactly:',
    `1. An italic intro line: "${intro}"`,
    '2. This exact Markdown table, placed verbatim — do not invent, add, reorder, or drop any',
    '   rows or cells; just place the table:',
    '',
    table,
    '',
    `3. An italic as-of caption line: "As of ${asOfHuman} · ${rowCount} projects"`,
    '',
    'When done, print a single line exactly: HUBDONE',
    'If any step fails, print a single line: FAILED <reason> and stop.',
  ].join('\n');
}

// --- publish steps ---

function publishCard(r, asOfHuman, publishedOk, publishFailed) {
  let html;
  try {
    html = readFileSync(r.htmlPath, 'utf8');
  } catch (e) {
    publishFailed.push({ slug: r.slug, reason: `read html: ${e.message}` });
    return;
  }
  const res = spawnClaude(buildPublishPrompt({
    projectName: r.projectName, pageId: r.pageId, html, asOfHuman,
  }));
  if (res.error) {
    publishFailed.push({ slug: r.slug, reason: `spawn: ${res.error.message}` });
    return;
  }
  const out = res.stdout || '';
  const ok = out.match(/PUBLISHED attachment=(\S+)/);
  if (ok) {
    recordPublish(r.slug, ok[1]);
    publishedOk.push(r.slug);
    console.error(`[sweep] published ${r.slug} attachment=${ok[1]}`);
    return;
  }
  const fail = out.match(/FAILED\s+(.*)/);
  const reason = fail ? fail[1].trim()
    : (res.status === null ? 'timeout/no-marker' : 'no PUBLISHED marker');
  publishFailed.push({ slug: r.slug, reason });
  console.error(`[sweep] publish FAILED ${r.slug}: ${reason}`);
}

function refreshHub(table, asOfHuman, rowCount) {
  const res = spawnClaude(buildHubPrompt({ table, asOfHuman, rowCount }));
  if (!res.error && /HUBDONE/.test(res.stdout || '')) {
    console.error('[sweep] hub gallery refreshed');
    return true;
  }
  const fail = (res.stdout || '').match(/FAILED\s+(.*)/);
  const reason = fail ? fail[1].trim()
    : (res.error ? res.error.message : 'no HUBDONE marker');
  console.error(`[sweep] hub refresh FAILED: ${reason}`);
  return false;
}

// --- main ---

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const startedIso = new Date().toISOString();
  const asOfHuman = humanDate();
  const version = ntnVersion();
  console.error(`[sweep] start ${startedIso} · ntn ${version}${dryRun ? ' · DRY-RUN' : ''}`);

  // Step 2: deterministic refresh of every roster card.
  const manifest = runRefreshAll();
  const results = manifest.results || [];
  console.error(`[sweep] refreshed ${results.length} card(s)`);

  const publishable = results.filter((r) => r.pageId && (r.changed || r.needsPublish));
  const publishedOk = [];
  const publishFailed = [];

  if (dryRun) {
    console.log(`\nWOULD PUBLISH (${publishable.length} card(s)):`);
    if (publishable.length === 0) console.log('  (none — all cards published & unchanged)');
    for (const r of publishable) {
      console.log(`  - ${r.slug} (changed=${r.changed} needsPublish=${r.needsPublish} pageId=${r.pageId})`);
    }
  } else {
    for (const r of publishable) publishCard(r, asOfHuman, publishedOk, publishFailed);
  }

  // Step 3: hub gallery table (live roster + static extras).
  const rows = [...fetchRoster(), ...STATIC_EXTRA_CARDS];
  const table = buildHubTable(rows);
  let hubRefreshed = false;

  if (dryRun) {
    console.log(`\nWOULD WRITE HUB TABLE (${rows.length} rows):`);
    console.log(table);
    console.log(`\nDry run complete — no claude spawned, state and Notion untouched.`);
    process.exit(0);
  }

  hubRefreshed = refreshHub(table, asOfHuman, rows.length);

  // Step 4: run log.
  mkdirSync(LOGS_DIR, { recursive: true });
  appendFileSync(LOG_PATH, `${JSON.stringify({
    ts: new Date().toISOString(),
    ntnVersion: version,
    refreshed: results.length,
    publishedOk,
    publishFailed,
    hubRefreshed,
  })}\n`, 'utf8');

  // Step 5: exit red if anything we attempted failed.
  const failed = publishFailed.length > 0 || !hubRefreshed;
  process.exit(failed ? 1 : 0);
}

// Only run the sweep when executed directly (not when imported by the tests,
// which pull in the pure classifyHostKind / buildHubTable exports).
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invoked && invoked === realpathSync(fileURLToPath(import.meta.url))) main();
