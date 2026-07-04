// cockpit.test.mjs — unit tests for the flagship portfolio cockpit.
// Verifies: (a) portfolio health counts are correct; (b) attention ordering
// (a Red+decision outranks a plain Yellow); (c) empty roster is safe.
// Run: node scripts/project-cards/test/cockpit.test.mjs
import assert from 'node:assert/strict';
import { buildCockpitHtml } from '../cockpit.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

// Fixed reference time so attention scoring / sweep-age are deterministic.
const AS_OF = '2026-07-04T12:00:00.000Z';

// --- (a) health counts ------------------------------------------------------

test('health counts: greens/yellows/reds/total tallied correctly', () => {
  const roster = [
    { name: 'A', slug: 'a', health: 'Green' },
    { name: 'B', slug: 'b', health: 'green' }, // case-insensitive
    { name: 'C', slug: 'c', health: 'Yellow' },
    { name: 'D', slug: 'd', health: 'Red' },
    { name: 'E', slug: 'e', health: '' },       // unknown -> "other", still in total
  ];
  const html = buildCockpitHtml({ roster, seriesBySlug: {}, asOf: AS_OF });
  assert.match(html, /<div class="hc green"><b>2<\/b>/);
  assert.match(html, /<div class="hc yellow"><b>1<\/b>/);
  assert.match(html, /<div class="hc red"><b>1<\/b>/);
  assert.match(html, /<div class="hc total"><b>5<\/b>/);
  assert.match(html, /<div class="hc other"><b>1<\/b>/);
});

// --- (b) attention ordering -------------------------------------------------

test('attention ordering: Red+decision (score 5) outranks plain Yellow (score 1)', () => {
  const roster = [
    // Plain Yellow: score 1 (medium).
    { name: 'Yellowy', slug: 'y', health: 'Yellow' },
    // Red + decision needed: 3 + 2 = 5 (high).
    { name: 'RedDecider', slug: 'r', health: 'Red', decisionNeeded: true },
  ];
  const html = buildCockpitHtml({ roster, seriesBySlug: {}, asOf: AS_OF });
  const iRed = html.indexOf('RedDecider');
  const iYel = html.indexOf('Yellowy');
  assert.ok(iRed > -1 && iYel > -1, 'both projects rendered');
  assert.ok(iRed < iYel, 'Red+decision appears before plain Yellow');

  // The Red row carries the high-severity class and score 5.
  assert.match(html, /<li class="att high"><span class="sc"[^>]*>5<\/span>/);
});

test('attention ordering: a Green with no flags is not in the attention list', () => {
  const roster = [
    { name: 'HealthyGreen', slug: 'g', health: 'Green' },
    { name: 'NeedsIt', slug: 'n', health: 'Red' },
  ];
  const html = buildCockpitHtml({ roster, seriesBySlug: {}, asOf: AS_OF });
  // Green shows up in the "operating normally" clear line, not as an .att row.
  assert.match(html, /operating normally/);
  assert.match(html, /class="clear"/);
  // Exactly one attention <li class="att ...> row (the Red one).
  const attCount = (html.match(/<li class="att /g) || []).length;
  assert.equal(attCount, 1);
});

// --- (c) empty roster safe --------------------------------------------------

test('empty roster: renders without throwing, zeroed counts, all-clear message', () => {
  const html = buildCockpitHtml({ roster: [], seriesBySlug: {}, asOf: AS_OF });
  assert.equal(typeof html, 'string');
  assert.match(html, /<div class="hc total"><b>0<\/b>/);
  assert.match(html, /operating normally/); // the empty-attention fallback
  assert.doesNotMatch(html, /<li class="att /); // no attention rows
});

test('empty roster: no options at all is still safe', () => {
  const html = buildCockpitHtml();
  assert.equal(typeof html, 'string');
  assert.match(html, /FourthOS Cockpit/);
});

// --- sweep-health footer ----------------------------------------------------

test('sweep footer: fresh ok sweep renders a checkmark', () => {
  const html = buildCockpitHtml({
    roster: [],
    seriesBySlug: {},
    asOf: AS_OF,
    lastSweep: { ts: '2026-07-04T11:00:00.000Z', ok: true }, // 1h before asOf
  });
  assert.match(html, /last sweep ✓ 1h ago/);
});

test('sweep footer: stale sweep is flagged with a warning', () => {
  const html = buildCockpitHtml({
    roster: [],
    seriesBySlug: {},
    asOf: AS_OF,
    lastSweep: { ts: '2026-07-01T12:00:00.000Z', ok: true }, // 3d before asOf
  });
  assert.match(html, /⚠ last sweep is stale/);
});

test('sweep footer: failed sweep is flagged even if recent', () => {
  const html = buildCockpitHtml({
    roster: [],
    seriesBySlug: {},
    asOf: AS_OF,
    lastSweep: { ts: '2026-07-04T11:30:00.000Z', ok: false },
  });
  assert.match(html, /⚠ last sweep reported a failure/);
});

test('sweep footer: missing sweep info -> "no sweep recorded"', () => {
  const html = buildCockpitHtml({ roster: [], seriesBySlug: {}, asOf: AS_OF });
  assert.match(html, /no sweep recorded/);
});

// --- overflow cap -----------------------------------------------------------

test('attention cap: >14 flagged projects shows top 14 + overflow note', () => {
  const roster = [];
  for (let i = 0; i < 20; i += 1) {
    roster.push({ name: `P${String(i).padStart(2, '0')}`, slug: `p${i}`, health: 'Red' });
  }
  const html = buildCockpitHtml({ roster, seriesBySlug: {}, asOf: AS_OF });
  const attCount = (html.match(/<li class="att /g) || []).length;
  assert.equal(attCount, 14);
  assert.match(html, /\+ 6 more flagged/);
});

console.log(`\n${pass} passed`);
