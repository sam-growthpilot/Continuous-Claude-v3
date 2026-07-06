// digest.test.mjs — unit tests for the pure AI-digest markdown renderer.
// Verifies: ranked attention lines (rank/emoji/kind/reason/link), per-project
// one-liners, sponsor staleness section, footer, empty-input safety, plain
// markdown (no HTML), and determinism.
// Run: node scripts/project-cards/test/digest.test.mjs
import assert from 'node:assert/strict';
import { buildDigestMarkdown } from '../lib/digest.mjs';
import { buildQueue } from '../lib/queue.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

const NOW = new Date('2026-07-04T12:00:00.000Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

const QUEUE = {
  items: [
    { rank: 1, level: 'high', kind: 'decision', title: 'Pick vendor', reason: 'decision needed (open 4d)', url: 'https://n/dec' },
    { rank: 2, level: 'high', kind: 'task', title: 'Ship card', reason: 'overdue 2d', url: null },
    { rank: 3, level: 'med', kind: 'sponsor', title: 'FourthOS', reason: 'sponsor report stale 10d', url: 'https://n/sp' },
  ],
  normal: [
    { kind: 'project', title: 'GreenOK', url: 'https://n/g' },
    { kind: 'sponsor', title: 'Helm', url: 'https://n/h' },
  ],
};

const ROSTER = [
  { name: 'GreenOK', slug: 'g', url: 'https://n/g', health: 'Green', status: 'Build', reviewDateISO: '2026-07-10T00:00:00.000Z' },
  { name: 'RedOne', slug: 'r', url: 'https://n/r', health: 'Red' },
];

test('ranked attention lines: rank, emoji, kind, title, reason, link', () => {
  const mdOut = buildDigestMarkdown({ queue: QUEUE, roster: ROSTER, asOf: NOW });
  assert.match(mdOut, /1\. \u{1F534} \[decision\] Pick vendor — decision needed \(open 4d\) — \[open\]\(https:\/\/n\/dec\)/u);
  assert.match(mdOut, /3\. \u{1F7E1} \[sponsor\] FourthOS — sponsor report stale 10d — \[open\]\(https:\/\/n\/sp\)/u);
});

test('item without url gets no link segment', () => {
  const mdOut = buildDigestMarkdown({ queue: QUEUE, roster: ROSTER, asOf: NOW });
  const line = mdOut.split('\n').find((l) => l.startsWith('2.'));
  assert.equal(line, '2. \u{1F534} [task] Ship card — overdue 2d');
});

test('per-project one-liners: health/status/next review', () => {
  const mdOut = buildDigestMarkdown({ queue: QUEUE, roster: ROSTER, asOf: NOW });
  assert.match(mdOut, /- GreenOK — health: Green \/ status: Build \/ next review: 2026-07-10/);
  assert.match(mdOut, /- RedOne — health: Red/);
});

test('sponsor section: stale from items, fresh from normal', () => {
  const mdOut = buildDigestMarkdown({ queue: QUEUE, roster: ROSTER, asOf: NOW });
  assert.match(mdOut, /## Sponsor reporting/);
  assert.match(mdOut, /- FourthOS — sponsor report stale 10d/);
  assert.match(mdOut, /- Helm — reported within the last 7 days/);
});

test('footer present with exact asOf ISO', () => {
  const mdOut = buildDigestMarkdown({ queue: QUEUE, roster: ROSTER, asOf: NOW });
  assert.match(mdOut, /_Updated: 2026-07-04T12:00:00\.000Z by CCv3 sweep\. Do not edit by hand\._/);
});

test('plain markdown only: no HTML tags in output', () => {
  const mdOut = buildDigestMarkdown({ queue: QUEUE, roster: ROSTER, asOf: NOW });
  assert.equal(/<[a-z][\s\S]*?>/i.test(mdOut), false);
});

test('empty inputs: safe placeholders, footer still emitted', () => {
  const mdOut = buildDigestMarkdown({ queue: { items: [], normal: [] }, roster: [], asOf: NOW });
  assert.match(mdOut, /Nothing needs attention right now\./);
  assert.match(mdOut, /No projects on the roster\./);
  assert.equal(/## Sponsor reporting/.test(mdOut), false);
  assert.match(mdOut, /_Updated: .* by CCv3 sweep/);
});

test('markdown-special characters in titles are escaped', () => {
  const q = { items: [{ rank: 1, level: 'high', kind: 'task', title: 'a [b] *c*_d_', reason: 'blocked', url: null }], normal: [] };
  const mdOut = buildDigestMarkdown({ queue: q, roster: [], asOf: NOW });
  assert.match(mdOut, /a \\\[b\\\] \\\*c\\\*\\_d\\_/);
});

test('integration: buildQueue output feeds buildDigestMarkdown coherently', () => {
  const { items, normal } = buildQueue({
    roster: [{ name: 'RedDecider', slug: 'r', url: 'u-r', health: 'Red', decisionNeeded: true, lastEditedISO: daysAgo(1) }],
    seriesBySlug: {},
    tasks: [{ title: 'Late thing', url: 'u-t', status: 'open', dueISO: daysAgo(3) }],
    decisions: [],
    sponsorReports: [{ title: 'NeverReported', url: 'u-s' }],
    now: NOW,
  });
  const mdOut = buildDigestMarkdown({ queue: { items, normal }, roster: [], asOf: NOW });
  assert.match(mdOut, /\[project\] RedDecider/);
  assert.match(mdOut, /\[task\] Late thing — overdue 3d/);
  assert.match(mdOut, /- NeverReported — no sponsor report on record/);
});

test('determinism: identical inputs -> identical string', () => {
  const a = buildDigestMarkdown({ queue: QUEUE, roster: ROSTER, asOf: NOW });
  const b = buildDigestMarkdown({ queue: QUEUE, roster: ROSTER, asOf: NOW });
  assert.equal(a, b);
});

console.log(`digest.test.mjs: ${pass} tests passed`);
