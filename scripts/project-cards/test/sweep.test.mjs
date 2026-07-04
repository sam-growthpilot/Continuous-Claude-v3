// sweep.test.mjs — unit tests for the PURE pieces of the daily sweep.
// Only the isolatable helpers (host-kind classifier, hub-table builder) are
// tested here; the live spawns (refresh.mjs, claude -p, ntn) are not unit-tested.
// Run: node scripts/project-cards/test/sweep.test.mjs
import assert from 'node:assert/strict';
import { classifyHostKind, buildHubTable } from '../sweep.mjs';

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

console.log(`\n${pass} passed`);
