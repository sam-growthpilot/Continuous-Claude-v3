// refresh-batch.test.mjs — tests the per-project failure isolation of the
// `--all` batch runner (#8): one throwing project must NOT abort the whole batch
// or lose the state already computed for earlier projects. refreshFn is injected
// so no live Notion call happens. Run:
//   node --test scripts/project-cards/test/refresh-batch.test.mjs
import assert from 'node:assert/strict';
import { refreshAll } from '../refresh.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

const page = (name) => ({ id: `id-${name}`, properties: { Project: { title: [{ plain_text: name }] } } });

// A fake refreshProject: mutates state for each success, throws for 'Bad'.
function fakeRefresh(pg, state) {
  const name = pg.properties.Project.title[0].plain_text;
  if (name === 'Bad') throw new Error('queryDecisions boom');
  state.cards[name] = { projectRowId: pg.id, ok: true };
  return { projectName: name, slug: name.toLowerCase(), changed: true };
}

test('refreshAll: a mid-batch throw does NOT abort the batch (all pages processed)', () => {
  const state = { cards: {} };
  const results = refreshAll([page('Alpha'), page('Bad'), page('Gamma')], state, new Set(), fakeRefresh);
  assert.equal(results.length, 3, 'every page yields a result row');
});

test('refreshAll: the failing project is captured as { projectName, error }', () => {
  const state = { cards: {} };
  const results = refreshAll([page('Alpha'), page('Bad'), page('Gamma')], state, new Set(), fakeRefresh);
  assert.equal(results[1].projectName, 'Bad');
  assert.match(results[1].error, /queryDecisions boom/);
  assert.equal(results[1].changed, undefined); // it is an error row, not a manifest
});

test('refreshAll: state computed for successful projects is PRESERVED despite the throw', () => {
  const state = { cards: {} };
  refreshAll([page('Alpha'), page('Bad'), page('Gamma')], state, new Set(), fakeRefresh);
  // Alpha ran before the throw, Gamma ran after it — both must survive so the
  // caller's writeState(state) persists them (no batch-wide data loss).
  assert.ok(state.cards.Alpha && state.cards.Alpha.ok);
  assert.ok(state.cards.Gamma && state.cards.Gamma.ok);
  assert.ok(!state.cards.Bad); // the failed one left no card
});

test('refreshAll: successful manifests are returned unchanged (order preserved)', () => {
  const state = { cards: {} };
  const results = refreshAll([page('Alpha'), page('Gamma')], state, new Set(), fakeRefresh);
  assert.deepEqual(results.map((r) => r.projectName), ['Alpha', 'Gamma']);
  assert.equal(results[0].slug, 'alpha');
});

console.log(`\n${pass} passed`);
