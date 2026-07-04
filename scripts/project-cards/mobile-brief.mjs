// mobile-brief.mjs — PURE renderer for the phone-first morning brief page.
// Given the pre-built attention queue (lib/queue.mjs buildQueue output) plus
// the roster and timestamps, it emits ONE self-contained HTML string designed
// for a phone screen: single column, big tap targets, the ranked queue open
// by default, and everything "operating normally" tucked into a collapsed
// disclosure. No I/O, no clock reads — the caller supplies asOf/lastSweep.
//
// buildMobileBriefHtml({ queue, roster, asOf, lastSweep }) -> string (HTML)
//
//   queue:     { items: [{ rank, level, kind, title, reason, url }],
//                normal: [{ kind, title, url }] }   (from buildQueue)
//   roster:    normalized roster array (used only for the headline count)
//   asOf:      Date | ISO string | ms  (defaults to new Date())
//   lastSweep: optional { ts, ok } — same contract as cockpit.mjs.
//
// Deep links: an item url that is already absolute is used as-is; a bare
// Notion page id (with or without dashes) becomes
// https://www.notion.so/<id-nodash>. All links open in a new tab.
//
// Visual identity reuses the cockpit.mjs token set (same palette / fonts) with
// a prefers-color-scheme dark override, so the brief reads as the mobile
// edition of the same publication.

import { esc, dateStamp } from './lib/util.mjs';

// A daily sweep older than this (or one that reported not-ok) is flagged.
const SWEEP_STALE_MS = 26 * 60 * 60 * 1000; // 26h — one missed daily run.

const KIND_LABEL = {
  project: 'Project', task: 'Task', decision: 'Decision', sponsor: 'Sponsor',
};

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
  return `${Math.floor(hr / 24)}d ago`;
}

// Resolve an item url to a browsable href. Absolute urls pass through; a bare
// Notion page id (32 hex chars, dashes optional) becomes a notion.so link.
// Anything else yields null (item renders without a link).
export function toHref(url) {
  const s = String(url ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const nodash = s.replace(/-/g, '');
  if (/^[0-9a-f]{32}$/i.test(nodash)) return `https://www.notion.so/${nodash}`;
  return null;
}

// One ranked queue row. Whole row is the tap target when a link exists.
function queueRow(item) {
  const lvl = item.level === 'high' ? 'high' : 'med';
  const kind = KIND_LABEL[item.kind] || esc(item.kind);
  const inner =
    `<span class="rk">${item.rank}</span>` +
    `<span class="body"><b class="ttl">${esc(item.title)}</b>` +
    `<span class="meta"><span class="kd">${kind}</span>${esc(item.reason)}</span></span>`;
  const href = toHref(item.url);
  const core = href
    ? `<a class="tap" target="_blank" rel="noopener" href="${esc(href)}">${inner}</a>`
    : `<span class="tap">${inner}</span>`;
  return `      <li class="qi ${lvl}">${core}</li>`;
}

// One "operating normally" row (collapsed section).
function normalRow(entry) {
  const kind = KIND_LABEL[entry.kind] || esc(entry.kind);
  const href = toHref(entry.url);
  const title = href
    ? `<a target="_blank" rel="noopener" href="${esc(href)}">${esc(entry.title)}</a>`
    : esc(entry.title);
  return `      <li class="ni"><span class="kd">${kind}</span>${title}</li>`;
}

export function buildMobileBriefHtml(opts = {}) {
  const queue = opts.queue && typeof opts.queue === 'object' ? opts.queue : {};
  const items = Array.isArray(queue.items) ? queue.items : [];
  const normal = Array.isArray(queue.normal) ? queue.normal : [];
  const roster = Array.isArray(opts.roster) ? opts.roster : [];
  const lastSweep = opts.lastSweep;

  const nowMs = Number.isFinite(toMs(opts.asOf)) ? toMs(opts.asOf) : Date.now();
  const asOfLabel = esc(dateStamp(new Date(nowMs)));

  const highCount = items.filter((i) => i.level === 'high').length;

  const queueHtml = items.length
    ? items.map(queueRow).join('\n')
    : '      <li class="none">Nothing needs you — all clear. ✅</li>';

  const normalHtml = normal.length
    ? normal.map(normalRow).join('\n')
    : '      <li class="none">Nothing else on record.</li>';

  // Sweep-health footer (same semantics as cockpit.mjs).
  let sweepHtml;
  if (lastSweep && Number.isFinite(toMs(lastSweep.ts))) {
    const span = nowMs - toMs(lastSweep.ts);
    const bad = lastSweep.ok === false || span > SWEEP_STALE_MS;
    sweepHtml = bad
      ? `<span class="sweep warn">⚠ last sweep ${lastSweep.ok === false ? 'reported a failure' : 'is stale'} (${esc(agoText(span))})</span>`
      : `<span class="sweep ok">last sweep ✓ ${esc(agoText(span))}</span>`;
  } else {
    sweepHtml = '<span class="sweep warn">⚠ no sweep recorded</span>';
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FourthOS Morning Brief</title>
<style>
  :root { --ground:#EFF2F4; --ink:#14181D; --cell:#FFFFFF; --dim:#66707A; --line:#DBE0E4;
          --teal:#0E6E64; --ok:#2F7D5B; --warn:#B07816; --crit:#C0392B; }
  @media (prefers-color-scheme: dark) {
    :root { --ground:#14181D; --ink:#E8ECEF; --cell:#1C2229; --dim:#8B96A0; --line:#2C343D;
            --teal:#3FB3A5; --ok:#4CAF7D; --warn:#D9A441; --crit:#E06152; }
  }
  * { box-sizing:border-box; margin:0; }
  body { font:16px/1.55 "Segoe UI", system-ui, sans-serif; background:var(--ground); color:var(--ink);
         padding:14px; -webkit-text-size-adjust:100%; }
  .wrap { max-width:560px; margin:0 auto; }

  .masthead { display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;
              border-top:2px solid var(--ink); border-bottom:1px solid var(--line); padding:7px 2px; margin-bottom:12px;
              font-size:11px; text-transform:uppercase; letter-spacing:.12em; color:var(--dim); }
  h1 { font-family:"Palatino Linotype", Palatino, Georgia, serif; font-size:26px; line-height:1.15; margin:0 0 4px; }
  .sub { color:var(--dim); font-size:14px; margin-bottom:14px; }
  .sub b { color:var(--ink); }

  details { background:var(--cell); border:1px solid var(--line); border-radius:8px; margin-bottom:12px; overflow:hidden; }
  summary { list-style:none; cursor:pointer; min-height:44px; display:flex; align-items:center; gap:8px;
            padding:10px 14px; font-size:12px; text-transform:uppercase; letter-spacing:.1em; color:var(--dim);
            -webkit-tap-highlight-color:transparent; }
  summary::-webkit-details-marker { display:none; }
  summary::after { content:"▾"; margin-left:auto; color:var(--dim); transition:transform .15s; }
  details:not([open]) summary::after { transform:rotate(-90deg); }
  .cnt { background:var(--ground); border:1px solid var(--line); border-radius:10px; padding:1px 8px;
         font-size:11px; font-weight:700; color:var(--ink); }

  ul { list-style:none; padding:0 10px 8px; }
  .qi { border-top:1px solid var(--line); }
  .qi .tap { display:flex; align-items:flex-start; gap:12px; min-height:44px; padding:11px 4px;
             color:inherit; text-decoration:none; }
  .qi .rk { flex:none; width:28px; height:28px; border-radius:7px; display:flex; align-items:center; justify-content:center;
            font-size:13px; font-weight:700; font-variant-numeric:tabular-nums; color:#fff; background:var(--warn); }
  .qi.high .rk { background:var(--crit); }
  .qi .body { flex:1; min-width:0; }
  .qi .ttl { display:block; font-weight:600; font-size:16px; }
  .qi .meta { display:block; font-size:13px; color:var(--dim); margin-top:1px; }
  .kd { display:inline-block; font-size:10.5px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim);
        background:var(--ground); border:1px solid var(--line); border-radius:4px; padding:1px 6px; margin-right:7px; }
  .ni { display:flex; align-items:center; gap:8px; min-height:44px; padding:10px 4px; border-top:1px solid var(--line);
        font-size:15px; }
  .ni a { color:var(--teal); text-decoration:none; }
  .none { padding:12px 4px; color:var(--dim); font-size:14px; }

  .foot { margin-top:4px; padding-top:10px; border-top:1px solid var(--line); font-size:12px; color:var(--dim);
          display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; }
  .sweep.ok { color:var(--ok); font-weight:600; }
  .sweep.warn { color:var(--crit); font-weight:600; }
</style>
</head>
<body>
<div class="wrap">
  <div class="masthead">
    <span>FourthOS</span>
    <span>Morning Brief</span>
  </div>

  <h1>Good morning</h1>
  <p class="sub"><b>${items.length}</b> item${items.length === 1 ? '' : 's'} need${items.length === 1 ? 's' : ''} you (${highCount} high) · ${roster.length} project${roster.length === 1 ? '' : 's'} tracked</p>

  <details open>
    <summary>Needs your attention <span class="cnt">${items.length}</span></summary>
    <ul>
${queueHtml}
    </ul>
  </details>

  <details>
    <summary>Operating normally <span class="cnt">${normal.length}</span></summary>
    <ul>
${normalHtml}
    </ul>
  </details>

  <div class="foot">
    <span>as of ${asOfLabel}</span>
    ${sweepHtml}
  </div>
</div>
</body>
</html>
`;
}
