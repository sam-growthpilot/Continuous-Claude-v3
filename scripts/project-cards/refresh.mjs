// refresh.mjs — CLI entry for the living project-card engine.
//   node refresh.mjs "<project name>"     refresh one card
//   node refresh.mjs --all                refresh every FourthOS Projects row
//
// Pipeline (per project): resolve row -> fetch Decisions & Outputs -> assemble
// HTML -> hash (AS_OF excluded) -> compare state -> write out/<slug>.html + emit
// a publish manifest. The engine NEVER calls the Notion MCP or claude -p; the
// /project-card skill consumes the manifest and does the one MCP embed-bind step.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ntnVersion,
  queryProjects,
  getProjectByName,
  queryDecisionsForProject,
  title,
  richText,
  selectName,
  statusName,
  checkbox,
  urlVal,
  multiSelect,
  dateStart,
} from './lib/notion.mjs';
import { assembleCard } from './assembler.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'out');
const STATE_PATH = join(HERE, 'state.json');
const CARD_HEADING = '## 📊 Living Status Card';

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'card';
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// Extract a Notion page id from a URL, or null if it is not a Notion link.
function notionPageId(url) {
  if (!url || !/notion\.(so|com)/i.test(url)) return null;
  const m = url.match(/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i)
    || url.match(/[0-9a-f]{32}/i);
  return m ? m[0].replace(/-/g, '') : null;
}

function asOfStamp(d = new Date()) {
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function normalizeProject(page) {
  const p = page.properties || {};
  return {
    rowId: page.id,
    name: title(p.Project),
    health: selectName(p.Health),
    currentFocus: richText(p['Current Focus']),
    nextMilestone: richText(p['Next Milestone']),
    decisionNeeded: checkbox(p['Decision Needed?']),
    latestUpdate: richText(p['Latest Update']),
    strategicBet: richText(p['Strategic Bet']),
    status: statusName(p.Status),
    sponsors: richText(p['Sponsors / Stakeholders']),
    projectPage: urlVal(p['Project Page']),
    lastEdited: page.last_edited_time,
    pillars: multiSelect(p.Pillar),
    outcomeTypes: multiSelect(p['Outcome Type']),
    reviewDate: dateStart(p['Review Date']),
    stats: [],
  };
}

function normalizeDecision(page) {
  const p = page.properties || {};
  return {
    output: title(p.Output),
    whyItMatters: richText(p['Why It Matters']),
    decisionFinding: richText(p['Decision / Finding']),
    nextStep: richText(p['Next Step']),
    impact: selectName(p.Impact),
    type: selectName(p.Type),
    status: statusName(p.Status),
    link: urlVal(p.Link),
    lastEdited: page.last_edited_time,
  };
}

function readState() {
  if (!existsSync(STATE_PATH)) return { cards: {} };
  const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  raw.cards = raw.cards || {};
  return raw;
}

// Atomic write: temp file + rename (never a torn state.json / card).
function atomicWrite(path, contents) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  renameSync(tmp, path);
}

// Refresh one project; mutate `state`; return a manifest object.
function refreshProject(projectPage, state) {
  const project = normalizeProject(projectPage);
  const decisions = queryDecisionsForProject(project.rowId, 5).map(normalizeDecision);
  const slug = slugify(project.name);

  const html = assembleCard(project, decisions, { asOf: asOfStamp() });
  const canonical = assembleCard(project, decisions, { asOf: '' });
  const contentHash = sha256(canonical);

  const nowIso = new Date().toISOString();
  const prev = state.cards[slug];
  const published = !!(prev && prev.lastPublished);
  const pageId = (prev && prev.pageId) || notionPageId(project.projectPage);
  const htmlPath = join(OUT_DIR, `${slug}.html`);

  // No-op when the canonical content is unchanged AND the card is already on disk.
  // `needsPublish` still flags an unpublished (or publish-failed) card so the skill
  // publishes it even though the content itself did not change.
  if (prev && prev.contentHash === contentHash && existsSync(htmlPath)) {
    state.cards[slug] = { ...prev, projectRowId: project.rowId, lastRefreshAttempt: nowIso };
    return {
      projectName: project.name, slug, pageId, htmlPath, contentHash,
      changed: false, needsPublish: !published, cardSectionHeading: CARD_HEADING,
    };
  }

  mkdirSync(OUT_DIR, { recursive: true });
  atomicWrite(htmlPath, html);

  state.cards[slug] = {
    projectRowId: project.rowId,
    pageId: pageId || null,
    attachmentId: (prev && prev.attachmentId) || null,
    contentHash,
    lastPublished: (prev && prev.lastPublished) || null,
    lastRefreshAttempt: nowIso,
  };

  return {
    projectName: project.name,
    slug,
    pageId: pageId || null,
    htmlPath,
    contentHash,
    changed: true,
    needsPublish: true,
    cardSectionHeading: CARD_HEADING,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node refresh.mjs "<project name>" | --all');
    process.exit(2);
  }

  const version = ntnVersion();
  console.error(`ntn ${version}`); // human-facing contract log; stdout stays pure JSON

  const state = readState();
  let output;

  if (args[0] === '--all') {
    const pages = queryProjects({ pageSize: 100 });
    const results = pages.map((pg) => refreshProject(pg, state));
    output = { ntnVersion: version, count: results.length, results };
  } else {
    const name = args.join(' ');
    const page = getProjectByName(name);
    const manifest = refreshProject(page, state);
    output = { ntnVersion: version, ...manifest };
  }

  atomicWrite(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
