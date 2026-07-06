// cockpit.mjs — the FLAGSHIP portfolio "operating picture" for the living-cards
// engine. Given a normalized roster + per-slug health series, it renders one
// self-contained bento HTML page that answers "what needs my attention?" at a
// glance: a portfolio-health header band, a prioritized "Needs your attention"
// list, an "operating normally" line for the rest, and an as-of / sweep-health
// footer.
//
// PURE: no I/O. The caller supplies roster + seriesBySlug (from history.readSeries)
// + asOf. Attention is defined exactly once, in lib/attention.mjs — this module
// only consumes computeAttention, never re-derives scoring.
//
// buildCockpitHtml({ roster, seriesBySlug, asOf, lastSweep }) -> string (HTML)
//
//   roster:       [{ health, decisionNeeded, lastEditedISO, reviewDateISO,
//                    name, url, slug, status }]
//   seriesBySlug: { [slug]: [{ date, health }] }  (oldest -> newest; [] ok)
//   asOf:         Date | ISO string | ms  (reference "now"; defaults to new Date())
//   lastSweep:    optional { ts, ok }  — ts is ISO/ms/Date, ok is boolean.
//
// Visual identity is inherited from template.html (same CSS tokens/fonts) so the
// cockpit reads as part of the same publication as the individual project cards.

import { computeAttention } from './lib/attention.mjs';
import { esc, dateStamp } from './lib/util.mjs';

// Cap the attention list so a large portfolio can't produce an unbounded page.
// Overflow beyond this is summarized in a trailing note.
const ATTENTION_CAP = 14;

// A daily sweep older than this (or one that reported not-ok) is flagged ⚠.
const SWEEP_STALE_MS = 26 * 60 * 60 * 1000; // 26h — one missed daily run.

// Coerce a Date | ISO string | ms into epoch ms. Returns NaN on bad input.
function toMs(v) {
  if (v == null || v === '') return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return new Date(v).getTime();
}

// "just now" / "5m ago" / "3h ago" / "2d ago" for a span in ms (>= 0).
function agoText(spanMs) {
  if (!Number.isFinite(spanMs) || spanMs < 0) return 'unknown';
  const min = Math.floor(spanMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

// Normalize a health string to one of the three canonical buckets, or '' .
function healthBucket(h) {
  const key = String(h ?? '').trim().toLowerCase();
  return key === 'green' || key === 'yellow' || key === 'red' ? key : '';
}

// Tally portfolio health across the roster.
function tallyHealth(roster) {
  const counts = { green: 0, yellow: 0, red: 0, other: 0 };
  for (const p of roster) {
    const b = healthBucket(p && p.health);
    if (b) counts[b] += 1;
    else counts.other += 1;
  }
  counts.total = roster.length;
  return counts;
}

// One "needs attention" row. `url` links the name when present.
function attentionRow(item) {
  const nameHtml = item.url
    ? `<a href="${esc(item.url)}">${esc(item.name)}</a>`
    : esc(item.name);
  const reasons = item.reasons.length ? esc(item.reasons.join(' · ')) : '—';
  const status = item.status ? `<span class="st">${esc(item.status)}</span>` : '';
  const lvl = item.level === 'high' ? 'high' : 'medium';
  return (
    `        <li class="att ${lvl}">` +
    `<span class="sc" title="attention score">${item.score}</span>` +
    `<span class="body"><b class="nm">${nameHtml}</b>` +
    `<span class="rs">${reasons}</span></span>${status}</li>`
  );
}

export function buildCockpitHtml(opts = {}) {
  const roster = Array.isArray(opts.roster) ? opts.roster : [];
  const seriesBySlug = opts.seriesBySlug && typeof opts.seriesBySlug === 'object'
    ? opts.seriesBySlug : {};
  const asOfInput = opts.asOf;
  const lastSweep = opts.lastSweep;

  // Reference "now" — used for attention scoring AND the sweep-age readout, so
  // the page is internally consistent and deterministic in tests.
  const nowMs = Number.isFinite(toMs(asOfInput)) ? toMs(asOfInput) : Date.now();
  const nowDate = new Date(nowMs);

  const counts = tallyHealth(roster);

  // Score every project through the single attention authority.
  const scored = roster.map((p) => {
    const slug = p && p.slug;
    const series = (slug && Array.isArray(seriesBySlug[slug])) ? seriesBySlug[slug] : [];
    const attention = computeAttention(
      {
        health: p && p.health,
        decisionNeeded: !!(p && p.decisionNeeded),
        lastEditedISO: (p && p.lastEditedISO) || null,
        reviewDateISO: (p && p.reviewDateISO) || null,
      },
      series,
      nowMs,
    );
    return {
      name: (p && p.name) || 'Untitled project',
      url: (p && p.url) || '',
      status: (p && p.status) || '',
      score: attention.score,
      level: attention.level,
      reasons: Array.isArray(attention.reasons) ? attention.reasons : [],
    };
  });

  const needsAttention = scored
    .filter((s) => s.level !== 'none')
    // score desc, then name asc for a stable, deterministic order on ties.
    .sort((a, b) => (b.score - a.score) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const clearCount = scored.length - needsAttention.length;

  const shown = needsAttention.slice(0, ATTENTION_CAP);
  const overflow = needsAttention.length - shown.length;

  // --- attention list markup ---
  let attentionHtml;
  if (needsAttention.length === 0) {
    attentionHtml =
      '        <li class="none">Nothing flagged — the whole portfolio is operating normally. ✅</li>';
  } else {
    attentionHtml = shown.map(attentionRow).join('\n');
    if (overflow > 0) {
      attentionHtml +=
        `\n        <li class="more">+ ${overflow} more flagged` +
        ` (showing top ${ATTENTION_CAP} by score)</li>`;
    }
  }

  // --- all-clear line ---
  let clearHtml = '';
  if (clearCount > 0) {
    const noun = clearCount === 1 ? 'project' : 'projects';
    clearHtml =
      `  <p class="clear"><span class="ok-dot"></span>` +
      `<b>${clearCount}</b> ${noun} operating normally — no action needed.</p>`;
  }

  // --- footer: as-of + sweep health ---
  const asOfLabel = esc(dateStamp(nowDate));
  let sweepHtml;
  if (lastSweep && Number.isFinite(toMs(lastSweep.ts))) {
    const span = nowMs - toMs(lastSweep.ts);
    const stale = span > SWEEP_STALE_MS;
    const failed = lastSweep.ok === false;
    if (failed || stale) {
      const why = failed ? 'reported a failure' : 'is stale';
      sweepHtml = `<span class="sweep warn">⚠ last sweep ${why} (${esc(agoText(span))})</span>`;
    } else {
      sweepHtml = `<span class="sweep ok">last sweep ✓ ${esc(agoText(span))}</span>`;
    }
  } else {
    sweepHtml = '<span class="sweep warn">⚠ no sweep recorded</span>';
  }

  const total = counts.total;
  const otherChip = counts.other > 0
    ? `<div class="hc other"><b>${counts.other}</b><span>Other</span></div>`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FourthOS Cockpit</title>
<style>
  :root { --ground:#EFF2F4; --ink:#14181D; --cell:#FFFFFF; --dim:#66707A; --line:#DBE0E4;
          --teal:#0E6E64; --ochre:#D99A2B; --ok:#2F7D5B; --warn:#B07816; --crit:#C0392B; }
  * { box-sizing:border-box; margin:0; }
  body { font:14.5px/1.6 "Segoe UI", system-ui, sans-serif; background:var(--ground); color:var(--ink); padding:18px; }
  .wrap { max-width:860px; margin:0 auto; }

  .masthead { display:flex; justify-content:space-between; align-items:baseline; gap:10px; flex-wrap:wrap;
              border-top:2px solid var(--ink); border-bottom:1px solid var(--line); padding:8px 2px; margin-bottom:14px;
              font-size:11px; text-transform:uppercase; letter-spacing:.12em; color:var(--dim); }
  h1 { font-family:"Palatino Linotype", Palatino, Georgia, serif; font-size:clamp(24px,4vw,32px); line-height:1.15; margin:0 0 4px; }
  .sub { color:var(--dim); font-size:13.5px; margin-bottom:16px; }

  .band { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:16px; }
  .hc { background:var(--cell); border:1px solid var(--line); border-radius:6px; padding:14px 16px;
        display:flex; flex-direction:column; gap:2px; border-top:3px solid var(--line); }
  .hc b { font-family:"Palatino Linotype", Georgia, serif; font-size:34px; line-height:1; font-variant-numeric:tabular-nums; }
  .hc span { font-size:10.5px; text-transform:uppercase; letter-spacing:.1em; color:var(--dim); }
  .hc.green { border-top-color:var(--ok); } .hc.green b { color:var(--ok); }
  .hc.yellow { border-top-color:var(--warn); } .hc.yellow b { color:var(--warn); }
  .hc.red { border-top-color:var(--crit); } .hc.red b { color:var(--crit); }
  .hc.total { border-top-color:var(--ink); }
  .hc.other { border-top-color:var(--dim); } .hc.other b { color:var(--dim); }

  .cell { background:var(--cell); border:1px solid var(--line); border-radius:6px; padding:16px 18px; margin-bottom:14px; }
  .cap { font-size:10.5px; text-transform:uppercase; letter-spacing:.1em; color:var(--dim); margin-bottom:10px; }

  .list { list-style:none; }
  .att { display:flex; align-items:flex-start; gap:12px; padding:9px 0; border-top:1px solid var(--line); }
  .att:first-child { border-top:none; }
  .att .sc { flex:none; width:26px; height:26px; border-radius:6px; display:flex; align-items:center; justify-content:center;
             font-size:12.5px; font-weight:700; font-variant-numeric:tabular-nums; color:#fff; background:var(--warn); }
  .att.high .sc { background:var(--crit); }
  .att .body { flex:1; min-width:0; }
  .att .nm { font-weight:600; display:block; }
  .att .nm a { color:var(--teal); text-decoration:none; }
  .att .nm a:hover { text-decoration:underline; }
  .att .rs { display:block; font-size:12px; color:var(--dim); line-height:1.5; }
  .att .st { flex:none; align-self:center; font-size:10.5px; text-transform:uppercase; letter-spacing:.08em;
             color:var(--dim); background:var(--ground); border:1px solid var(--line); border-radius:4px; padding:2px 7px; }
  .list .none { padding:9px 0; color:var(--dim); font-size:13.5px; }
  .list .more { padding:9px 0 2px; border-top:1px solid var(--line); color:var(--dim); font-size:12px; }

  .clear { font-size:13px; color:var(--dim); margin-bottom:14px; display:flex; align-items:center; gap:8px; }
  .clear b { color:var(--ink); }
  .ok-dot { width:9px; height:9px; border-radius:50%; background:var(--ok); flex:none; }

  .foot { margin-top:6px; padding-top:10px; border-top:1px solid var(--line); font-size:11.5px; color:var(--dim);
          display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; }
  .sweep.ok { color:var(--ok); font-weight:600; }
  .sweep.warn { color:var(--crit); font-weight:600; }
  @media (max-width:640px){ .band{grid-template-columns:repeat(2,1fr);} }
</style>
</head>
<body>
<div class="wrap">
  <div class="masthead">
    <span>FourthOS Portfolio</span>
    <span>Operating Picture</span>
    <span>as of ${asOfLabel}</span>
  </div>

  <h1>What needs your attention</h1>
  <p class="sub">${total} ${total === 1 ? 'project' : 'projects'} in the portfolio · ${needsAttention.length} flagged</p>

  <div class="band">
    <div class="hc green"><b>${counts.green}</b><span>Green</span></div>
    <div class="hc yellow"><b>${counts.yellow}</b><span>Yellow</span></div>
    <div class="hc red"><b>${counts.red}</b><span>Red</span></div>
    <div class="hc total"><b>${total}</b><span>Total</span></div>
    ${otherChip}
  </div>

  <div class="cell">
    <div class="cap">Needs your attention</div>
    <ul class="list">
${attentionHtml}
    </ul>
  </div>

${clearHtml}

  <div class="foot">
    <span>Generated ${asOfLabel}</span>
    ${sweepHtml}
  </div>
</div>
</body>
</html>
`;
}
