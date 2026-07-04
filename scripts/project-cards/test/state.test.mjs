// state.test.mjs — unit tests for the two riskiest NEW state surfaces:
//   (a) needsPublish() REL#1 self-heal — publishedHash lagging contentHash
//       re-flags a card even when lastPublished is set (a prior failed publish).
//   (b) readState() corruption tolerance — a corrupt state.json is quarantined
//       and a fresh {version,cards:{}} is returned WITHOUT throwing.
// Run: node scripts/project-cards/test/state.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  needsPublish, readState, writeState, getMobileCockpit, recordMobileCockpit,
} from '../lib/state.mjs';
import { STATE_VERSION } from '../lib/config.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

// --- (a) needsPublish self-heal -------------------------------------------

test('needsPublish: never-published card (no prev) -> true', () => {
  assert.equal(needsPublish(undefined, 'abc'), true);
  assert.equal(needsPublish(null, 'abc'), true);
});

test('needsPublish: prev exists but never confirmed a publish (no lastPublished) -> true', () => {
  const prev = { publishedHash: null, lastPublished: null, contentHash: 'abc' };
  assert.equal(needsPublish(prev, 'abc'), true);
});

test('needsPublish: self-heal — publishedHash !== contentHash even WITH lastPublished -> true', () => {
  // Simulates a prior publish that landed lastPublished but whose read-back
  // verify failed, so publishedHash was never advanced to the new content.
  const prev = {
    publishedHash: 'OLD_hash',
    lastPublished: '2026-07-03T12:00:00.000Z', // a prior publish DID happen
    contentHash: 'NEW_hash',
  };
  assert.equal(needsPublish(prev, 'NEW_hash'), true);
});

test('needsPublish: fully published + unchanged — publishedHash === contentHash -> false', () => {
  const prev = {
    publishedHash: 'hash1',
    lastPublished: '2026-07-03T12:00:00.000Z',
    contentHash: 'hash1',
  };
  assert.equal(needsPublish(prev, 'hash1'), false);
});

test('needsPublish: content changed after a good publish -> true (re-publish stale card)', () => {
  const prev = {
    publishedHash: 'hash1',
    lastPublished: '2026-07-03T12:00:00.000Z',
    contentHash: 'hash1',
  };
  assert.equal(needsPublish(prev, 'hash2'), true);
});

// --- (b) readState corruption tolerance -----------------------------------

const workdir = mkdtempSync(join(tmpdir(), 'pc-state-'));

test('readState: missing file -> fresh {version, cards:{}} (no throw)', () => {
  const p = join(workdir, 'missing.json');
  const s = readState(p);
  assert.deepEqual(s, { version: STATE_VERSION, cards: {} });
});

test('readState: valid file -> parsed state round-trips', () => {
  const p = join(workdir, 'valid.json');
  writeFileSync(p, JSON.stringify({ version: STATE_VERSION, cards: { foo: { contentHash: 'x' } } }), 'utf8');
  const s = readState(p);
  assert.equal(s.version, STATE_VERSION);
  assert.equal(s.cards.foo.contentHash, 'x');
});

test('readState: CORRUPT file is quarantined and a fresh state returned (no throw)', () => {
  const p = join(workdir, 'state.json');
  writeFileSync(p, '{ this is NOT valid json ]]', 'utf8');

  let s;
  assert.doesNotThrow(() => { s = readState(p); }, 'readState must not throw on corrupt input');

  // Fresh empty state returned.
  assert.deepEqual(s, { version: STATE_VERSION, cards: {} });

  // Original corrupt file was moved aside to state.json.corrupt-<epoch>.
  assert.ok(!existsSync(p), 'corrupt file should have been renamed away');
  const quarantined = readdirSync(workdir).filter((f) => f.startsWith('state.json.corrupt-'));
  assert.equal(quarantined.length, 1, 'exactly one quarantine file should exist');
});

test('readState: non-object JSON (e.g. a bare array) -> fresh state', () => {
  const p = join(workdir, 'array.json');
  writeFileSync(p, '[1,2,3]', 'utf8');
  const s = readState(p);
  // A JS array is typeof 'object' but not the expected shape; readState coerces
  // cards to {} and version to a number, never throwing.
  assert.equal(typeof s, 'object');
  assert.deepEqual(s.cards, {});
  assert.equal(typeof s.version, 'number');
});

// --- mobileCockpit (additive block, tolerant readers) ----------------------

test('getMobileCockpit: absent block -> full default shape (readers tolerate absence)', () => {
  const shape = getMobileCockpit({ version: STATE_VERSION, cards: {} });
  assert.deepEqual(shape, {
    pageId: null, attachmentId: null, prevAttachmentId: null,
    contentHash: null, publishedHash: null, lastPublished: null, lastDigestWrite: null,
  });
  assert.deepEqual(getMobileCockpit(null), getMobileCockpit(undefined));
});

test('getMobileCockpit: partial stored block is filled to the full shape', () => {
  const s = { mobileCockpit: { pageId: 'p1', contentHash: 'h1' } };
  const shape = getMobileCockpit(s);
  assert.equal(shape.pageId, 'p1');
  assert.equal(shape.contentHash, 'h1');
  assert.equal(shape.prevAttachmentId, null);
  assert.equal(shape.lastDigestWrite, null);
});

test('recordMobileCockpit: merges patch, preserves untouched fields, mutates state', () => {
  const s = { version: STATE_VERSION, cards: {}, mobileCockpit: { pageId: 'p1', attachmentId: 'a1', publishedHash: 'h1' } };
  recordMobileCockpit(s, { prevAttachmentId: 'a1', attachmentId: 'a2', publishedHash: 'h2' });
  assert.equal(s.mobileCockpit.pageId, 'p1');
  assert.equal(s.mobileCockpit.attachmentId, 'a2');
  assert.equal(s.mobileCockpit.prevAttachmentId, 'a1');
  assert.equal(s.mobileCockpit.publishedHash, 'h2');
});

test('writeState round-trip PRESERVES mobileCockpit alongside cards (atomic tmp+rename)', () => {
  const p = join(workdir, 'roundtrip.json');
  const s = { version: STATE_VERSION, cards: { foo: { contentHash: 'x' } } };
  recordMobileCockpit(s, { pageId: 'p1', publishedHash: 'h1', lastDigestWrite: '2026-07-04T00:00:00.000Z' });
  writeState(s, p);
  assert.ok(!existsSync(`${p}.tmp`), 'tmp file must not linger after rename');
  const back = readState(p);
  assert.equal(back.cards.foo.contentHash, 'x');
  assert.equal(getMobileCockpit(back).pageId, 'p1');
  assert.equal(getMobileCockpit(back).publishedHash, 'h1');
  assert.equal(getMobileCockpit(back).lastDigestWrite, '2026-07-04T00:00:00.000Z');
});

// --- cleanup ---------------------------------------------------------------
try { rmSync(workdir, { recursive: true, force: true }); } catch { /* best-effort */ }

console.log(`\n${pass} passed`);
