// queue.mjs — PURE shared collector/ranker for the mobile cockpit attention
// queue. ONE merged ranked queue consumed by BOTH the HTML embed renderer and
// the AI-digest renderer, so the two surfaces can never disagree (plan risk
// mitigation: single source of truth for "what needs Dave today").
//
// Projects are scored via the existing lib/attention.mjs computeAttention —
// imported, never re-derived here. Tasks / decisions / sponsor reports use
// simple v0 age/severity rules documented inline.
//
// buildQueue({ roster, seriesBySlug, tasks, decisions, sponsorReports, now })
//   -> { items: [{ rank, level, kind, title, reason, url }], normal: [...] }
//
// Normalized input shapes (all fields already extracted by the caller):
//   roster:         [{ name, slug, url, health, decisionNeeded,
//                      lastEditedISO, reviewDateISO }]
//   seriesBySlug:   { [slug]: [{ date, health }] }   (oldest -> newest; [] ok)
//   tasks:          [{ title, url, status, blocked, dueISO }]
//   decisions:      [{ title, url, open, openedISO }]
//   sponsorReports: [{ title, url, lastReportISO }]
//   now:            Date or ms (injectable for deterministic tests)
//
// ── v0 rules ──────────────────────────────────────────────────────────────────
//   project:  computeAttention level 'high' -> high, 'medium' -> med,
//             'none' -> normal. Reason = joined attention reasons.
//   task:     status 'done' skipped entirely. blocked -> high ("blocked").
//             overdue or due today -> high ("overdue Nd" / "due today").
//             otherwise -> normal.
//   decision: open -> high ("decision needed"). closed -> normal.
//   sponsor:  last report > 7 days old (or never) -> med ("report stale Nd").
//             otherwise -> normal.
//
// ── Deterministic ordering ────────────────────────────────────────────────────
//   level (high before med), then age descending (older = more urgent; missing
//   age sorts last within its level), then title ascending. rank is 1-based
//   over the sorted items.

import { computeAttention } from './attention.mjs';

const DAY_MS = 86400000;
const SPONSOR_STALE_DAYS = 7;
const LEVEL_ORDER = { high: 0, med: 1 };

function toMs(now) {
  return now instanceof Date ? now.getTime() : Number(now);
}

// Whole days since an ISO timestamp (positive = in the past). null if invalid.
function daysSince(iso, nowMs) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((nowMs - t) / DAY_MS);
}

function normalEntry(kind, title, url) {
  return { kind, title: String(title ?? ''), url: url ?? null };
}

function collectProjects(roster, seriesBySlug, now, items, normal) {
  for (const p of roster) {
    const slug = p && p.slug;
    const series = (slug && Array.isArray(seriesBySlug[slug])) ? seriesBySlug[slug] : [];
    const att = computeAttention(p, series, now);
    if (att.level === 'none') {
      normal.push(normalEntry('project', p.name, p.url));
      continue;
    }
    items.push({
      level: att.level === 'high' ? 'high' : 'med',
      kind: 'project',
      title: String(p.name ?? ''),
      reason: att.reasons.join(' · '),
      url: p.url ?? null,
      ageDays: att.staleDays ?? 0,
    });
  }
}

function collectTasks(tasks, nowMs, items, normal) {
  for (const t of tasks) {
    const status = String(t.status ?? '').trim().toLowerCase();
    if (status === 'done') continue;
    const due = daysSince(t.dueISO, nowMs); // >=0 means due today or overdue
    if (t.blocked) {
      items.push({
        level: 'high', kind: 'task', title: String(t.title ?? ''),
        reason: 'blocked', url: t.url ?? null, ageDays: due != null && due > 0 ? due : 0,
      });
    } else if (due != null && due >= 0) {
      items.push({
        level: 'high', kind: 'task', title: String(t.title ?? ''),
        reason: due > 0 ? `overdue ${due}d` : 'due today',
        url: t.url ?? null, ageDays: due,
      });
    } else {
      normal.push(normalEntry('task', t.title, t.url));
    }
  }
}

function collectDecisions(decisions, nowMs, items, normal) {
  for (const d of decisions) {
    if (!d.open) {
      normal.push(normalEntry('decision', d.title, d.url));
      continue;
    }
    const age = daysSince(d.openedISO, nowMs);
    items.push({
      level: 'high', kind: 'decision', title: String(d.title ?? ''),
      reason: age != null && age > 0 ? `decision needed (open ${age}d)` : 'decision needed',
      url: d.url ?? null, ageDays: age ?? 0,
    });
  }
}

function collectSponsorReports(reports, nowMs, items, normal) {
  for (const r of reports) {
    const age = daysSince(r.lastReportISO, nowMs);
    if (age == null) {
      // Never reported: treat as maximally stale.
      items.push({
        level: 'med', kind: 'sponsor', title: String(r.title ?? ''),
        reason: 'no sponsor report on record', url: r.url ?? null, ageDays: Infinity,
      });
    } else if (age > SPONSOR_STALE_DAYS) {
      items.push({
        level: 'med', kind: 'sponsor', title: String(r.title ?? ''),
        reason: `sponsor report stale ${age}d`, url: r.url ?? null, ageDays: age,
      });
    } else {
      normal.push(normalEntry('sponsor', r.title, r.url));
    }
  }
}

// Deterministic comparator: level, then age desc, then title asc.
function compareItems(a, b) {
  const lv = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
  if (lv !== 0) return lv;
  const aAge = Number.isFinite(a.ageDays) ? a.ageDays : (a.ageDays === Infinity ? Infinity : -1);
  const bAge = Number.isFinite(b.ageDays) ? b.ageDays : (b.ageDays === Infinity ? Infinity : -1);
  if (aAge !== bAge) return bAge - aAge; // older first (Infinity = never = oldest)
  return a.title.localeCompare(b.title);
}

export function buildQueue(opts = {}) {
  const roster = Array.isArray(opts.roster) ? opts.roster : [];
  const seriesBySlug = opts.seriesBySlug && typeof opts.seriesBySlug === 'object'
    ? opts.seriesBySlug : {};
  const tasks = Array.isArray(opts.tasks) ? opts.tasks : [];
  const decisions = Array.isArray(opts.decisions) ? opts.decisions : [];
  const sponsorReports = Array.isArray(opts.sponsorReports) ? opts.sponsorReports : [];
  const now = opts.now ?? new Date();
  const nowMs = toMs(now);

  const items = [];
  const normal = [];

  collectProjects(roster, seriesBySlug, now, items, normal);
  collectTasks(tasks, nowMs, items, normal);
  collectDecisions(decisions, nowMs, items, normal);
  collectSponsorReports(sponsorReports, nowMs, items, normal);

  items.sort(compareItems);
  normal.sort((a, b) => a.title.localeCompare(b.title));

  return {
    items: items.map((it, i) => ({
      rank: i + 1,
      level: it.level,
      kind: it.kind,
      title: it.title,
      reason: it.reason,
      url: it.url,
    })),
    normal,
  };
}
