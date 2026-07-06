// notion-query.test.mjs — pure tests for resolveProjectMatch (#6), the
// exact/ambiguous/not-found decision behind getProjectByName. No ntn spawn.
// Run: node --test scripts/project-cards/test/notion-query.test.mjs
import assert from 'node:assert/strict';
import { resolveProjectMatch } from '../lib/notion.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

// A Projects query result row with the given title.
const row = (name) => ({ properties: { Project: { title: [{ plain_text: name }] } } });

test('resolveProjectMatch: single exact match returns it', () => {
  assert.equal(resolveProjectMatch([row('Alpha')], 'Alpha').properties.Project.title[0].plain_text, 'Alpha');
});

test('resolveProjectMatch: exact match is case-insensitive', () => {
  const r = resolveProjectMatch([row('Connector Ecosystem')], 'connector ecosystem');
  assert.equal(r.properties.Project.title[0].plain_text, 'Connector Ecosystem');
});

test('resolveProjectMatch: prefers the EXACT title among several substring matches (not results[0])', () => {
  const results = [row('Foo v2'), row('Foobar'), row('Foo')];
  const r = resolveProjectMatch(results, 'Foo');
  assert.equal(r.properties.Project.title[0].plain_text, 'Foo'); // NOT 'Foo v2' (results[0])
});

test('resolveProjectMatch: single non-exact candidate is accepted (unambiguous)', () => {
  const r = resolveProjectMatch([row('Foobar')], 'Foo');
  assert.equal(r.properties.Project.title[0].plain_text, 'Foobar');
});

test('resolveProjectMatch: >1 candidate with NO exact match THROWS ambiguous (never guesses)', () => {
  const results = [row('Foo v2'), row('Foobar')];
  assert.throws(() => resolveProjectMatch(results, 'Foo'), /Ambiguous project name "Foo" matched 2 rows/);
});

test('resolveProjectMatch: ambiguous error lists the candidate names', () => {
  assert.throws(
    () => resolveProjectMatch([row('Foo v2'), row('Foobar')], 'Foo'),
    /Foo v2, Foobar/,
  );
});

test('resolveProjectMatch: zero rows THROWS not-found', () => {
  assert.throws(() => resolveProjectMatch([], 'Missing'), /No FourthOS project matched "Missing"/);
  assert.throws(() => resolveProjectMatch(undefined, 'Missing'), /No FourthOS project matched "Missing"/);
});

console.log(`\n${pass} passed`);
