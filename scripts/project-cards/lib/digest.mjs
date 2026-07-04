// digest.mjs — PURE markdown renderer for the AI-digest section of the mobile
// cockpit. Consumes the SAME merged queue as the HTML embed (lib/queue.mjs
// buildQueue output), so the two surfaces can never disagree (plan risk
// mitigation: single source of truth for "what needs Dave today").
//
// buildDigestMarkdown({ queue, roster, asOf }) -> string (plain markdown)
//
//   queue:  { items: [{ rank, level, kind, title, reason, url }], normal: [...] }
//           — exactly what buildQueue returns.
//   roster: [{ name, slug, url, health, status, reviewDateISO, ... }]
//           — same normalized roster fed to buildQueue.
//   asOf:   Date | ISO string | ms (defaults to new Date()).
//
// Output is PLAIN markdown (Notion-AI readable): no HTML, no tables. Sections:
//   1. "Needs attention" — one ranked line per queue item:
//      `N. 🔴 [kind] Title — reason — [open](url)`
//   2. "Projects" — one line per roster project: health / status / next review.
//   3. "Sponsor reporting" — staleness line per sponsor entry in the queue
//      (stale ones from items, current ones from normal).
//   4. Footer: `_Updated: <ISO> by CCv3 sweep. Do not edit by hand._`

const LEVEL_EMOJI = { high: '\u{1F534}', med: '\u{1F7E1}' }; // 🔴 🟡

function toISO(v) {
  const d = v instanceof Date ? v : new Date(v ?? Date.now());
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// Markdown-neutralize titles/reasons so a stray `[` or `_` in a Notion title
// can't break the line structure. Minimal escape — plain readability wins.
function md(s) {
  return String(s ?? '').replace(/([\\`*_[\]])/g, '\\$1');
}

function itemLine(it) {
  const emoji = LEVEL_EMOJI[it.level] ?? '';
  const parts = [`${it.rank}. ${emoji} [${it.kind}] ${md(it.title)}`];
  if (it.reason) parts.push(md(it.reason));
  if (it.url) parts.push(`[open](${it.url})`);
  return parts.join(' — '); // em dash separators
}

function projectLine(p) {
  const bits = [];
  bits.push(`health: ${p.health ? md(p.health) : 'unknown'}`);
  if (p.status) bits.push(`status: ${md(p.status)}`);
  if (p.reviewDateISO) bits.push(`next review: ${String(p.reviewDateISO).slice(0, 10)}`);
  return `- ${md(p.name)} — ${bits.join(' / ')}`;
}

function sponsorLine(entry, stale) {
  const suffix = stale
    ? (entry.reason ? md(entry.reason) : 'stale')
    : 'reported within the last 7 days';
  return `- ${md(entry.title)} — ${suffix}`;
}

export function buildDigestMarkdown(opts = {}) {
  const queue = opts.queue && typeof opts.queue === 'object' ? opts.queue : {};
  const items = Array.isArray(queue.items) ? queue.items : [];
  const normal = Array.isArray(queue.normal) ? queue.normal : [];
  const roster = Array.isArray(opts.roster) ? opts.roster : [];
  const asOfISO = toISO(opts.asOf);

  const lines = [];

  lines.push('## Needs attention');
  lines.push('');
  if (items.length) {
    for (const it of items) lines.push(itemLine(it));
  } else {
    lines.push('Nothing needs attention right now.');
  }
  lines.push('');

  lines.push('## Projects');
  lines.push('');
  if (roster.length) {
    for (const p of roster) lines.push(projectLine(p));
  } else {
    lines.push('No projects on the roster.');
  }
  lines.push('');

  const staleSponsors = items.filter((i) => i.kind === 'sponsor');
  const freshSponsors = normal.filter((n) => n.kind === 'sponsor');
  if (staleSponsors.length || freshSponsors.length) {
    lines.push('## Sponsor reporting');
    lines.push('');
    for (const s of staleSponsors) lines.push(sponsorLine(s, true));
    for (const s of freshSponsors) lines.push(sponsorLine(s, false));
    lines.push('');
  }

  lines.push(`_Updated: ${asOfISO} by CCv3 sweep. Do not edit by hand._`);
  lines.push('');

  return lines.join('\n');
}
