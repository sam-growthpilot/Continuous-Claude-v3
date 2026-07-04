// assembler.mjs — PURE, zero-LLM HTML card assembler.
// Given a normalized project + normalized decisions, produce a self-contained
// bento status card (byte-identical for identical inputs). Every interpolated
// DB value is HTML-escaped; nothing raw from Notion reaches the markup.
//
// The assembler does NO I/O. History reads (readSeries) and attention scoring
// are done by refresh.mjs and passed IN via opts.series / opts.attention. When
// opts.attention is absent (e.g. unit tests) the assembler falls back to the
// SAME pure computeAttention used everywhere else, adapting the normalized
// project field names to attention's expected shape.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { esc } from './lib/util.mjs';
import { computeAttention } from './lib/attention.mjs';

// Re-export the shared escaper so callers/tests can import it from here too.
// Single canonical implementation lives in lib/util.mjs (identical semantics).
export { esc };

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(join(HERE, 'template.html'), 'utf8');
const REPORTING_HUB = 'https://app.notion.com/p/38f76fd7ac8280478e50dd2956ba6e8a';

// Health -> sparkline value (higher = healthier) and end-dot color.
const HEALTH_HEX = { green: '#2F7D5B', yellow: '#B07816', red: '#C0392B' };
function healthValue(h) {
  const k = String(h ?? '').trim().toLowerCase();
  if (k === 'green') return 3;
  if (k === 'yellow') return 2;
  if (k === 'red') return 1;
  return null;
}
function healthHex(h) {
  const k = String(h ?? '').trim().toLowerCase();
  return HEALTH_HEX[k] || '#66707A';
}

// Map a Health select value to the modifier class.
// GREEN requires an explicit "Green" — anything unknown/empty/missing maps to
// the NEUTRAL (gray) state so an absent Health never renders as healthy-green.
function healthClass(health) {
  const h = String(health || '').toLowerCase();
  if (h === 'green' || h === 'yellow' || h === 'red') return h;
  return 'neutral';
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

// Trim a string to a max length on a word-ish boundary, adding an ellipsis.
function trim(s, max = 140) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

// Adapt a normalized project (refresh field names) into the shape
// computeAttention expects. Accepts either the ISO-suffixed names or the
// plain names so the fallback is correct no matter which the caller used.
function attentionInput(project) {
  const p = project || {};
  return {
    health: p.health,
    decisionNeeded: p.decisionNeeded,
    lastEditedISO: p.lastEditedISO || p.lastEdited || null,
    reviewDateISO: p.reviewDateISO || p.reviewDate || null,
  };
}

// Recent progress: date · bold Output · the actual Decision/Finding text
// (falling back to Why It Matters) when present, trimmed.
function buildProgressRows(decisions) {
  if (!decisions.length) {
    return '        <li><span class="d"></span><span>No recent updates logged.</span></li>';
  }
  return decisions
    .map((d) => {
      const date = esc(mmdd(d.lastEdited));
      const detail = d.decisionFinding || d.whyItMatters || '';
      const tail = detail ? ` &mdash; ${esc(trim(detail))}` : '';
      return `        <li><span class="d">${date}</span><span><b>${esc(d.output)}</b>${tail}</span></li>`;
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

// Watch block renders when the project needs attention: Yellow/Red health, a
// pending decision, staleness (>14d since last edit), or an overdue review.
function buildWatchBlock(project, hClass, attention) {
  const a = attention || {};
  const items = [];
  if (project.decisionNeeded) items.push('Decision needed — see current focus / latest update');
  if (hClass === 'yellow') items.push('Health Yellow — monitor for slippage');
  if (hClass === 'red') items.push('Health Red — active risk, needs intervention');
  if (a.stale) items.push(`⏳ ${a.staleDays}d since last update`);
  if (a.reviewDays != null && a.reviewDays < 0) {
    items.push(`\u{1F4C5} Review overdue ${-a.reviewDays}d`);
  }
  if (!items.length) return '';
  const lis = items
    .map((w) => `        <li><span class="w">▲</span><span>${esc(w)}</span></li>`)
    .join('\n');
  return `      <div class="cap" style="margin-top:14px;">Watch</div>\n      <ul class="watch">\n${lis}\n      </ul>`;
}

// Compute real stat tiles from the project + its Decisions & Outputs + the
// (already-computed) attention. Every tile omitted when it has no data, so the
// row shows 0..5 tiles. `cls` drives the warn/crit color accents in the CSS.
function computeStats(project, decisions, attention) {
  const a = attention || {};
  const tiles = [];
  const n = decisions.length;

  if (n > 0) {
    tiles.push({ value: String(n), label: 'D&O logged' });
    const shipped = decisions.filter((d) => /ship|done|complete|live|closed/i.test(d.status || '')).length;
    tiles.push({ value: String(shipped), label: 'shipped' });
    const pending = decisions.filter((d) => /pending decision|needs review/i.test(d.status || '')).length;
    tiles.push({ value: String(pending), label: 'pending', cls: pending > 0 ? 'warn' : '' });
  }

  // Days since Last Edited (only when we actually have a Last Edited time).
  if ((project.lastEdited || project.lastEditedISO) && a.staleDays != null) {
    tiles.push({ value: `${a.staleDays}d`, label: 'since edit', cls: a.stale ? 'warn' : '' });
  }

  // Review date: "Nd to review" or "OVERDUE Nd" with escalating styling.
  if (a.reviewDays != null) {
    const rd = a.reviewDays;
    if (rd < 0) tiles.push({ value: `${-rd}d`, label: 'OVERDUE', cls: 'crit' });
    else tiles.push({ value: `${rd}d`, label: 'to review', cls: rd <= 7 ? 'warn' : '' });
  }

  return tiles;
}

function buildStatsRow(tiles) {
  if (!tiles || !tiles.length) return '';
  const cells = tiles
    .map((s) => {
      const cls = s.cls ? ` class="${s.cls}"` : '';
      return `        <div${cls}><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`;
    })
    .join('\n');
  return `      <div class="stats">\n${cells}\n      </div>`;
}

// Self-contained inline-SVG sparkline of the health series (Green/Yellow/Red ->
// 3/2/1). Integer coordinates + fixed strings => identical series yields a
// byte-identical SVG (no external refs, no randomness, no time input).
const SPARK_W = 76;
const SPARK_H = 20;
const SPARK_PAD = 3;
function buildSparkline(series) {
  const pts = (Array.isArray(series) ? series : [])
    .map((s) => ({ raw: s && s.health, v: healthValue(s && s.health) }))
    .filter((p) => p.v != null);
  if (pts.length < 2) return '';
  const n = pts.length;
  const innerW = SPARK_W - SPARK_PAD * 2;
  const innerH = SPARK_H - SPARK_PAD * 2;
  const stepX = innerW / (n - 1);
  const coords = pts.map((p, i) => {
    const x = SPARK_PAD + i * stepX;
    const t = (p.v - 1) / 2; // 0 (red) .. 1 (green)
    const y = SPARK_PAD + (1 - t) * innerH; // green at top
    return [Math.round(x), Math.round(y)];
  });
  const poly = coords.map(([x, y]) => `${x},${y}`).join(' ');
  const [lx, ly] = coords[coords.length - 1];
  const dot = healthHex(pts[pts.length - 1].raw);
  return (
    `<svg class="spark" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}"`
    + ` role="img" aria-label="health trend">`
    + `<polyline points="${poly}" fill="none" stroke="#66707A" stroke-width="1.5"`
    + ` stroke-linejoin="round" stroke-linecap="round"/>`
    + `<circle cx="${lx}" cy="${ly}" r="2.4" fill="${dot}"/></svg>`
  );
}

// "▼ was Yellow · now Green" note, derived from the series (needs >=2 comparable
// points and an actual change). Direction is authoritative from the series; it
// agrees with attention.trend by construction (same series feeds both).
function buildTrendNote(series) {
  const pts = (Array.isArray(series) ? series : [])
    .map((s) => ({ raw: s && s.health, v: healthValue(s && s.health) }))
    .filter((p) => p.v != null);
  if (pts.length < 2) return '';
  const prev = pts[pts.length - 2];
  const cur = pts[pts.length - 1];
  if (prev.v === cur.v) return '';
  const up = cur.v > prev.v;
  return `<span class="tnote ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} was ${esc(prev.raw)} &middot; now ${esc(cur.raw)}</span>`;
}

// The sparkline + trend note are LIVE decorations, gated on `asOf` exactly like
// the as-of stamp. refresh computes the content hash from the canonical render
// (asOf=''), which therefore NEVER contains them — so a growing health series
// can never churn the hash. This makes the "sparkline + as-of excluded from the
// content hash" contract self-contained: it holds regardless of whether refresh
// passes `series` to the canonical call. For any given (asOf, series) the block
// is fully deterministic.
function buildTrendBlock(series, asOf) {
  if (!asOf) return '';
  const spark = buildSparkline(series);
  const note = buildTrendNote(series);
  if (!spark && !note) return '';
  const inner = [spark, note].filter(Boolean).join(' ');
  return `  <div class="trendbar">${inner}</div>`;
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
//   opts.asOf       volatile stamp (excluded from the content hash by refresh);
//                   also gates the LIVE sparkline/trend decorations.
//   opts.series     health series [{date,health}] oldest->newest (from history);
//                   drives the sparkline + trend note. Passed IN by refresh.
//   opts.attention  precomputed attention (from lib/attention computeAttention).
//                   When omitted, computed here from project + series (pure).
//   opts.now        injectable clock for the attention fallback (tests).
export function assembleCard(project, decisions = [], opts = {}) {
  const hClass = healthClass(project.health);
  const asOf = opts.asOf ?? '';
  const series = Array.isArray(opts.series) ? opts.series : [];
  const attention =
    opts.attention || computeAttention(attentionInput(project), series, opts.now ?? new Date());
  const projectLabel = opts.projectLabel || `Living Status Card · ${project.name}`;
  const refreshNote =
    opts.refreshNote ||
    `auto-refreshed by the project-card engine · manual: /project-card refresh ${project.name}`;

  const tokens = {
    HEALTH_CLASS: hClass,
    HEALTH_UPPER: hClass === 'neutral' ? 'UNKNOWN' : esc(String(project.health).toUpperCase()),
    PROJECT_LABEL: esc(projectLabel),
    AS_OF: esc(asOf),
    TITLE: esc(project.name),
    SUBTITLE: esc(project.latestUpdate || project.strategicBet || ''),
    TREND_BLOCK: buildTrendBlock(series, asOf),
    CURRENT_FOCUS: esc(project.currentFocus || '—'),
    NEXT_MILESTONE: esc(project.nextMilestone || '—'),
    DECISION_NEEDED: buildDecisionNeeded(project),
    OVERVIEW_DECK: esc(project.strategicBet || project.latestUpdate || project.currentFocus || '—'),
    PROGRESS_ROWS: buildProgressRows(decisions),
    STATS_ROW: buildStatsRow(computeStats(project, decisions, attention)),
    NEXT_STEPS: buildNextSteps(decisions),
    WATCH_BLOCK: buildWatchBlock(project, hClass, attention),
    EVIDENCE_ROWS: buildEvidenceRows(decisions),
    FOOT_LINKS: buildFootLinks(project),
    REFRESH_NOTE: esc(refreshNote),
  };

  // Single-pass substitution over the TEMPLATE only. Because we scan the
  // template (not the growing output), a field value that itself contains a
  // "{{TOKEN}}" sequence is emitted verbatim (already esc()'d) and can NEVER be
  // re-interpreted as a template token — closing the replaceAll injection hole.
  // Any template token with no matching value fails loud rather than shipping a
  // card with a literal {{TOKEN}} in it.
  const html = TEMPLATE.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(tokens, key)) {
      throw new Error(`assembleCard: unresolved template token ${match}`);
    }
    return tokens[key];
  });
  return html;
}
