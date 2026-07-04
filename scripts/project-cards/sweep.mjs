// sweep.mjs — daily automated sweep for the living project-card engine.
//   node scripts/project-cards/sweep.mjs            run the full sweep
//   node scripts/project-cards/sweep.mjs --dry-run  safe: refresh + preview only
//
// Flow: refresh every roster card (refresh.mjs --all) -> per-card MCP embed
// publish for changed/unpublished cards -> read-back verify each publish landed
// -> refresh the Reporting Hub gallery table -> ALWAYS append a run-log line and
// (on full success) drop a heartbeat. The per-card publish and the hub refresh are
// the ONE step the ntn CLI cannot do (S5): they run through the claude.ai Notion
// connector via headless `claude -p`. The connector only loads when
// ANTHROPIC_API_KEY is UNSET, so every spawned claude gets an env copy with that
// key deleted. --dry-run spawns NO claude and mutates neither state nor Notion.
//
// Reliability contract:
//   REL#1 self-heal — a publish only advances publishedHash on a CONFIRMED +
//     read-back-VERIFIED publish (state.recordPublish with the card's contentHash);
//     a failed/unverified publish leaves publishedHash behind so needsPublish()
//     re-flags the card next sweep.
//   REL#2 observability — main() runs inside try/catch/finally; the finally ALWAYS
//     appends one sweep.jsonl row ({ts, phase, error|null, refreshed, publishedOk,
//     publishFailed, hubRefreshed}). A fatal throw sets exit 1 and a distinct FATAL
//     marker. The --dry-run early-exit is the only path that skips the append.
//   REL#4 heartbeat — after a fully successful run, logs/last-success.json records
//     {ts, publishedOk, cards} so an external watchdog can detect a stalled sweep.
import { spawnSync } from 'node:child_process';
import {
  readFileSync, writeFileSync, mkdirSync, appendFileSync, realpathSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  ntnVersion, queryProjects, verifyCardEmbed,
  title, selectName, statusName, urlVal,
} from './lib/notion.mjs';
import { readState, writeState, recordPublish } from './lib/state.mjs';
import {
  REFRESH_PATH, LOGS_DIR, SWEEP_LOG_PATH, REPORTING_HUB_PAGE_ID,
  CARD_SECTION_HEADING, HUB_SECTION_HEADING, STATIC_EXTRA_CARDS,
  CLAUDE_TIMEOUT_MS, REFRESH_TIMEOUT_MS,
} from './lib/config.mjs';
import { dateStamp } from './lib/util.mjs';

// Heartbeat file written on a fully successful run (REL#4).
const HEARTBEAT_PATH = join(LOGS_DIR, 'last-success.json');

// --- pure, exported helpers (unit-tested without spawning claude/ntn) ---

// Classify a Project Page URL into the card's host kind.
export function classifyHostKind(url) {
  if (!url) return 'none';
  if (/notion\.(so|com)/i.test(url)) return 'notion';
  if (/github\.com/i.test(url)) return 'github';
  return 'none';
}

// Escape a value for a single Markdown table cell: collapse newlines to a space
// and backslash-escape pipes so a stray '|' or line break in a project field can
// never inject extra columns/rows into the hub gallery table.
function mdCell(s) {
  return String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

// Escape a URL for use inside a Markdown link target: drop newlines and
// percent-encode pipes (a literal '|' would otherwise break the table row).
function mdUrl(s) {
  return String(s ?? '').replace(/\r?\n/g, '').replace(/\|/g, '%7C');
}

// Render the hub gallery Markdown table from classified roster rows. Every
// interpolated project field is cell-escaped so untrusted content (project names,
// health/status labels, page urls) cannot corrupt the table structure.
export function buildHubTable(rows) {
  const header = '| Project | Health | Status | Card |\n| --- | --- | --- | --- |';
  const body = rows.map((r) => {
    let card;
    if (r.hostKind === 'notion') card = `[Live card](${mdUrl(r.url)})`;
    else if (r.hostKind === 'github') card = 'GitHub-only — no Notion host page';
    else card = 'Pending host page';
    const health = mdCell(r.health) || '—';
    const status = mdCell(r.status) || '—';
    return `| ${mdCell(r.projectName)} | ${health} | ${status} | ${card} |`;
  });
  return [header, ...body].join('\n');
}

// --- spawns ---

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
  const res = spawnSync(process.execPath, [REFRESH_PATH, '--all'], {
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
      + ` titled exactly "${CARD_SECTION_HEADING}" at the TOP of the page. The section body, in order, is:`,
    '   - an <embed src="file-upload://<id>"> block (the interactive sandboxed card)',
    `   - immediately below it, an italic caption line: "${caption}"`,
    `   If the "${CARD_SECTION_HEADING}" section already exists, REPLACE only its content. Never touch,`,
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
    'Using the claude.ai Notion connector, REPLACE only the body of the section titled exactly',
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

// Publish one card, then READ-BACK VERIFY the embed actually landed on the page
// (ARCH): only a verified publish stamps publishedHash via state.recordPublish
// with the card's manifest contentHash (REL#1 self-heal pairing). A confirmed
// stdout marker whose embed is NOT found on read-back is recorded as a
// publishFailed so the next sweep retries it. Mutates + persists `state`.
function publishCard(r, state, asOfHuman, publishedOk, publishFailed) {
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
    console.error(`[sweep] publish FAILED ${r.slug}: spawn: ${res.error.message}`);
    return;
  }
  const out = res.stdout || '';
  const ok = out.match(/PUBLISHED attachment=(\S+)/);
  if (ok) {
    const attachmentId = ok[1];
    // ARCH read-back verify: trust the page, not the stdout marker.
    const verified = verifyCardEmbed(r.pageId);
    if (verified) {
      recordPublish(state, r.slug, {
        attachmentId,
        publishedHash: r.contentHash,
        lastPublished: new Date().toISOString(),
      });
      writeState(state);
      publishedOk.push(r.slug);
      console.error(`[sweep] published+verified ${r.slug} attachment=${attachmentId}`);
    } else {
      publishFailed.push({ slug: r.slug, reason: 'read-back verify: no embed in card section' });
      console.error(`[sweep] publish UNVERIFIED ${r.slug}: embed missing after PUBLISHED marker`);
    }
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
  const asOfHuman = dateStamp();

  // Outcome accumulators — declared at function scope so the REL#2 finally block
  // can always log them, even on a fatal throw partway through.
  let phase = 'start';
  let version = null;
  let refreshed = 0;
  const publishedOk = [];
  const publishFailed = [];
  let hubRefreshed = false;
  let fatalError = null;
  let dryRunExit = false;

  try {
    version = ntnVersion();
    console.error(`[sweep] start ${startedIso} · ntn ${version}${dryRun ? ' · DRY-RUN' : ''}`);

    // Step 2: deterministic refresh of every roster card.
    phase = 'refresh';
    const manifest = runRefreshAll();
    const results = manifest.results || [];
    refreshed = results.length;
    console.error(`[sweep] refreshed ${refreshed} card(s)`);

    const publishable = results.filter((r) => r.pageId && (r.changed || r.needsPublish));

    if (dryRun) {
      console.log(`\nWOULD PUBLISH (${publishable.length} card(s)):`);
      if (publishable.length === 0) console.log('  (none — all cards published & unchanged)');
      for (const r of publishable) {
        console.log(`  - ${r.slug} (changed=${r.changed} needsPublish=${r.needsPublish} pageId=${r.pageId})`);
      }
    } else {
      // Read state AFTER refresh.mjs has written the fresh contentHashes/pageIds.
      phase = 'publish';
      const state = readState();
      for (const r of publishable) publishCard(r, state, asOfHuman, publishedOk, publishFailed);
    }

    // Step 3: hub gallery table (live roster + static extras).
    phase = 'hub';
    const rows = [...fetchRoster(), ...STATIC_EXTRA_CARDS];
    const table = buildHubTable(rows);

    if (dryRun) {
      console.log(`\nWOULD WRITE HUB TABLE (${rows.length} rows):`);
      console.log(table);
      console.log('\nDry run complete — no claude spawned, state and Notion untouched.');
      dryRunExit = true; // skip the REL#2 log append for the dry-run early exit
      return;
    }

    hubRefreshed = refreshHub(table, asOfHuman, rows.length);
    phase = 'done';
  } catch (e) {
    fatalError = e;
    // Distinct fatal marker so a watchdog can grep the run apart from soft failures.
    console.error(`[sweep] FATAL phase=${phase}: ${e && e.stack ? e.stack : (e && e.message) || e}`);
  } finally {
    // REL#2: ALWAYS record one run-log row — except on the dry-run early exit.
    if (!dryRunExit) {
      try {
        mkdirSync(LOGS_DIR, { recursive: true });
        appendFileSync(SWEEP_LOG_PATH, `${JSON.stringify({
          ts: new Date().toISOString(),
          phase,
          error: fatalError ? (fatalError.message || String(fatalError)) : null,
          ntnVersion: version,
          refreshed,
          publishedOk,
          publishFailed,
          hubRefreshed,
        })}\n`, 'utf8');
      } catch (logErr) {
        console.error(`[sweep] WARN: could not append run-log: ${logErr.message}`);
      }
    }
  }

  // Dry run is always a clean exit — it attempts no publish and no hub write.
  if (dryRunExit) process.exit(0);

  // Step 5: exit red if anything we attempted failed (fatal, a publish, or hub).
  const failed = !!fatalError || publishFailed.length > 0 || !hubRefreshed;

  // REL#4 heartbeat: only stamp last-success.json on a fully green run.
  if (!failed) {
    try {
      writeFileSync(HEARTBEAT_PATH, `${JSON.stringify({
        ts: new Date().toISOString(),
        publishedOk,
        cards: refreshed,
      }, null, 2)}\n`, 'utf8');
    } catch (hbErr) {
      console.error(`[sweep] WARN: could not write heartbeat: ${hbErr.message}`);
    }
  }

  process.exit(failed ? 1 : 0);
}

// Only run the sweep when executed directly (not when imported by the tests,
// which pull in the pure classifyHostKind / buildHubTable exports).
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invoked && invoked === realpathSync(fileURLToPath(import.meta.url))) main();
