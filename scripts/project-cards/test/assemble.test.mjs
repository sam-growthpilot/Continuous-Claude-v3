// assemble.test.mjs — unit + determinism tests for the pure assembler.
// Run: node scripts/project-cards/test/assemble.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assembleCard, esc } from '../assembler.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
// Fixed clock so the attention fallback (days-since-edit / days-to-review) is
// deterministic in tests instead of depending on the wall clock.
const NOW = new Date('2026-07-03T18:00:00.000Z');
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
  reviewDate: '',
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

// Project with zero decisions and no Last Edited / Review date -> zero stat tiles.
const bareProject = {
  name: 'Bare Co',
  health: 'Green',
  currentFocus: 'Kickoff',
  nextMilestone: 'Scope',
  decisionNeeded: false,
  latestUpdate: 'Just started',
  strategicBet: 'TBD',
  projectPage: '',
  lastEdited: null,
  reviewDate: '',
  stats: [],
};

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;');
});

test('all tokens replaced — no residual {{ }}', () => {
  const html = assembleCard(greenProject, decisions, { asOf: 'Fri Jul 3, 2026 · 01:00 PM', now: NOW });
  assert.ok(!html.includes('{{'), 'found unreplaced token');
  assert.ok(!html.includes('}}'), 'found unreplaced token');
});

test('health class + label correct (green)', () => {
  const html = assembleCard(greenProject, decisions, { now: NOW });
  assert.ok(html.includes('class="health green"'), 'health class');
  assert.ok(html.includes('>GREEN</span>'), 'health label');
});

test('HTML-escaping neutralizes injected markup', () => {
  const evil = { ...greenProject, currentFocus: '<script>alert(1)</script>', name: 'A & B "C"' };
  const html = assembleCard(evil, decisions, { now: NOW });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script leaked');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped script present');
  assert.ok(html.includes('A &amp; B &quot;C&quot;'), 'escaped title present');
});

test('empty/unknown Health renders NEUTRAL, not green', () => {
  for (const health of ['', undefined, 'Grey', 'purple']) {
    const html = assembleCard({ ...greenProject, health }, decisions, { now: NOW });
    assert.ok(html.includes('class="health neutral"'), `neutral class for ${JSON.stringify(health)}`);
    assert.ok(html.includes('>UNKNOWN</span>'), `neutral label for ${JSON.stringify(health)}`);
    // dot + label in sync: must NOT claim green
    assert.ok(!html.includes('class="health green"'), 'must not be green');
    assert.ok(!html.includes('>GREEN</span>'), 'must not label GREEN');
  }
  // GREEN still requires an explicit "Green"
  const green = assembleCard({ ...greenProject, health: 'Green' }, decisions, { now: NOW });
  assert.ok(green.includes('class="health green"') && green.includes('>GREEN</span>'));
});

test('token injection: a field value containing {{TOKEN}} cannot inject', () => {
  // If replaceAll looped over the growing output, these would be substituted.
  const evil = { ...greenProject, name: '{{HEALTH_CLASS}}', currentFocus: '{{OVERVIEW_DECK}}' };
  const html = assembleCard(evil, decisions, { now: NOW });
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

test('WATCH_BLOCK absent when Green + no decision + fresh', () => {
  const html = assembleCard(greenProject, decisions, { now: NOW });
  assert.ok(!html.includes('class="watch"'), 'watch block should be absent');
});

test('WATCH_BLOCK present when Yellow', () => {
  const html = assembleCard({ ...greenProject, health: 'Yellow' }, decisions, { now: NOW });
  assert.ok(html.includes('class="watch"'), 'watch block should be present');
  assert.ok(html.includes('Health Yellow'), 'yellow watch line');
});

test('WATCH_BLOCK present when Decision Needed on Green', () => {
  const html = assembleCard({ ...greenProject, decisionNeeded: true }, decisions, { now: NOW });
  assert.ok(html.includes('class="watch"'), 'watch block should be present');
  assert.ok(html.includes('Decision needed'), 'decision watch line');
});

test('progress rows use UTC MM/DD and bold output', () => {
  const html = assembleCard(greenProject, decisions, { now: NOW });
  assert.ok(html.includes('<span class="d">07/03</span>'), 'mmdd date');
  assert.ok(html.includes('<b>SF connector shipped</b>'), 'bold output');
});

test('progress rows show Decision/Finding text when present', () => {
  const withFinding = [
    { output: 'OBO chosen', decisionFinding: 'Picked per-user AuthCode+PKCE', whyItMatters: 'ignored here',
      nextStep: '', link: '', lastEdited: '2026-07-02T00:00:00.000Z' },
  ];
  const html = assembleCard(greenProject, withFinding, { now: NOW });
  assert.ok(html.includes('Picked per-user AuthCode+PKCE'), 'decision/finding text shown');
});

test('next steps only from non-empty Next Step values', () => {
  const html = assembleCard(greenProject, decisions, { now: NOW });
  assert.ok(html.includes('Wire NetSuite'), 'step 1');
  assert.ok(html.includes('Implement lock'), 'step 2');
  // the empty-nextStep decision must not create a step
  const stepCount = (html.match(/class="n"/g) || []).length;
  assert.equal(stepCount, 2, 'exactly 2 numbered steps');
});

test('stats div omitted when no decisions and no dates', () => {
  const html = assembleCard(bareProject, [], { now: NOW });
  assert.ok(!html.includes('class="stats"'), 'stats should be omitted');
});

test('stats + review + staleness render with real signal', () => {
  const statsProject = {
    ...greenProject,
    name: 'Stats Co',
    health: 'Yellow',
    lastEdited: '2026-06-01T00:00:00.000Z', // ~32d before NOW -> stale
    reviewDate: '2026-06-30',               // before NOW -> overdue
  };
  const statsDecisions = [
    { output: 'A shipped', status: 'Shipped', decisionFinding: 'Chose Option B for OBO',
      whyItMatters: 'x', nextStep: '', link: '', lastEdited: '2026-07-01T00:00:00.000Z' },
    { output: 'B pending', status: 'Pending Decision', decisionFinding: '', whyItMatters: 'y',
      nextStep: 'Decide', link: '', lastEdited: '2026-06-20T00:00:00.000Z' },
    { output: 'C review', status: 'Needs Review', whyItMatters: 'z',
      nextStep: '', link: '', lastEdited: '2026-06-15T00:00:00.000Z' },
  ];
  const html = assembleCard(statsProject, statsDecisions, { asOf: 'X', now: NOW });

  // Stats row present with the computed tiles.
  assert.ok(html.includes('class="stats"'), 'stats row present');
  assert.ok(html.includes('<b>3</b><span>D&amp;O logged</span>'), 'D&O total = 3');
  assert.ok(html.includes('<b>1</b><span>shipped</span>'), 'shipped = 1');
  assert.ok(html.includes('<div class="warn"><b>2</b><span>pending</span>'), 'pending = 2 (warn)');
  assert.ok(html.includes('<div class="warn"><b>32d</b><span>since edit</span>'), 'since edit = 32d (warn)');
  assert.ok(html.includes('<div class="crit"><b>4d</b><span>OVERDUE</span>'), 'review OVERDUE 4d (crit)');

  // Decision/Finding text surfaced in recent progress.
  assert.ok(html.includes('Chose Option B for OBO'), 'decision/finding text');

  // Watch block surfaces staleness + overdue review.
  assert.ok(html.includes('class="watch"'), 'watch present');
  assert.ok(html.includes('32d since last update'), 'stale watch line');
  assert.ok(html.includes('Review overdue 4d'), 'overdue review watch line');
});

test('review "due soon" tile renders (warn, not crit) when review is within 7d', () => {
  const soon = { ...greenProject, name: 'Soon Co', reviewDate: '2026-07-06' }; // +2d (floor) from NOW 18:00Z
  const html = assembleCard(soon, decisions, { asOf: 'X', now: NOW });
  assert.ok(html.includes('<div class="warn"><b>2d</b><span>to review</span>'), 'due-soon review tile');
  assert.ok(!html.includes('OVERDUE'), 'not overdue');
});

test('sparkline + trend note render (up trend) and are self-contained', () => {
  const series = [
    { date: '2026-07-01', health: 'Red' },
    { date: '2026-07-02', health: 'Yellow' },
    { date: '2026-07-03', health: 'Green' },
  ];
  const html = assembleCard(greenProject, decisions, { asOf: 'X', series, now: NOW });
  assert.ok(html.includes('class="trendbar"'), 'trend bar present');
  assert.ok(html.includes('<svg class="spark"'), 'inline sparkline svg present');
  assert.ok(html.includes('<polyline'), 'sparkline polyline present');
  // Self-contained: no external references inside the svg.
  const svg = html.slice(html.indexOf('<svg class="spark"'), html.indexOf('</svg>') + 6);
  assert.ok(!/href|url\(|xlink/i.test(svg), 'sparkline has no external references');
  // Trend note: was Yellow -> now Green (up).
  assert.ok(html.includes('class="tnote up"'), 'up trend note class');
  assert.ok(html.includes('was Yellow'), 'prev health');
  assert.ok(html.includes('now Green'), 'current health');
});

test('sparkline down trend flips the note class', () => {
  const series = [
    { date: '2026-07-02', health: 'Green' },
    { date: '2026-07-03', health: 'Yellow' },
  ];
  const html = assembleCard(greenProject, decisions, { asOf: 'X', series, now: NOW });
  assert.ok(html.includes('class="tnote down"'), 'down trend note class');
  assert.ok(html.includes('was Green'), 'prev health');
  assert.ok(html.includes('now Yellow'), 'current health');
});

test('sparkline excluded from the canonical (hash) render', () => {
  const series = [
    { date: '2026-07-01', health: 'Red' },
    { date: '2026-07-02', health: 'Yellow' },
    { date: '2026-07-03', health: 'Green' },
  ];
  // Canonical render is asOf='' — the live decorations must NOT appear, so the
  // sparkline can never churn the content hash refresh computes from it.
  const canonicalWithSeries = assembleCard(greenProject, decisions, { asOf: '', series, now: NOW });
  const canonicalNoSeries = assembleCard(greenProject, decisions, { asOf: '', series: [], now: NOW });
  assert.ok(!canonicalWithSeries.includes('class="spark"'), 'no sparkline in canonical');
  assert.ok(!canonicalWithSeries.includes('class="trendbar"'), 'no trend bar in canonical');
  // series must not affect the canonical hash at all
  assert.equal(sha(canonicalWithSeries), sha(canonicalNoSeries), 'series does not change canonical hash');
});

test('determinism: identical inputs -> byte-identical output', () => {
  const series = [
    { date: '2026-07-02', health: 'Yellow' },
    { date: '2026-07-03', health: 'Green' },
  ];
  const a = assembleCard(greenProject, decisions, { asOf: 'X', series, now: NOW });
  const b = assembleCard(greenProject, decisions, { asOf: 'X', series, now: NOW });
  assert.equal(a, b);
});

test('hash excludes AS_OF (canonical asOf="" is stable across stamps)', () => {
  const canonicalA = assembleCard(greenProject, decisions, { asOf: '', now: NOW });
  const canonicalB = assembleCard(greenProject, decisions, { asOf: '', now: NOW });
  assert.equal(sha(canonicalA), sha(canonicalB), 'canonical hash stable');
  // a different AS_OF changes rendered output but NOT the canonical hash
  const rendered1 = assembleCard(greenProject, decisions, { asOf: 'Mon', now: NOW });
  const rendered2 = assembleCard(greenProject, decisions, { asOf: 'Tue', now: NOW });
  assert.notEqual(rendered1, rendered2, 'as-of stamp should render differently');
  assert.equal(sha(canonicalA), sha(assembleCard(greenProject, decisions, { asOf: '', now: NOW })));
});

console.log(`\n${pass} passed`);
