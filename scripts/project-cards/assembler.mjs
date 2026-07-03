// assembler.mjs — PURE, zero-LLM HTML card assembler.
// Given a normalized project + normalized decisions, produce a self-contained
// bento status card (byte-identical for identical inputs). Every interpolated
// DB value is HTML-escaped; nothing raw from Notion reaches the markup.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(HERE, 'template.html'), 'utf8');
const REPORTING_HUB = 'https://app.notion.com/p/38f76fd7ac8280478e50dd2956ba6e8a';

// HTML-escape any value before it touches the template.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

// Map a Health select value to the modifier class + display label.
function healthClass(health) {
  const h = String(health || '').toLowerCase();
  if (h === 'yellow' || h === 'red' || h === 'green') return h;
  return 'green';
}

// MM/DD (UTC) from an ISO timestamp — deterministic, no local-time drift.
function mmdd(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

function buildProgressRows(decisions) {
  if (!decisions.length) {
    return '        <li><span class="d"></span><span>No recent updates logged.</span></li>';
  }
  return decisions
    .map((d) => {
      const date = esc(mmdd(d.lastEdited));
      const why = d.whyItMatters ? ` &mdash; ${esc(d.whyItMatters)}` : '';
      return `        <li><span class="d">${date}</span><span><b>${esc(d.output)}</b>${why}</span></li>`;
    })
    .join('\n');
}

function buildNextSteps(decisions) {
  const steps = decisions.map((d) => d.nextStep).filter(Boolean);
  if (!steps.length) {
    return '        <li><span class="n">1</span><span>No open next steps.</span></li>';
  }
  return steps
    .map((s, i) => `        <li><span class="n">${i + 1}</span><span>${esc(s)}</span></li>`)
    .join('\n');
}

function buildEvidenceRows(decisions) {
  const linked = decisions.filter((d) => d.link);
  if (!linked.length) return '          No linked evidence yet.';
  return linked
    .map((d, i) => `          [${i + 1}] <a href="${esc(d.link)}">${esc(d.output)}</a><br>`)
    .join('\n');
}

// Watch block only renders when the project needs attention.
function buildWatchBlock(project, hClass) {
  const show = hClass === 'yellow' || hClass === 'red' || project.decisionNeeded;
  if (!show) return '';
  const items = [];
  if (project.decisionNeeded) items.push('Decision needed — see current focus / latest update');
  if (hClass === 'yellow') items.push('Health Yellow — monitor for slippage');
  if (hClass === 'red') items.push('Health Red — active risk, needs intervention');
  if (!items.length) return '';
  const lis = items
    .map((w) => `        <li><span class="w">▲</span><span>${esc(w)}</span></li>`)
    .join('\n');
  return `      <div class="cap" style="margin-top:14px;">Watch</div>\n      <ul class="watch">\n${lis}\n      </ul>`;
}

function buildStatsRow(stats) {
  if (!stats || !stats.length) return '';
  const cells = stats
    .map((s) => `        <div><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`)
    .join('\n');
  return `      <div class="stats">\n${cells}\n      </div>`;
}

function buildDecisionNeeded(project) {
  return project.decisionNeeded
    ? '<span style="color:var(--crit); font-weight:600;">Decision needed</span>'
    : '<span style="color:var(--dim); font-weight:400;">None</span>';
}

function buildFootLinks(project) {
  const links = [];
  if (project.projectPage) links.push(`<a href="${esc(project.projectPage)}">project page</a>`);
  links.push(`<a href="${REPORTING_HUB}">Reporting Hub</a>`);
  return links.join(' &middot; ');
}

// assembleCard(project, decisions, opts) -> HTML string.
// opts.asOf is the volatile stamp (excluded from the content hash by the caller).
export function assembleCard(project, decisions = [], opts = {}) {
  const hClass = healthClass(project.health);
  const asOf = opts.asOf ?? '';
  const projectLabel = opts.projectLabel || `Living Status Card · ${project.name}`;
  const refreshNote =
    opts.refreshNote ||
    `auto-refreshed by the project-card engine · manual: /project-card refresh ${project.name}`;

  const tokens = {
    HEALTH_CLASS: hClass,
    HEALTH_UPPER: esc((project.health || 'Green').toUpperCase()),
    PROJECT_LABEL: esc(projectLabel),
    AS_OF: esc(asOf),
    TITLE: esc(project.name),
    SUBTITLE: esc(project.latestUpdate || project.strategicBet || ''),
    CURRENT_FOCUS: esc(project.currentFocus || '—'),
    NEXT_MILESTONE: esc(project.nextMilestone || '—'),
    DECISION_NEEDED: buildDecisionNeeded(project),
    OVERVIEW_DECK: esc(project.strategicBet || project.latestUpdate || project.currentFocus || '—'),
    PROGRESS_ROWS: buildProgressRows(decisions),
    STATS_ROW: buildStatsRow(project.stats),
    NEXT_STEPS: buildNextSteps(decisions),
    WATCH_BLOCK: buildWatchBlock(project, hClass),
    EVIDENCE_ROWS: buildEvidenceRows(decisions),
    FOOT_LINKS: buildFootLinks(project),
    REFRESH_NOTE: esc(refreshNote),
  };

  let html = TEMPLATE;
  for (const [key, value] of Object.entries(tokens)) {
    html = html.replaceAll(`{{${key}}}`, value);
  }
  return html;
}
