// aliases.test.mjs — capture-aliases loader validation (mitigation #10:
// aliases are JSON data, strictly validated; malformed entries throw).
// Run: node --test scripts/project-cards/test/
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateAliases, loadAliases, resolveAlias, ALIASES_PATH } from '../lib/aliases.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

const DASHED = '852a60e1-9fa6-4361-9b55-1a9f59d566d8';
const BARE = '852a60e19fa643619b551a9f59d566d8';

// --- validateAliases (pure) ------------------------------------------------------

test('accepts empty aliases map (seed file shape)', () => {
  assert.deepEqual(validateAliases({ aliases: {} }), {});
});

test('accepts dashed and bare 32-hex ids', () => {
  const a = validateAliases({ aliases: { ccv3: DASHED, sf: BARE } });
  assert.equal(a.ccv3, DASHED);
  assert.equal(a.sf, BARE);
});

test('throws on non-object root / missing aliases key', () => {
  assert.throws(() => validateAliases(null), /root must be an object/);
  assert.throws(() => validateAliases([]), /root must be an object/);
  assert.throws(() => validateAliases({}), /"aliases" must be an object/);
  assert.throws(() => validateAliases({ aliases: ['x'] }), /"aliases" must be an object/);
});

test('throws on malformed id values', () => {
  assert.throws(() => validateAliases({ aliases: { x: 'not-an-id' } }), /malformed id/);
  assert.throws(() => validateAliases({ aliases: { x: DASHED.slice(0, 30) } }), /malformed id/);
  assert.throws(() => validateAliases({ aliases: { x: DASHED.toUpperCase() } }), /malformed id/);
  assert.throws(() => validateAliases({ aliases: { x: 123 } }), /malformed id/);
});

test('throws on malformed alias keys', () => {
  assert.throws(() => validateAliases({ aliases: { 'Bad Key': DASHED } }), /malformed alias key/);
  assert.throws(() => validateAliases({ aliases: { '@ccv3': DASHED } }), /malformed alias key/);
});

// --- loadAliases (disk) ------------------------------------------------------------

test('loads the checked-in seed file (empty map, valid)', () => {
  const a = loadAliases(ALIASES_PATH);
  assert.equal(typeof a, 'object');
});

test('loads a valid temp file; throws on invalid JSON and missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aliases-'));
  try {
    const good = join(dir, 'good.json');
    writeFileSync(good, JSON.stringify({ aliases: { netsuite: DASHED } }));
    assert.equal(loadAliases(good).netsuite, DASHED);

    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ not json');
    assert.throws(() => loadAliases(bad), /invalid JSON/);

    assert.throws(() => loadAliases(join(dir, 'missing.json')), /cannot read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- resolveAlias -------------------------------------------------------------------

test('resolveAlias is case-insensitive on the token and null on unknown', () => {
  const aliases = { ccv3: DASHED };
  assert.equal(resolveAlias('ccv3', aliases), DASHED);
  assert.equal(resolveAlias('CCv3', aliases), DASHED);
  assert.equal(resolveAlias('zzz', aliases), null);
  assert.equal(resolveAlias('', aliases), null);
});

console.log(`aliases: ${pass} tests passed`);
