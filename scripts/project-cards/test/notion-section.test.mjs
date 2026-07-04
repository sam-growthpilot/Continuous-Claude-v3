// notion-section.test.mjs — pure tests for the block-level section splicer.
// Verifies findSectionBlocks boundaries against realistic page block JSON:
// the section body excludes the heading itself and stops at the next
// same-or-higher heading — so the human-owned Capture section is UNTOUCHED
// (mitigation #1: never full-page replace).
// Run: node --test scripts/project-cards/test/
import assert from 'node:assert/strict';
import { findSectionBlocks } from '../lib/notion.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

// --- fixture: realistic mobile-cockpit page block list -----------------------
const h = (type, text, id) => ({
  id, type, [type]: { rich_text: [{ plain_text: text }] },
});
const para = (text, id) => ({
  id, type: 'paragraph', paragraph: { rich_text: [{ plain_text: text }] },
});

const FIXTURE = [
  h('heading_1', '📱 Mobile Cockpit', 'b-intro-h'),
  para('As of 2026-07-04. Say "refresh mobile cockpit" to refresh.', 'b-intro-p'),
  h('heading_2', '🚨 Attention Queue', 'b-queue-h'),
  { id: 'b-embed', type: 'embed', embed: { url: 'https://www.notion.so/file/abc' } },
  h('heading_2', '🤖 AI digest (machine-written)', 'b-digest-h'),
  para('1. 🔴 ProjA — blocked on infra', 'b-digest-1'),
  para('2. 🟡 ProjB — decision open', 'b-digest-2'),
  { id: 'b-digest-table', type: 'table', table: { table_width: 3 } },
  h('heading_3', 'Sponsor staleness', 'b-digest-sub'),      // sub-heading INSIDE digest
  para('ProjA sponsor report 12d stale', 'b-digest-3'),
  h('heading_2', '📓 Capture', 'b-capture-h'),
  para('human note: call Carly re budget', 'b-capture-1'),
  para('human note: idea for v1 poller', 'b-capture-2'),
];

// --- boundary tests -----------------------------------------------------------

test('digest section spans from after its heading to the Capture heading (exclusive)', () => {
  const s = findSectionBlocks(FIXTURE, '## 🤖 AI digest (machine-written)');
  assert.ok(s, 'section found');
  assert.equal(s.headingIndex, 4);
  assert.equal(s.start, 5);
  assert.equal(s.end, 10); // index of '📓 Capture' heading
  assert.deepEqual(s.blocks.map((b) => b.id), [
    'b-digest-1', 'b-digest-2', 'b-digest-table', 'b-digest-sub', 'b-digest-3',
  ]);
});

test('Capture-untouched invariant: no Capture block ids inside any sweep-owned section', () => {
  const captureIds = ['b-capture-h', 'b-capture-1', 'b-capture-2'];
  for (const heading of ['## 🚨 Attention Queue', '## 🤖 AI digest (machine-written)']) {
    const s = findSectionBlocks(FIXTURE, heading);
    const ids = s.blocks.map((b) => b.id);
    for (const cid of captureIds) {
      assert.ok(!ids.includes(cid), `${cid} must not be in "${heading}" splice range`);
    }
  }
});

test('embed section contains exactly the embed block, stops at next heading_2', () => {
  const s = findSectionBlocks(FIXTURE, '## 🚨 Attention Queue');
  assert.deepEqual(s.blocks.map((b) => b.id), ['b-embed']);
});

test('lower-level (###) sub-heading does NOT end a ## section', () => {
  const s = findSectionBlocks(FIXTURE, '## 🤖 AI digest (machine-written)');
  assert.ok(s.blocks.some((b) => b.id === 'b-digest-sub'), 'sub-heading kept inside');
  assert.ok(s.blocks.some((b) => b.id === 'b-digest-3'), 'blocks after sub-heading kept inside');
});

test('heading_1 section spans to end when no other h1 exists (FOOTGUN: never section-replace on the H1)', () => {
  // Contract: boundary = next SAME-OR-HIGHER heading. A page's sole heading_1
  // therefore owns everything below it — the sweep must update the intro by
  // replacing its single paragraph, NOT via replaceSectionBlocks on the H1.
  const s = findSectionBlocks(FIXTURE, '# 📱 Mobile Cockpit');
  assert.equal(s.start, 1);
  assert.equal(s.end, FIXTURE.length);
  assert.equal(s.blocks[0].id, 'b-intro-p');
});

test('last section on the page runs to the end of the block list', () => {
  const s = findSectionBlocks(FIXTURE, '## 📓 Capture');
  assert.deepEqual(s.blocks.map((b) => b.id), ['b-capture-1', 'b-capture-2']);
  assert.equal(s.end, FIXTURE.length);
});

test('missing heading returns null (caller must fail loud, never append blindly)', () => {
  assert.equal(findSectionBlocks(FIXTURE, '## Nonexistent'), null);
});

test('heading level is part of the match: ## text does not match a ### block', () => {
  assert.equal(findSectionBlocks(FIXTURE, '## Sponsor staleness'), null);
  const s = findSectionBlocks(FIXTURE, '### Sponsor staleness');
  assert.ok(s, 'matches at its own level');
  assert.deepEqual(s.blocks.map((b) => b.id), ['b-digest-3']);
});

test('empty section (heading immediately followed by another heading) yields zero blocks', () => {
  const fixture = [
    h('heading_2', 'A', 'x1'),
    h('heading_2', 'B', 'x2'),
    para('b body', 'x3'),
  ];
  const s = findSectionBlocks(fixture, '## A');
  assert.deepEqual(s.blocks, []);
  assert.equal(s.start, 1);
  assert.equal(s.end, 1);
});

console.log(`notion-section: ${pass} passed`);
