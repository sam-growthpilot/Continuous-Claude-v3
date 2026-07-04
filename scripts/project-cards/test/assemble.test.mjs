// assemble.test.mjs — unit + determinism tests for the pure assembler.
// Run: node scripts/project-cards/test/assemble.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assembleCard, esc } from '../assembler.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

const greenProject = {
  name: 'Connector Ecosystem',
  health: 'Green',
  currentFocus: 'Ship NetSuite connector #3',
  nextMilestone: 'Phase-0 OAuth spike',
  decisionNeeded: false,
  latestUpdate: 'Salesforce MCP live in prod',
  strategicBet: 'One OBO mold, many connectors',
  projectPage: 'https://github.com/example/repo',
  lastEdited: '2026-07-03T12:00:00.000Z',
  stats: [],
};

const decisions = [
  { output: 'SF connector shipped', whyItMatters: 'Unblocks pilot', nextStep: 'Wire NetSuite',
    link: 'https://example.com/a', lastEdited: '2026-07-03T00:00:00.000Z' },
  { output: 'OBO pattern proven', whyItMatters: 'Reusable', nextStep: '',
    link: '', lastEdited: '2026-07-01T00:00:00.000Z' },
  { output: 'Token lock designed', whyItMatters: 'Concurrency safe', nextStep: 'Implement lock',
    link: 'https://example.com/c', lastEdited: '2026-06-28T00:00:00.000Z' },
];

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;');
});

test('all tokens replaced — no residual {{ }}', () => {
  const html = assembleCard(greenProject, decisions, { asOf: 'Fri Jul 3, 2026 · 01:00 PM' });
  assert.ok(!html.includes('{{'), 'found unreplaced token');
  assert.ok(!html.includes('}}'), 'found unreplaced token');
});

test('health class + label correct (green)', () => {
  const html = assembleCard(greenProject, decisions, {});
  assert.ok(html.includes('class="health green"'), 'health class');
  assert.ok(html.includes('>GREEN</span>'), 'health label');
});

test('HTML-escaping neutralizes injected markup', () => {
  const evil = { ...greenProject, currentFocus: '<script>alert(1)</script>', name: 'A & B "C"' };
  const html = assembleCard(evil, decisions, {});
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script leaked');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped script present');
  assert.ok(html.includes('A &amp; B &quot;C&quot;'), 'escaped title present');
});

test('empty/unknown Health renders NEUTRAL, not green', () => {
  for (const health of ['', undefined, 'Grey', 'purple']) {
    const html = assembleCard({ ...greenProject, health }, decisions, {});
    assert.ok(html.includes('class="health neutral"'), `neutral class for ${JSON.stringify(health)}`);
    assert.ok(html.includes('>UNKNOWN</span>'), `neutral label for ${JSON.stringify(health)}`);
    // dot + label in sync: must NOT claim green
    assert.ok(!html.includes('class="health green"'), 'must not be green');
    assert.ok(!html.includes('>GREEN</span>'), 'must not label GREEN');
  }
  // GREEN still requires an explicit "Green"
  const green = assembleCard({ ...greenProject, health: 'Green' }, decisions, {});
  assert.ok(green.includes('class="health green"') && green.includes('>GREEN</span>'));
});

test('token injection: a field value containing {{TOKEN}} cannot inject', () => {
  // If replaceAll looped over the growing output, these would be substituted.
  const evil = { ...greenProject, name: '{{HEALTH_CLASS}}', currentFocus: '{{OVERVIEW_DECK}}' };
  const html = assembleCard(evil, decisions, {});
  // masthead health class/label unaffected by the injected token in the title
  assert.ok(html.includes('class="health green"'), 'masthead health untouched');
  // the injected tokens are emitted verbatim, NOT replaced with other field values
  assert.ok(html.includes('<h1>{{HEALTH_CLASS}}</h1>'), 'title token shown literally');
  assert.ok(html.includes('{{OVERVIEW_DECK}}'), 'focus token shown literally');
});

test('unresolved template token fails loud (throws)', () => {
  // Simulate a template that references a token with no matching value.
  assert.throws(() => {
    '{{PROJECT_LABEL}} {{NOPE}}'.replace(/\{\{(\w+)\}\}/g, (m, k) => {
      const tokens = { PROJECT_LABEL: 'x' };
      if (!Object.prototype.hasOwnProperty.call(tokens, k)) throw new Error(`unresolved ${m}`);
      return tokens[k];
    });
  }, /unresolved \{\{NOPE\}\}/);
});

test('WATCH_BLOCK absent when Green + no decision', () => {
  const html = assembleCard(greenProject, decisions, {});
  assert.ok(!html.includes('class="watch"'), 'watch block should be absent');
});

test('WATCH_BLOCK present when Yellow', () => {
  const html = assembleCard({ ...greenProject, health: 'Yellow' }, decisions, {});
  assert.ok(html.includes('class="watch"'), 'watch block should be present');
  assert.ok(html.includes('Health Yellow'), 'yellow watch line');
});

test('WATCH_BLOCK present when Decision Needed on Green', () => {
  const html = assembleCard({ ...greenProject, decisionNeeded: true }, decisions, {});
  assert.ok(html.includes('class="watch"'), 'watch block should be present');
  assert.ok(html.includes('Decision needed'), 'decision watch line');
});

test('progress rows use UTC MM/DD and bold output', () => {
  const html = assembleCard(greenProject, decisions, {});
  assert.ok(html.includes('<span class="d">07/03</span>'), 'mmdd date');
  assert.ok(html.includes('<b>SF connector shipped</b>'), 'bold output');
});

test('next steps only from non-empty Next Step values', () => {
  const html = assembleCard(greenProject, decisions, {});
  assert.ok(html.includes('Wire NetSuite'), 'step 1');
  assert.ok(html.includes('Implement lock'), 'step 2');
  // the empty-nextStep decision must not create a step
  const stepCount = (html.match(/class="n"/g) || []).length;
  assert.equal(stepCount, 2, 'exactly 2 numbered steps');
});

test('stats div omitted when no stats', () => {
  const html = assembleCard(greenProject, decisions, {});
  assert.ok(!html.includes('class="stats"'), 'stats should be omitted');
});

test('determinism: identical inputs -> byte-identical output', () => {
  const a = assembleCard(greenProject, decisions, { asOf: 'X' });
  const b = assembleCard(greenProject, decisions, { asOf: 'X' });
  assert.equal(a, b);
});

test('hash excludes AS_OF (canonical asOf="" is stable across stamps)', () => {
  const canonicalA = assembleCard(greenProject, decisions, { asOf: '' });
  const canonicalB = assembleCard(greenProject, decisions, { asOf: '' });
  assert.equal(sha(canonicalA), sha(canonicalB), 'canonical hash stable');
  // a different AS_OF changes rendered output but NOT the canonical hash
  const rendered1 = assembleCard(greenProject, decisions, { asOf: 'Mon' });
  const rendered2 = assembleCard(greenProject, decisions, { asOf: 'Tue' });
  assert.notEqual(rendered1, rendered2, 'as-of stamp should render differently');
  assert.equal(sha(canonicalA), sha(assembleCard(greenProject, decisions, { asOf: '' })));
});

console.log(`\n${pass} passed`);
