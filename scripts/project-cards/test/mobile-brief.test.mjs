// mobile-brief.test.mjs — structure/size asserts for the phone-first brief.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMobileBriefHtml, toHref } from '../mobile-brief.mjs';

const NOW = new Date('2026-07-04T12:00:00Z');

const QUEUE = {
  items: [
    { rank: 1, level: 'high', kind: 'decision', title: 'Pick vendor', reason: 'decision needed (open 9d)', url: '30e76fd7-ac82-81e9-9fe1-c0b257088b34' },
    { rank: 2, level: 'high', kind: 'task', title: 'Fix auth <bug>', reason: 'overdue 3d', url: 'https://example.com/t1' },
    { rank: 3, level: 'med', kind: 'sponsor', title: 'Helm', reason: 'sponsor report stale 12d', url: null },
  ],
  normal: [
    { kind: 'project', title: 'LinkMap', url: 'https://example.com/p1' },
    { kind: 'task', title: 'Write docs', url: null },
  ],
};

const ROSTER = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];

function render(extra = {}) {
  return buildMobileBriefHtml({ queue: QUEUE, roster: ROSTER, asOf: NOW, ...extra });
}

test('renders ranked queue items in order with levels and reasons', () => {
  const html = render();
  const i1 = html.indexOf('Pick vendor');
  const i2 = html.indexOf('Fix auth &lt;bug&gt;');
  const i3 = html.indexOf('Helm');
  assert.ok(i1 > -1 && i2 > -1 && i3 > -1, 'all queue titles render');
  assert.ok(i1 < i2 && i2 < i3, 'items appear in rank order');
  assert.match(html, /class="qi high"/);
  assert.match(html, /class="qi med"/);
  assert.match(html, /decision needed \(open 9d\)/);
  assert.match(html, /<span class="rk">1<\/span>/);
});

test('queue is open by default; normal section collapsed', () => {
  const html = render();
  assert.match(html, /<details open>\s*<summary>Needs your attention/);
  assert.match(html, /<details>\s*<summary>Operating normally/);
  assert.ok(html.includes('LinkMap'), 'normal entries render');
});

test('deep links: notion ids get nodash notion.so href, absolute urls pass through', () => {
  const html = render();
  assert.ok(
    html.includes('href="https://www.notion.so/30e76fd7ac8281e99fe1c0b257088b34"'),
    'dashed notion id becomes nodash notion.so link',
  );
  assert.ok(html.includes('href="https://example.com/t1"'), 'absolute url unchanged');
  assert.match(html, /target="_blank" rel="noopener"/);
  // Unit checks on the resolver.
  assert.equal(toHref('30e76fd7ac8281e99fe1c0b257088b34'), 'https://www.notion.so/30e76fd7ac8281e99fe1c0b257088b34');
  assert.equal(toHref('not-a-link'), null);
  assert.equal(toHref(null), null);
});

test('mobile-first scaffolding: viewport meta, 16px base, 44px tap targets, dark mode', () => {
  const html = render();
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /font:16px\//);
  assert.match(html, /min-height:44px/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
});

test('sweep footer: ok, stale, failed, and missing states', () => {
  const okHtml = render({ lastSweep: { ts: NOW.getTime() - 3600000, ok: true } });
  assert.match(okHtml, /sweep ok[^<]*<\/span>|class="sweep ok"/);
  const staleHtml = render({ lastSweep: { ts: NOW.getTime() - 30 * 3600000, ok: true } });
  assert.match(staleHtml, /is stale/);
  const failHtml = render({ lastSweep: { ts: NOW.getTime() - 3600000, ok: false } });
  assert.match(failHtml, /reported a failure/);
  assert.match(render(), /no sweep recorded/);
});

test('empty queue renders all-clear, empty inputs are safe', () => {
  const html = buildMobileBriefHtml({ queue: { items: [], normal: [] }, roster: [], asOf: NOW });
  assert.match(html, /all clear/);
  assert.match(html, /Nothing else on record/);
  const bare = buildMobileBriefHtml({});
  assert.ok(bare.startsWith('<!doctype html>'));
});

test('size sanity: stays comfortably under 60KiB with a realistic load', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    rank: i + 1, level: i % 3 ? 'med' : 'high', kind: 'task',
    title: `Task number ${i} with a moderately long title for realism`,
    reason: `overdue ${i}d`, url: 'https://example.com/x',
  }));
  const normal = Array.from({ length: 60 }, (_, i) => ({
    kind: 'project', title: `Quiet project ${i}`, url: null,
  }));
  const html = buildMobileBriefHtml({ queue: { items, normal }, roster: ROSTER, asOf: NOW });
  assert.ok(Buffer.byteLength(html, 'utf8') < 60 * 1024, `size ${Buffer.byteLength(html)} >= 60KiB`);
});

test('deterministic: same inputs produce identical HTML', () => {
  assert.equal(render(), render());
});
