// triage.test.mjs — pure grammar-table tests for parseCaptureLine/resolveDue,
// block-level consumability rules (mitigation #2), actor gate (#7), and a fully
// mocked runTriage executor: create-before-delete ordering, persist-before-delete
// (#3), re-fetch mismatch conflict path (#1), replay-hash guard (#12), receipt
// cap + escaping (#8). No ntn spawn anywhere.
// Run: node --test scripts/project-cards/test/
import assert from 'node:assert/strict';
import {
  parseCaptureLine, parseCaptureBlocks, resolveDue, replayHash, textHash,
  buildReceiptLine, buildReceiptBlocks, escapeEcho, runTriage,
} from '../lib/triage.mjs';
import { CAPTURE_HEADING, TRIAGE_LOG_HEADING } from '../lib/config.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

// Fixed injectable clock: 2026-07-04 is a SATURDAY (UTC).
const NOW = new Date('2026-07-04T12:00:00.000Z');
const ALIASES = { ccv3: '39276fd7-ac82-81c6-97b8-dc65e42168cb' };
const P = (text) => parseCaptureLine(text, { now: NOW, aliases: ALIASES });

// --- grammar table: every kind + prefix form -----------------------------------

test('task prefixes: "t ", t:, todo:, task:', () => {
  for (const l of ['t buy milk', 't: buy milk', 'todo: buy milk', 'task: buy milk']) {
    const r = P(l);
    assert.equal(r.kind, 'task', l);
    assert.equal(r.title, 'buy milk');
  }
});

test('note prefixes: "n ", n:, note:, and bare line', () => {
  for (const l of ['n remember this', 'n: remember this', 'note: remember this', 'remember this']) {
    const r = P(l);
    assert.equal(r.kind, 'note', l);
    assert.equal(r.title, 'remember this');
  }
});

test('idea prefixes: "i ", i:, idea:', () => {
  for (const l of ['i ship faster', 'i: ship faster', 'idea: ship faster']) {
    assert.equal(P(l).kind, 'idea', l);
  }
});

test('later prefixes: later:, l:', () => {
  for (const l of ['later: revisit caching', 'l: revisit caching']) {
    assert.equal(P(l).kind, 'later', l);
  }
});

test('blocker prefixes: b:, blocker:', () => {
  for (const l of ['b: waiting on IT', 'blocker: waiting on IT']) {
    assert.equal(P(l).kind, 'blocker', l);
  }
});

test('decision prefixes: "d ", d:, decision:', () => {
  for (const l of ['d go with ntn', 'd: go with ntn', 'decision: go with ntn']) {
    assert.equal(P(l).kind, 'decision', l);
  }
});

test('leading ? -> question', () => {
  const r = P('? is the embed hash-gated');
  assert.equal(r.kind, 'question');
  assert.equal(r.title, 'is the embed hash-gated');
});

test('// and # lead -> scratch (never touched)', () => {
  assert.equal(P('// thinking out loud').kind, 'scratch');
  assert.equal(P('# raw heading scribble').kind, 'scratch');
});

// --- modifiers ------------------------------------------------------------------

test('modifiers order-free and stripped: @alias !p2 due:', () => {
  const r = P('t fix bug @ccv3 !p2 due:2026-07-10');
  assert.equal(r.kind, 'task');
  assert.equal(r.title, 'fix bug');
  assert.equal(r.priority, 'P2');
  assert.equal(r.due, '2026-07-10');
  assert.equal(r.projectId, ALIASES.ccv3);
  const r2 = P('t due:2026-07-10 @ccv3 !p1 fix bug');
  assert.deepEqual({ ...r2 }, { ...r, priority: 'P1' });
});

test('due: dates resolve against injected now (Sat 2026-07-04 UTC)', () => {
  assert.equal(resolveDue('today', NOW), '2026-07-04');
  assert.equal(resolveDue('tomorrow', NOW), '2026-07-05');
  assert.equal(resolveDue('mon', NOW), '2026-07-06');   // next Monday
  assert.equal(resolveDue('sat', NOW), '2026-07-11');   // strictly after today
  assert.equal(resolveDue('+3d', NOW), '2026-07-07');
  assert.equal(resolveDue('2026-08-01', NOW), '2026-08-01');
});

// --- skip reasons ---------------------------------------------------------------

test('all skip reasons: unknown directive, unknown alias, bad dates, empty', () => {
  assert.deepEqual(P('x: gibberish'), { kind: 'skip', reason: 'unknown-directive' });
  assert.deepEqual(P('t foo @zzz'), { kind: 'skip', reason: 'unknown-alias' });
  assert.deepEqual(P('t foo due:2026-02-31'), { kind: 'skip', reason: 'bad-date' });
  assert.deepEqual(P('t foo due:someday'), { kind: 'skip', reason: 'bad-date' });
  assert.deepEqual(P('later:'), { kind: 'skip', reason: 'empty' });
  assert.deepEqual(P('   '), { kind: 'skip', reason: 'empty' });
  assert.deepEqual(P('t: @ccv3'), { kind: 'skip', reason: 'empty' }); // modifiers only
});

// --- block-level consumability (mitigation #2) + actor gate (#7) ---------------

const rtText = (text) => [{ type: 'text', plain_text: text, text: { content: text } }];
let blockSeq = 0;
function para(text, extra = {}) {
  blockSeq += 1;
  return {
    id: `blk-${blockSeq}`, type: 'paragraph', has_children: false,
    last_edited_time: '2026-07-04T10:00:00.000Z',
    created_by: { id: 'dave' }, last_edited_by: { id: 'dave' },
    paragraph: { rich_text: rtText(text) },
    ...extra,
  };
}

test('has_children blocks are unparseable (rich-content)', () => {
  const items = parseCaptureBlocks([para('t child-bearing', { has_children: true })], { now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'skip');
  assert.equal(items[0].reason, 'rich-content');
});

test('mention/link rich_text tokens are unparseable (rich-content)', () => {
  const withMention = para('x');
  withMention.paragraph.rich_text = [{ type: 'mention', plain_text: '@page' }];
  const withLink = para('t see docs');
  withLink.paragraph.rich_text[0].text.link = { url: 'https://x' };
  const items = parseCaptureBlocks([withMention, withLink], { now: NOW });
  assert.deepEqual(items.map((i) => i.reason), ['rich-content', 'rich-content']);
});

test('non-text block types are ignored entirely (not even receipted)', () => {
  const items = parseCaptureBlocks([{ id: 'e1', type: 'embed', embed: {} }], { now: NOW });
  assert.equal(items.length, 0);
});

test('scratch blocks are ignored entirely (not receipted)', () => {
  const items = parseCaptureBlocks([para('// scratch line')], { now: NOW });
  assert.equal(items.length, 0);
});

test('actor allowlist: non-empty list rejects unknown actors, admits listed ones', () => {
  const ok = para('t mine');
  const bad = para('t not mine', { created_by: { id: 'intruder' } });
  const items = parseCaptureBlocks([ok, bad], { now: NOW, aliases: ALIASES, allowlist: ['dave', 'bot'] });
  assert.equal(items[0].kind, 'task');
  assert.equal(items[1].kind, 'skip');
  assert.equal(items[1].reason, 'actor');
  // Empty allowlist = bootstrap mode, allow all.
  const all = parseCaptureBlocks([bad], { now: NOW, allowlist: [] });
  assert.equal(all[0].kind, 'task');
});

// --- runTriage executor (mocked notion + state layer) --------------------------

const CAPTURE_TEXT = CAPTURE_HEADING.replace(/^#+\s*/, '');
const LOG_TEXT = TRIAGE_LOG_HEADING.replace(/^#+\s*/, '');
const h2 = (text) => ({ id: `h-${text}`, type: 'heading_2', heading_2: { rich_text: rtText(text) } });

// Build a mock env: page = Capture section (captureBlocks) + Triage log (prevReceipts).
function mockEnv({ captureBlocks = [], prevReceipts = [], state = {}, freshOverride } = {}) {
  const ops = [];
  const pageBlocks = [h2(CAPTURE_TEXT), ...captureBlocks, h2(LOG_TEXT), ...prevReceipts];
  const byId = new Map(captureBlocks.map((b) => [b.id, b]));
  let seq = 0;
  const deps = {
    getPageBlocks: () => pageBlocks,
    getBlock: (id) => {
      ops.push({ op: 'getBlock', id });
      return (freshOverride && freshOverride(id)) || byId.get(id);
    },
    deleteBlock: (id) => ops.push({ op: 'delete', id }),
    replaceSectionBlocks: (pageId, heading, blocks) => ops.push({ op: 'receipt', heading, blocks }),
    createTaskRow: (ds, args) => { ops.push({ op: 'create', ds, args }); seq += 1; return `task-${seq}`; },
    createPmNoteRow: (ds, args) => { ops.push({ op: 'create', ds, args }); seq += 1; return `note-${seq}`; },
    createDecisionRow: (ds, args) => { ops.push({ op: 'create', ds, args }); seq += 1; return `dec-${seq}`; },
    findByCaptureId: () => null,
    readState: () => state,
    writeState: (s) => ops.push({ op: 'writeState', snapshot: JSON.parse(JSON.stringify(s)) }),
    aliases: ALIASES,
    allowlist: [],
    ids: { tasksDs: 'ds-tasks', pmNotesDs: 'ds-notes', decisionsDs: 'ds-dec', cockpitProjectId: 'proj-cockpit' },
  };
  return { ops, deps, state };
}

test('runTriage: create BEFORE persist BEFORE re-fetch BEFORE delete, per item', () => {
  const b = para('t ship it @ccv3 !p1 due:today');
  const { ops, deps } = mockEnv({ captureBlocks: [b] });
  const res = runTriage({ pageId: 'pg', now: NOW, deps });
  assert.equal(res.error, null);
  assert.equal(res.consumed, 1);
  assert.deepEqual(res.created, [{ ds: 'ds-tasks', id: 'task-1' }]);
  const order = ops.map((o) => o.op);
  assert.deepEqual(order.slice(0, 4), ['create', 'writeState', 'getBlock', 'delete']);
  // Persist-before-delete (mitigation #3): the state snapshot written before the
  // delete already carries the created row id + replay hash.
  const snap = ops[1].snapshot.mobileCockpit.triage;
  assert.deepEqual(snap.created, [{ ds: 'ds-tasks', id: 'task-1' }]);
  assert.deepEqual(snap.recentHashes, [replayHash(b.id, NOW)]);
  // Created row carries CaptureId; tasks ALWAYS relate to the Daily-Cockpit
  // project row — the personal Tasks DS's Project relation is scoped to a
  // different data source than @alias tokens resolve against, so the alias
  // is parsed but never fed into this relation for task rows.
  assert.equal(ops[0].args.captureId, b.id);
  assert.equal(ops[0].args.projectRelationId, 'proj-cockpit');
  assert.equal(ops[0].args.priority, 'P1');
  assert.equal(ops[0].args.due, '2026-07-04');
});

test('runTriage: routes note/later/blocker/question to PM Notes, decision to Decisions', () => {
  const blocks = [para('n a note'), para('later: someday'), para('b: stuck'), para('? why'), para('d: chose x')];
  const { ops, deps } = mockEnv({ captureBlocks: blocks });
  const res = runTriage({ pageId: 'pg', now: NOW, deps });
  assert.equal(res.consumed, 5);
  const creates = ops.filter((o) => o.op === 'create');
  assert.deepEqual(creates.map((c) => c.ds), ['ds-notes', 'ds-notes', 'ds-notes', 'ds-notes', 'ds-dec']);
  assert.equal(creates[0].args.type, 'note');
  assert.equal(creates[1].args.status, 'open');   // later
  assert.equal(creates[2].args.status, 'open');   // blocker
  assert.equal(creates[3].args.type, 'question');
  assert.equal(creates[0].args.source, 'triage');
});

test('runTriage: task without @alias gets the cockpit project relation', () => {
  const { ops, deps } = mockEnv({ captureBlocks: [para('t plain task')] });
  runTriage({ pageId: 'pg', now: NOW, deps });
  assert.equal(ops.find((o) => o.op === 'create').args.projectRelationId, 'proj-cockpit');
});

test('runTriage: re-fetch mismatch skips the delete and counts a conflict (mit #1)', () => {
  const b = para('t edited under us');
  const edited = { ...b, last_edited_time: '2026-07-04T11:59:00.000Z' };
  const { ops, deps } = mockEnv({ captureBlocks: [b], freshOverride: (id) => (id === b.id ? edited : null) });
  const res = runTriage({ pageId: 'pg', now: NOW, deps });
  assert.equal(res.conflicts, 1);
  assert.equal(ops.filter((o) => o.op === 'delete').length, 0);
  // Row was still created (create-then-delete, never delete-first).
  assert.equal(res.created.length, 1);
});

test('runTriage: replay hash guard skips create but still deletes the block (mit #12)', () => {
  const b = para('t crashed mid-run');
  const state = { mobileCockpit: { triage: { recentHashes: [replayHash(b.id, NOW)], created: [], lastRun: null } } };
  const { ops, deps } = mockEnv({ captureBlocks: [b], state });
  const res = runTriage({ pageId: 'pg', now: NOW, deps });
  assert.equal(ops.filter((o) => o.op === 'create').length, 0);
  assert.equal(ops.filter((o) => o.op === 'delete').length, 1);
  assert.equal(res.created.length, 0);
  assert.equal(res.consumed, 1);
});

test('runTriage: a NEW block with identical text files normally (hash includes block id)', () => {
  const old = para('t same text');
  const fresh = para('t same text'); // different block id
  const state = { mobileCockpit: { triage: { recentHashes: [replayHash(old.id, NOW)], created: [], lastRun: null } } };
  const { ops, deps } = mockEnv({ captureBlocks: [fresh], state });
  runTriage({ pageId: 'pg', now: NOW, deps });
  assert.equal(ops.filter((o) => o.op === 'create').length, 1);
});

test('runTriage: findByCaptureId hit reuses the existing row instead of re-creating (mit #3)', () => {
  const b = para('t ambiguous retry');
  const { ops, deps } = mockEnv({ captureBlocks: [b] });
  deps.findByCaptureId = () => ({ id: 'already-there' });
  const res = runTriage({ pageId: 'pg', now: NOW, deps });
  assert.equal(ops.filter((o) => o.op === 'create').length, 0);
  assert.deepEqual(res.created, [{ ds: 'ds-tasks', id: 'already-there' }]);
  assert.equal(ops.filter((o) => o.op === 'delete').length, 1);
});

test('runTriage: skipped lines stay in place and are listed in the receipt', () => {
  const { ops, deps } = mockEnv({ captureBlocks: [para('x: gibberish'), para('t good one')] });
  const res = runTriage({ pageId: 'pg', now: NOW, deps });
  assert.equal(res.skipped, 1);
  assert.equal(res.consumed, 1);
  assert.equal(ops.filter((o) => o.op === 'delete').length, 1);
  const receipt = ops.find((o) => o.op === 'receipt');
  const text = receipt.blocks[0].paragraph.rich_text[0].text.content;
  assert.match(text, /consumed 1, skipped 1/);
  assert.match(text, /unknown-directive/);
  assert.match(text, /x: gibberish/);
});

test('runTriage: dryRun parses and counts but performs zero ops', () => {
  const { ops, deps } = mockEnv({ captureBlocks: [para('t a'), para('x: bad')] });
  const res = runTriage({ pageId: 'pg', dryRun: true, now: NOW, deps });
  assert.equal(res.consumed, 1);
  assert.equal(res.skipped, 1);
  assert.equal(ops.length, 0);
});

test('runTriage: missing Capture heading is non-fatal', () => {
  const deps = mockEnv({}).deps;
  deps.getPageBlocks = () => [h2('Something Else')];
  const res = runTriage({ pageId: 'pg', now: NOW, deps });
  assert.equal(res.error, 'capture-heading-not-found');
  assert.equal(res.consumed, 0);
});

// --- receipt cap + escaping (mitigation #8) -------------------------------------

test('receipt keeps last 10: 12 previous receipts collapse to 10 total', () => {
  const prev = Array.from({ length: 12 }, (_, i) => para(`old receipt ${i}`));
  const { ops, deps } = mockEnv({ captureBlocks: [para('t new work')], prevReceipts: prev });
  runTriage({ pageId: 'pg', now: NOW, deps });
  const receipt = ops.find((o) => o.op === 'receipt');
  assert.equal(receipt.heading, TRIAGE_LOG_HEADING);
  assert.equal(receipt.blocks.length, 10);
  assert.match(receipt.blocks[0].paragraph.rich_text[0].text.content, /consumed 1/);
  assert.match(receipt.blocks[1].paragraph.rich_text[0].text.content, /old receipt 0/);
  assert.match(receipt.blocks[9].paragraph.rich_text[0].text.content, /old receipt 8/);
});

test('receipt echoes are escaped and capped at 60 chars', () => {
  assert.equal(escapeEcho('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  const long = 'a'.repeat(100);
  assert.equal(escapeEcho(long).length, 60);
  assert.ok(escapeEcho(long).endsWith('…'));
  assert.equal(escapeEcho('tab\tandctl'), 'tab and ctl');
  const line = buildReceiptLine({
    consumed: [], skipped: [{ reason: 'unknown-directive', raw: '<img onerror=x>' }],
    conflicts: [], nowIso: '2026-07-04T12:00',
  });
  assert.ok(line.includes('&lt;img onerror=x&gt;'));
  assert.ok(!line.includes('<img'));
});

test('buildReceiptBlocks drops non-paragraph and blank prior blocks', () => {
  const prev = [para('kept'), { id: 'x', type: 'divider' }, para('   ')];
  const out = buildReceiptBlocks(prev, 'new line');
  assert.equal(out.length, 2);
  assert.equal(out[0].paragraph.rich_text[0].text.content, 'new line');
  assert.equal(out[1].paragraph.rich_text[0].text.content, 'kept');
});

console.log(`\ntriage.test.mjs: ${pass} passed`);
