// queue.test.mjs — unit tests for the pure attention-queue collector/ranker.
// Verifies: cross-kind ranking, v0 severity rules per kind, deterministic
// ordering (level -> age -> title), normal bucket, and empty-input safety.
// Run: node scripts/project-cards/test/queue.test.mjs
import assert from 'node:assert/strict';
import { buildQueue } from '../lib/queue.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

// Fixed reference time so every age computation is deterministic.
const NOW = new Date('2026-07-04T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

// --- projects (via computeAttention, unchanged) -------------------------------

test('projects: Red+decision is high, plain Yellow is med, Green is normal', () => {
  const roster = [
    { name: 'GreenOK', slug: 'g', url: 'u-g', health: 'Green', lastEditedISO: daysAgo(1) },
    { name: 'Yellowy', slug: 'y', url: 'u-y', health: 'Yellow', lastEditedISO: daysAgo(1) },
    { name: 'RedDecider', slug: 'r', url: 'u-r', health: 'Red', decisionNeeded: true, lastEditedISO: daysAgo(1) },
  ];
  const { items, normal } = buildQueue({ roster, seriesBySlug: {}, now: NOW });
  const red = items.find((i) => i.title === 'RedDecider');
  const yel = items.find((i) => i.title === 'Yellowy');
  assert.equal(red.level, 'high');
  assert.equal(red.kind, 'project');
  assert.match(red.reason, /Red health/);
  assert.match(red.reason, /decision needed/);
  assert.equal(yel.level, 'med');
  assert.equal(normal.length, 1);
  assert.equal(normal[0].title, 'GreenOK');
  assert.equal(normal[0].kind, 'project');
});

test('projects: trend-down series feeds computeAttention (was-Green reason)', () => {
  const roster = [{ name: 'Sliding', slug: 's', url: 'u', health: 'Yellow', lastEditedISO: daysAgo(1) }];
  const seriesBySlug = { s: [{ date: '2026-07-03', health: 'Green' }, { date: '2026-07-04', health: 'Yellow' }] };
  const { items } = buildQueue({ roster, seriesBySlug, now: NOW });
  assert.match(items[0].reason, /was Green/);
});

// --- tasks --------------------------------------------------------------------

test('tasks: blocked and overdue/due-today are high; future-due is normal; done skipped', () => {
  const tasks = [
    { title: 'Blocked one', url: 'u1', status: 'In Progress', blocked: true },
    { title: 'Overdue one', url: 'u2', status: 'To Do', dueISO: daysAgo(3) },
    { title: 'Due today', url: 'u3', status: 'To Do', dueISO: daysAgo(0) },
    { title: 'Future due', url: 'u4', status: 'To Do', dueISO: daysAgo(-5) },
    { title: 'Done thing', url: 'u5', status: 'Done', blocked: true },
  ];
  const { items, normal } = buildQueue({ tasks, now: NOW });
  const titles = items.map((i) => i.title);
  assert.ok(titles.includes('Blocked one'));
  assert.ok(titles.includes('Overdue one'));
  assert.ok(titles.includes('Due today'));
  assert.ok(!titles.includes('Done thing'));
  assert.ok(items.every((i) => i.level === 'high' && i.kind === 'task'));
  assert.equal(items.find((i) => i.title === 'Overdue one').reason, 'overdue 3d');
  assert.equal(items.find((i) => i.title === 'Due today').reason, 'due today');
  assert.equal(items.find((i) => i.title === 'Blocked one').reason, 'blocked');
  assert.deepEqual(normal, [{ kind: 'task', title: 'Future due', url: 'u4' }]);
});

// --- decisions ------------------------------------------------------------------

test('decisions: open is high with age in reason; closed is normal', () => {
  const decisions = [
    { title: 'Old open', url: 'd1', open: true, openedISO: daysAgo(4) },
    { title: 'Fresh open', url: 'd2', open: true, openedISO: daysAgo(0) },
    { title: 'Closed', url: 'd3', open: false },
  ];
  const { items, normal } = buildQueue({ decisions, now: NOW });
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.level === 'high' && i.kind === 'decision'));
  assert.equal(items.find((i) => i.title === 'Old open').reason, 'decision needed (open 4d)');
  assert.equal(items.find((i) => i.title === 'Fresh open').reason, 'decision needed');
  assert.equal(normal[0].title, 'Closed');
});

// --- sponsor reports -------------------------------------------------------------

test('sponsor: stale >7d is med, never-reported is med and oldest, fresh is normal', () => {
  const sponsorReports = [
    { title: 'Stale proj', url: 's1', lastReportISO: daysAgo(10) },
    { title: 'Never reported', url: 's2', lastReportISO: null },
    { title: 'Fresh proj', url: 's3', lastReportISO: daysAgo(2) },
  ];
  const { items, normal } = buildQueue({ sponsorReports, now: NOW });
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.level === 'med' && i.kind === 'sponsor'));
  // Never-reported sorts before 10d-stale (treated as maximally old).
  assert.equal(items[0].title, 'Never reported');
  assert.equal(items[0].reason, 'no sponsor report on record');
  assert.equal(items[1].reason, 'sponsor report stale 10d');
  assert.equal(normal[0].title, 'Fresh proj');
});

test('sponsor: exactly 7 days old is NOT stale (boundary)', () => {
  const { items, normal } = buildQueue({
    sponsorReports: [{ title: 'Edge', url: 's', lastReportISO: daysAgo(7) }],
    now: NOW,
  });
  assert.equal(items.length, 0);
  assert.equal(normal[0].title, 'Edge');
});

// --- merged deterministic ordering -----------------------------------------------

test('ordering: all high before all med; within level older first; ties by title', () => {
  const { items } = buildQueue({
    roster: [{ name: 'MedProject', slug: 'm', url: 'u', health: 'Yellow', lastEditedISO: daysAgo(1) }],
    tasks: [{ title: 'OverdueTask', url: 't', status: 'To Do', dueISO: daysAgo(2) }],
    decisions: [
      { title: 'B decision', url: 'd', open: true, openedISO: daysAgo(2) },
      { title: 'A decision', url: 'd2', open: true, openedISO: daysAgo(2) },
    ],
    sponsorReports: [{ title: 'StaleSponsor', url: 's', lastReportISO: daysAgo(20) }],
    now: NOW,
  });
  const titles = items.map((i) => i.title);
  // Highs first (task + 2 decisions, all age 2 -> alpha order), then meds
  // (sponsor age 20 outranks project age 1).
  assert.deepEqual(titles.slice(0, 3), ['A decision', 'B decision', 'OverdueTask']);
  assert.deepEqual(titles.slice(3), ['StaleSponsor', 'MedProject']);
  // Ranks are 1-based and sequential.
  assert.deepEqual(items.map((i) => i.rank), [1, 2, 3, 4, 5]);
});

test('ordering: identical inputs produce identical output (deterministic)', () => {
  const opts = {
    roster: [{ name: 'P', slug: 'p', url: 'u', health: 'Red', lastEditedISO: daysAgo(1) }],
    tasks: [{ title: 'T', url: 't', status: 'To Do', blocked: true }],
    now: NOW,
  };
  assert.deepEqual(buildQueue(opts), buildQueue(opts));
});

// --- empty / missing inputs --------------------------------------------------------

test('empty: no options at all is safe and returns empty arrays', () => {
  const q = buildQueue();
  assert.deepEqual(q, { items: [], normal: [] });
});

test('items carry no internal fields (only rank/level/kind/title/reason/url)', () => {
  const { items } = buildQueue({
    tasks: [{ title: 'T', url: 't', status: 'To Do', blocked: true }],
    now: NOW,
  });
  assert.deepEqual(Object.keys(items[0]).sort(),
    ['kind', 'level', 'rank', 'reason', 'title', 'url']);
});

console.log(`queue.test.mjs: ${pass} assertions-groups passed`);
