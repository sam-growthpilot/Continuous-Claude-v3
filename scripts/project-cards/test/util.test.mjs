// util.test.mjs — pure helper validation for the project-card engine.
// Focus: toSlugSet normalizes Set/Array/Map/object shapes (mitigation for the
// previously-missing Map branch), and slugify's collision guard honors each shape.
// Run: node --test scripts/project-cards/test/
import assert from 'node:assert/strict';
import { slugify, toSlugSet } from '../lib/util.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

// --- toSlugSet (pure) --------------------------------------------------------

test('toSlugSet returns an empty Set for nullish input', () => {
  assert.deepEqual(toSlugSet(undefined), new Set());
  assert.deepEqual(toSlugSet(null), new Set());
});

test('toSlugSet passes an existing Set through unchanged', () => {
  const s = new Set(['a', 'b']);
  assert.equal(toSlugSet(s), s);
});

test('toSlugSet builds a Set from an array', () => {
  assert.deepEqual(toSlugSet(['a', 'b']), new Set(['a', 'b']));
});

test('toSlugSet builds a Set from a Map key set', () => {
  const out = toSlugSet(new Map([['a', 1], ['b', 2]]));
  assert.ok(out instanceof Set);
  assert.deepEqual(out, new Set(['a', 'b']));
});

test('toSlugSet builds a Set from a plain object key set', () => {
  assert.deepEqual(toSlugSet({ a: 1, b: 2 }), new Set(['a', 'b']));
});

// --- slugify collision guard honors the Map path -----------------------------

test('slugify suffixes on a Map collision (Map keys are honored)', () => {
  assert.equal(slugify('Alpha', new Map([['alpha', 1]])), 'alpha-2');
});

test('slugify returns the base slug when the Map has no collision', () => {
  assert.equal(slugify('Beta', new Map([['alpha', 1]])), 'beta');
});

console.log(`util: ${pass} tests passed`);
