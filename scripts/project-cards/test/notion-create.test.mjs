// notion-create.test.mjs — pure tests for the page-create helpers (mocked
// transport; no ntn spawn). Verifies createPage body shape, the mandatory
// CaptureId stamp on every row wrapper (mitigation #3), and findByCaptureId's
// query shape (the pre-retry duplicate guard).
// Run: node --test scripts/project-cards/test/
import assert from 'node:assert/strict';
import {
  buildCreatePageBody, createPage, createTaskRow, createPmNoteRow,
  createDecisionRow, findByCaptureId,
} from '../lib/notion.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

const DS = '852a60e1-9fa6-4361-9b55-1a9f59d566d8';
const BLOCK_ID = 'blk-123';

// Capturing mock transport.
function mockPost(result = { id: 'page-new' }) {
  const calls = [];
  const post = (path, body) => { calls.push({ path, body }); return result; };
  return { post, calls };
}

// --- buildCreatePageBody -------------------------------------------------------

test('buildCreatePageBody wraps properties under data_source_id parent', () => {
  const body = buildCreatePageBody(DS, { Name: { title: [] } });
  assert.deepEqual(body.parent, { type: 'data_source_id', data_source_id: DS });
  assert.deepEqual(body.properties, { Name: { title: [] } });
});

test('buildCreatePageBody throws on empty dsId (unfilled placeholder)', () => {
  assert.throws(() => buildCreatePageBody('', {}), /dsId is empty/);
});

test('buildCreatePageBody throws on non-object properties', () => {
  assert.throws(() => buildCreatePageBody(DS, null), /plain object/);
  assert.throws(() => buildCreatePageBody(DS, ['x']), /plain object/);
});

// --- createPage -----------------------------------------------------------------

test('createPage POSTs v1/pages with the built body via injected transport', () => {
  const { post, calls } = mockPost();
  const res = createPage(DS, { A: 1 }, { post });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'v1/pages');
  assert.equal(calls[0].body.parent.data_source_id, DS);
  assert.deepEqual(calls[0].body.properties, { A: 1 });
  assert.equal(res.id, 'page-new');
});

// --- row wrappers always stamp CaptureId (mitigation #3) ------------------------

test('createTaskRow stamps CaptureId + title + optional fields, returns page id', () => {
  const { post, calls } = mockPost({ id: 'task-1' });
  const id = createTaskRow(DS, {
    title: 'UAT task', captureId: BLOCK_ID, priority: 'P2',
    due: '2026-07-10', projectRelationId: 'proj-1',
  }, { post });
  assert.equal(id, 'task-1');
  const p = calls[0].body.properties;
  assert.equal(p.CaptureId.rich_text[0].text.content, BLOCK_ID);
  assert.equal(p.Task.title[0].text.content, 'UAT task');
  // Personal Tasks DS Priority options are High/Mid/Low; P1/P2/P3 grammar
  // tokens map onto them (the DS has no P1/P2/P3 options).
  assert.equal(p.Priority.select.name, 'Mid');
  // The DS's due property is named "Due Date", not "Due".
  assert.equal(p['Due Date'].date.start, '2026-07-10');
  assert.deepEqual(p.Project.relation, [{ id: 'proj-1' }]);
});

test('createTaskRow omits optional properties when absent', () => {
  const { post, calls } = mockPost({ id: 't' });
  createTaskRow(DS, { title: 'bare', captureId: BLOCK_ID }, { post });
  const p = calls[0].body.properties;
  assert.deepEqual(Object.keys(p).sort(), ['CaptureId', 'Task']);
});

test('createPmNoteRow stamps CaptureId + Type/Status/Source selects', () => {
  const { post, calls } = mockPost({ id: 'note-1' });
  const id = createPmNoteRow(DS, {
    title: 'idea for v1', captureId: BLOCK_ID, type: 'idea',
    status: 'open', source: 'triage', projectRelationId: 'proj-2',
  }, { post });
  assert.equal(id, 'note-1');
  const p = calls[0].body.properties;
  assert.equal(p.CaptureId.rich_text[0].text.content, BLOCK_ID);
  assert.equal(p.Note.title[0].text.content, 'idea for v1');
  assert.equal(p.Type.select.name, 'idea');
  assert.equal(p.Status.select.name, 'open');
  assert.equal(p.Source.select.name, 'triage');
  assert.deepEqual(p.Project.relation, [{ id: 'proj-2' }]);
});

test('createDecisionRow stamps CaptureId + Output title', () => {
  const { post, calls } = mockPost({ id: 'dec-1' });
  const id = createDecisionRow(DS, {
    title: 'ship it', captureId: BLOCK_ID, projectRelationId: 'proj-3',
  }, { post });
  assert.equal(id, 'dec-1');
  const p = calls[0].body.properties;
  assert.equal(p.CaptureId.rich_text[0].text.content, BLOCK_ID);
  // The Decisions & Outputs DS title property is named "Output", not "Name".
  assert.equal(p.Output.title[0].text.content, 'ship it');
});

test('every row wrapper THROWS without a captureId (stamp is mandatory)', () => {
  const { post } = mockPost();
  assert.throws(() => createTaskRow(DS, { title: 'x' }, { post }), /captureId/);
  assert.throws(() => createPmNoteRow(DS, { title: 'x' }, { post }), /captureId/);
  assert.throws(() => createDecisionRow(DS, { title: 'x' }, { post }), /captureId/);
});

// --- findByCaptureId (pre-retry duplicate guard) --------------------------------

test('findByCaptureId queries by CaptureId rich_text equals and returns first row', () => {
  const calls = [];
  const query = (dsId, opts) => { calls.push({ dsId, opts }); return [{ id: 'existing' }, { id: 'second' }]; };
  const row = findByCaptureId(DS, BLOCK_ID, { query });
  assert.equal(row.id, 'existing');
  assert.equal(calls[0].dsId, DS);
  assert.deepEqual(calls[0].opts.filter, {
    property: 'CaptureId', rich_text: { equals: BLOCK_ID },
  });
});

test('findByCaptureId returns null when no row is stamped', () => {
  const row = findByCaptureId(DS, BLOCK_ID, { query: () => [] });
  assert.equal(row, null);
});

test('findByCaptureId throws without a captureId', () => {
  assert.throws(() => findByCaptureId(DS, '', { query: () => [] }), /captureId/);
});

console.log(`notion-create: ${pass} assertions-groups passed`);
