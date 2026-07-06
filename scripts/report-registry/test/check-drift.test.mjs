// check-drift.test.mjs — pure tests for the drift/age logic (no ntn spawn).
// Run: node --test scripts/report-registry/test/check-drift.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeDrift, newestRunDate, groupByType, parseMaxAgeHours, DEFAULT_MAX_AGE_HOURS,
} from '../check-drift.mjs';

const NOW = Date.parse('2026-07-05T12:00:00Z');

test('computeDrift flags a type older than the threshold', () => {
  const r = computeDrift(
    { 'VP Weekly': '2026-07-01T12:00:00Z' }, // 96h old
    { maxAgeHours: 48, now: NOW, types: ['VP Weekly'] },
  );
  assert.equal(r[0].type, 'VP Weekly');
  assert.equal(r[0].ageHours, 96);
  assert.equal(r[0].drift, true);
});

test('computeDrift passes a fresh type (within threshold)', () => {
  const r = computeDrift(
    { 'VP Weekly': '2026-07-05T00:00:00Z' }, // 12h old
    { maxAgeHours: 48, now: NOW, types: ['VP Weekly'] },
  );
  assert.equal(r[0].ageHours, 12);
  assert.equal(r[0].drift, false);
});

test('computeDrift treats a type with NO rows as drift (ageHours null)', () => {
  const r = computeDrift({}, { maxAgeHours: 48, now: NOW, types: ['System Health'] });
  assert.equal(r[0].newestRunDate, null);
  assert.equal(r[0].ageHours, null);
  assert.equal(r[0].drift, true);
});

test('computeDrift boundary: exactly at threshold is NOT drift (strictly older only)', () => {
  const r = computeDrift(
    { X: '2026-07-03T12:00:00Z' }, // exactly 48h
    { maxAgeHours: 48, now: NOW, types: ['X'] },
  );
  assert.equal(r[0].ageHours, 48);
  assert.equal(r[0].drift, false);
});

test('computeDrift returns one row per requested type', () => {
  const r = computeDrift(
    { A: '2026-07-05T11:00:00Z' },
    { maxAgeHours: 48, now: NOW, types: ['A', 'B', 'C'] },
  );
  assert.equal(r.length, 3);
  assert.deepEqual(r.map((x) => x.type), ['A', 'B', 'C']);
  assert.equal(r.find((x) => x.type === 'A').drift, false);
  assert.equal(r.find((x) => x.type === 'B').drift, true); // no data
});

test('newestRunDate returns the max Run Date, tolerating last_edited_time fallback', () => {
  const rows = [
    { properties: { 'Run Date': { date: { start: '2026-07-01' } } } },
    { properties: { 'Run Date': { date: { start: '2026-07-04' } } } },
    { properties: {}, last_edited_time: '2026-07-02T00:00:00Z' },
  ];
  assert.equal(newestRunDate(rows), '2026-07-04');
  assert.equal(newestRunDate([]), '');
});

test('groupByType buckets rows by Report Type select', () => {
  const rows = [
    { properties: { 'Report Type': { select: { name: 'VP Weekly' } } } },
    { properties: { 'Report Type': { select: { name: 'VP Weekly' } } } },
    { properties: { 'Report Type': { select: { name: 'System Health' } } } },
  ];
  const g = groupByType(rows);
  assert.equal(g['VP Weekly'].length, 2);
  assert.equal(g['System Health'].length, 1);
});

test('parseMaxAgeHours reads flag forms and defaults', () => {
  assert.equal(parseMaxAgeHours(['--max-age-hours', '72']), 72);
  assert.equal(parseMaxAgeHours(['--max-age-hours=24']), 24);
  assert.equal(parseMaxAgeHours([]), DEFAULT_MAX_AGE_HOURS);
});
