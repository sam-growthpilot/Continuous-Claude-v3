// sweep.test.mjs — unit tests for the PURE pieces of the daily sweep.
// Only the isolatable helpers (host-kind classifier, hub-table builder) are
// tested here; the live spawns (refresh.mjs, claude -p, ntn) are not unit-tested.
// Run: node scripts/project-cards/test/sweep.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyHostKind, buildHubTable, markdownToBlocks,
  acquireSweepLock, releaseSweepLock,
  triageFailureReceiptLine, TRIAGE_EXIT_CODE, mapPmNoteRow,
} from '../sweep.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

test('classifyHostKind: notion.so URL -> notion', () => {
  assert.equal(classifyHostKind('https://www.notion.so/Foo-30e76fd7ac82'), 'notion');
});

test('classifyHostKind: notion.com URL -> notion', () => {
  assert.equal(classifyHostKind('https://app.notion.com/p/39276fd7ac82'), 'notion');
});

test('classifyHostKind: github URL -> github', () => {
  assert.equal(classifyHostKind('https://github.com/example/repo'), 'github');
});

test('classifyHostKind: empty / null -> none', () => {
  assert.equal(classifyHostKind(''), 'none');
  assert.equal(classifyHostKind(null), 'none');
  assert.equal(classifyHostKind(undefined), 'none');
});

test('classifyHostKind: other URL -> none', () => {
  assert.equal(classifyHostKind('https://example.com/thing'), 'none');
});

test('buildHubTable: header + separator present', () => {
  const md = buildHubTable([]);
  assert.ok(md.startsWith('| Project | Health | Status | Card |\n| --- | --- | --- | --- |'));
});

test('buildHubTable: notion row renders Live card link to the page url', () => {
  const md = buildHubTable([
    { projectName: 'Connector Ecosystem', health: 'Green', status: 'Active',
      hostKind: 'notion', url: 'https://app.notion.com/p/abc' },
  ]);
  assert.ok(md.includes('| Connector Ecosystem | Green | Active | [Live card](https://app.notion.com/p/abc) |'));
});

test('buildHubTable: github row shows GitHub-only text', () => {
  const md = buildHubTable([
    { projectName: 'Repo Proj', health: 'Yellow', status: 'Active',
      hostKind: 'github', url: 'https://github.com/x/y' },
  ]);
  assert.ok(md.includes('| Repo Proj | Yellow | Active | GitHub-only — no Notion host page |'));
});

test('buildHubTable: none row shows Pending host page', () => {
  const md = buildHubTable([
    { projectName: 'No Host', health: '', status: 'Planning', hostKind: 'none', url: '' },
  ]);
  assert.ok(md.includes('| No Host | — | Planning | Pending host page |'));
});

test('buildHubTable: empty health/status fall back to em dash', () => {
  const md = buildHubTable([
    { projectName: 'X', health: '', status: '', hostKind: 'notion', url: 'https://notion.so/x' },
  ]);
  assert.ok(md.includes('| X | — | — | [Live card](https://notion.so/x) |'));
});

test('buildHubTable: row count matches input (header + one line per row)', () => {
  const rows = [
    { projectName: 'A', health: 'Green', status: 'Active', hostKind: 'notion', url: 'https://notion.so/a' },
    { projectName: 'B', health: 'Red', status: 'Active', hostKind: 'github', url: 'https://github.com/b/b' },
    { projectName: 'C', health: 'Green', status: 'Active', hostKind: 'none', url: '' },
  ];
  const lines = buildHubTable(rows).split('\n');
  assert.equal(lines.length, 2 + rows.length); // header + separator + 3 rows
});

// --- markdownToBlocks (AI-digest splice payload) ----------------------------

test('markdownToBlocks: "## " headings DEMOTED to heading_3 (cannot end the digest section)', () => {
  const blocks = markdownToBlocks('## Needs attention\ntext');
  assert.equal(blocks[0].type, 'heading_3');
  assert.equal(blocks[0].heading_3.rich_text[0].text.content, 'Needs attention');
});

test('markdownToBlocks: bullets -> bulleted_list_item, numbered lines stay paragraphs (rank fidelity)', () => {
  const blocks = markdownToBlocks('- ProjA — health: Green\n1. 🔴 [task] Fix thing — blocked');
  assert.equal(blocks[0].type, 'bulleted_list_item');
  assert.equal(blocks[0].bulleted_list_item.rich_text[0].text.content, 'ProjA — health: Green');
  assert.equal(blocks[1].type, 'paragraph');
  assert.ok(blocks[1].paragraph.rich_text[0].text.content.startsWith('1. '));
});

test('markdownToBlocks: blank lines skipped; italic footer kept as paragraph', () => {
  const blocks = markdownToBlocks('a\n\n\n_Updated: X by CCv3 sweep._\n');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].paragraph.rich_text[0].text.content, '_Updated: X by CCv3 sweep._');
});

test('markdownToBlocks: rich_text content truncated to 2000 chars (Notion limit)', () => {
  const blocks = markdownToBlocks(`x${'y'.repeat(3000)}`);
  assert.equal(blocks[0].paragraph.rich_text[0].text.content.length, 2000);
});

// --- single-instance sweep lock (mitigation #2) ------------------------------

const lockDir = mkdtempSync(join(tmpdir(), 'pc-lock-'));
const lockPath = join(lockDir, '.sweep.lock');

test('lock: clean acquire writes pid+ts payload; release removes it', () => {
  assert.equal(acquireSweepLock(lockPath), 'acquired');
  const payload = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.equal(payload.pid, process.pid);
  assert.ok(payload.ts);
  releaseSweepLock(lockPath);
  assert.ok(!existsSync(lockPath));
});

test('lock: fresh lock held by another run -> held', () => {
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: new Date().toISOString() }), 'utf8');
  assert.equal(acquireSweepLock(lockPath), 'held');
  releaseSweepLock(lockPath);
});

test('lock: >30min-old lock is treated as stale and replaced', () => {
  const old = new Date(Date.now() - 31 * 60_000).toISOString();
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: old }), 'utf8');
  assert.equal(acquireSweepLock(lockPath), 'stale-replaced');
  assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).pid, process.pid);
  releaseSweepLock(lockPath);
});

test('lock: corrupt/unreadable lock file counts as stale', () => {
  writeFileSync(lockPath, 'not json at all', 'utf8');
  assert.equal(acquireSweepLock(lockPath), 'stale-replaced');
  releaseSweepLock(lockPath);
});

try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* best-effort */ }

// --- triage helpers (mitigation #6/#8) --------------------------------------

test('TRIAGE_EXIT_CODE is 3 (distinct from generic failure 1 and lock-skip 0)', () => {
  assert.equal(TRIAGE_EXIT_CODE, 3);
});

test('triageFailureReceiptLine: ⚠ prefix, timestamp, message included', () => {
  const line = triageFailureReceiptLine('page read failed: boom', '2026-07-04T07:30');
  assert.equal(line, '⚠ triage FAILED 2026-07-04T07:30 — page read failed: boom');
});

test('triageFailureReceiptLine: error text capped at 60 chars with ellipsis', () => {
  const long = 'x'.repeat(200);
  const line = triageFailureReceiptLine(long, 'T');
  const msg = line.split(' — ')[1];
  assert.equal(msg.length, 60);
  assert.ok(msg.endsWith('…'));
});

test('triageFailureReceiptLine: newlines collapsed, empty -> "unknown"', () => {
  assert.ok(!/\n/.test(triageFailureReceiptLine('a\nb\r\nc', 'T')));
  assert.equal(triageFailureReceiptLine('', 'T'), '⚠ triage FAILED T — unknown');
  assert.equal(triageFailureReceiptLine(null, 'T'), '⚠ triage FAILED T — unknown');
});

test('mapPmNoteRow: maps title/status/type/capturedISO from typed properties', () => {
  const row = mapPmNoteRow({
    id: 'pg1',
    url: 'https://notion.so/pg1',
    created_time: '2026-07-01T00:00:00.000Z',
    properties: {
      Note: { type: 'title', title: [{ plain_text: 'Try the thing' }] },
      Status: { type: 'select', select: { name: 'open' } },
      Type: { type: 'select', select: { name: 'later' } },
      Captured: { type: 'created_time', created_time: '2026-07-02T00:00:00.000Z' },
    },
  });
  assert.equal(row.title, 'Try the thing');
  assert.equal(row.url, 'https://notion.so/pg1');
  assert.equal(row.status, 'open');
  assert.equal(row.type, 'later');
  assert.equal(row.capturedISO, '2026-07-02T00:00:00.000Z');
});

test('mapPmNoteRow: degrades to page created_time and empty fields, never throws', () => {
  const row = mapPmNoteRow({ id: 'pg2', created_time: '2026-06-30T00:00:00.000Z', properties: {} });
  assert.equal(row.title, '');
  assert.equal(row.capturedISO, '2026-06-30T00:00:00.000Z');
  assert.equal(row.url, 'pg2');
});

console.log(`\n${pass} passed`);
