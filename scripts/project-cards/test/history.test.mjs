// history.test.mjs — round-trip tests for the append-only health-history store
// and a direct unit test of the attention scorer (Red+decision => high, ranked
// above a plain Yellow). These two lib modules (history/attention) had no direct
// coverage; cockpit.test.mjs exercised attention only through buildCockpitHtml.
//
// The history store writes to a FIXED path (logs/health-history.jsonl) with no
// path-injection seam, so this suite snapshots that file up front and restores it
// on exit — the real file is left byte-identical (or absent) after the run.
// Run: node scripts/project-cards/test/history.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { appendHealth, readSeries, latestPrev, HISTORY_PATH } from '../lib/history.mjs';
import { computeAttention } from '../lib/attention.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

// --- snapshot the real history file so the suite is non-destructive ----------
const existedBefore = existsSync(HISTORY_PATH);
const backup = existedBefore ? readFileSync(HISTORY_PATH, 'utf8') : null;
function restore() {
  if (existedBefore) writeFileSync(HISTORY_PATH, backup, 'utf8');
  else if (existsSync(HISTORY_PATH)) rmSync(HISTORY_PATH, { force: true });
}

// Unique slug so the round-trip can never collide with a real project's rows.
const SLUG = `__hist_test_${process.pid}__`;

try {
  // --- (1) history round-trip ------------------------------------------------

  test('round-trip: append two days -> readSeries returns them oldest->newest', () => {
    // Intentionally append the NEWER day first to prove readSeries sorts by date,
    // not by insertion order.
    appendHealth([{ slug: SLUG, projectName: 'Hist Test', health: 'Green', date: '2026-07-04' }]);
    appendHealth([{ slug: SLUG, projectName: 'Hist Test', health: 'Yellow', date: '2026-07-03' }]);

    const series = readSeries(SLUG);
    assert.equal(series.length, 2, 'exactly two distinct days');
    assert.deepEqual(series, [
      { date: '2026-07-03', health: 'Yellow' },
      { date: '2026-07-04', health: 'Green' },
    ], 'ordered oldest -> newest regardless of insertion order');
  });

  test('round-trip: latestPrev returns the value BEFORE the latest day', () => {
    // Latest day is 2026-07-04 (Green); the prior day is 2026-07-03 (Yellow).
    assert.equal(latestPrev(SLUG), 'Yellow');
  });

  test('round-trip: same-day re-write is last-write-wins (one row per day)', () => {
    appendHealth([{ slug: SLUG, projectName: 'Hist Test', health: 'Red', date: '2026-07-04' }]);
    const series = readSeries(SLUG);
    assert.equal(series.length, 2, 'still two days — no duplicate 07-04 row');
    assert.deepEqual(series[series.length - 1], { date: '2026-07-04', health: 'Red' },
      'the 07-04 value was overwritten to Red');
    // prev day is unchanged, so latestPrev now reads Yellow (before the Red 07-04).
    assert.equal(latestPrev(SLUG), 'Yellow');
  });

  test('round-trip: an unknown slug has an empty series and null latestPrev', () => {
    assert.deepEqual(readSeries('__nope_no_such_slug__'), []);
    assert.equal(latestPrev('__nope_no_such_slug__'), null);
  });

  // --- (2) attention scorer (direct) ----------------------------------------

  test('attention: Red + decision needed => high (score 5)', () => {
    const now = new Date('2026-07-04T12:00:00.000Z');
    const res = computeAttention(
      { health: 'Red', decisionNeeded: true, lastEditedISO: now.toISOString(), reviewDateISO: null },
      [],
      now,
    );
    assert.equal(res.score, 5, 'Red(3) + decision(2) = 5');
    assert.equal(res.level, 'high');
  });

  test('attention: a Red+decision outscores a plain Yellow, and Yellow is medium', () => {
    const now = new Date('2026-07-04T12:00:00.000Z');
    const fresh = now.toISOString();
    const redDecider = computeAttention(
      { health: 'Red', decisionNeeded: true, lastEditedISO: fresh, reviewDateISO: null }, [], now);
    const plainYellow = computeAttention(
      { health: 'Yellow', decisionNeeded: false, lastEditedISO: fresh, reviewDateISO: null }, [], now);
    assert.equal(plainYellow.score, 1, 'plain Yellow scores 1');
    assert.equal(plainYellow.level, 'medium');
    assert.ok(redDecider.score > plainYellow.score,
      `Red+decision (${redDecider.score}) must outrank plain Yellow (${plainYellow.score})`);
    // Sorting the way the cockpit does (score desc) puts the Red first.
    const ranked = [plainYellow, redDecider].sort((a, b) => b.score - a.score);
    assert.equal(ranked[0], redDecider, 'Red+decision sorts above plain Yellow');
  });

  test('attention: a healthy Green with no flags is level "none"', () => {
    const now = new Date('2026-07-04T12:00:00.000Z');
    const res = computeAttention(
      { health: 'Green', decisionNeeded: false, lastEditedISO: now.toISOString(), reviewDateISO: null },
      [],
      now,
    );
    assert.equal(res.score, 0);
    assert.equal(res.level, 'none');
  });

  test('attention: a worsened trend (was Green, now Yellow) adds a down-trend point', () => {
    const now = new Date('2026-07-04T12:00:00.000Z');
    const series = [
      { date: '2026-07-03', health: 'Green' },
      { date: '2026-07-04', health: 'Yellow' },
    ];
    const res = computeAttention(
      { health: 'Yellow', decisionNeeded: false, lastEditedISO: now.toISOString(), reviewDateISO: null },
      series,
      now,
    );
    // Yellow(1) + down-trend(1) = 2.
    assert.equal(res.trend, 'down');
    assert.equal(res.score, 2, 'Yellow(1) + down-trend(1) = 2');
  });

  console.log(`\n${pass} passed`);
} finally {
  restore();
}
