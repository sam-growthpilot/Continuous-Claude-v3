// WF-2 pre-processing: exclusion pre-kill + dedup clustering + batch construction.
// Deterministic orchestrator-side step (premortem: dedup preserves causal chains —
// clusters LINK findings via cluster_id, nothing is merged/deleted).
import fs from 'node:fs';

const FDIR = 'docs/reviews/2026-06-10/findings/';
const W2 = 'docs/reviews/2026-06-10/wf2/';
fs.mkdirSync(W2 + 'batches', { recursive: true });

let exclusions = ['.codex/', 'node_modules/', '.claude/hooks/dist/', '.claude/skills/_snapshots/', '_archived', '/archive/', 'docs/reviews/'];
try {
  const em = JSON.parse(fs.readFileSync('docs/reviews/2026-06-10/harvest/exclusion-manifest.json', 'utf8'));
  const cand = em.excluded_paths || em.exclusions || (Array.isArray(em) ? em : null);
  if (Array.isArray(cand) && cand.length) exclusions = cand.filter((e) => typeof e === 'string');
} catch { /* fall back to defaults above */ }
const norm = (p) => String(p).replace(/\\/g, '/');
const isExcluded = (p) => exclusions.some((e) => norm(p).includes(norm(e)));

const files = fs.readdirSync(FDIR).filter((f) => /^(D|GAP)\w*\.json$/.test(f) && f !== 'GAPS-MANIFEST.json');
const all = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(FDIR + f, 'utf8'));
  const arr = Array.isArray(j) ? j : (j.findings || []);
  for (const x of arr) { x._dim = j.dimension || f.replace('.json', ''); all.push(x); }
}
console.log('loaded findings:', all.length, 'from', files.length, 'files');

const autoKilled = [];
const live = [];
for (const x of all) {
  const evFiles = (x.evidence || []).map((e) => norm(e.file || ''));
  const bad = evFiles.length > 0 && evFiles.every((p) => isExcluded(p));
  if (bad) autoKilled.push({ id: x.id, reason: 'all evidence files in exclusion manifest', files: evFiles });
  else live.push(x);
}
console.log('auto-killed (exclusion):', autoKilled.length, '| live:', live.length);

const parent = {};
const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
live.forEach((x) => { parent[x.id] = x.id; });
const keyMap = {};
for (const x of live) {
  for (const k of (x.dedup_keys || [])) {
    if (keyMap[k]) union(x.id, keyMap[k]); else keyMap[k] = x.id;
  }
}
const clusters = {};
for (const x of live) { const r = find(x.id); (clusters[r] = clusters[r] || []).push(x); }
const sizes = Object.values(clusters).map((c) => c.length);
console.log('clusters:', sizes.length, '| multi-member:', sizes.filter((s) => s > 1).length, '| largest:', Math.max(...sizes));
let ci = 0;
for (const members of Object.values(clusters)) { ci++; members.forEach((m) => { m.cluster_id = 'C' + String(ci).padStart(3, '0'); }); }

const hi = live.filter((x) => x.severity === 'S0' || x.severity === 'S1');
const lo = live.filter((x) => !(x.severity === 'S0' || x.severity === 'S1'));
const mkBatches = (items) => {
  const byCluster = {};
  items.forEach((x) => { (byCluster[x.cluster_id] = byCluster[x.cluster_id] || []).push(x); });
  const groups = Object.values(byCluster).sort((a, b) => b.length - a.length);
  const batches = [];
  for (const g of groups) {
    if (g.length >= 8) { for (let i = 0; i < g.length; i += 8) batches.push(g.slice(i, i + 8)); continue; }
    let placed = false;
    for (const b of batches) { if (b.length + g.length <= 8) { b.push(...g); placed = true; break; } }
    if (!placed) batches.push([...g]);
  }
  return batches;
};
const hiB = mkBatches(hi), loB = mkBatches(lo);
console.log('S0/S1 findings:', hi.length, '-> batches:', hiB.length);
console.log('S2/S3 findings:', lo.length, '-> batches:', loB.length);
hiB.forEach((b, i) => fs.writeFileSync(W2 + 'batches/hi-' + String(i + 1).padStart(2, '0') + '.json', JSON.stringify(b, null, 2) + '\n'));
loB.forEach((b, i) => fs.writeFileSync(W2 + 'batches/lo-' + String(i + 1).padStart(2, '0') + '.json', JSON.stringify(b, null, 2) + '\n'));
fs.writeFileSync(W2 + 'auto-killed.json', JSON.stringify(autoKilled, null, 2) + '\n');
fs.writeFileSync(W2 + 'clusters.json', JSON.stringify(Object.fromEntries(Object.values(clusters).map((v) => [v[0].cluster_id, v.map((m) => m.id)])), null, 2) + '\n');
console.log('written: hi batches', hiB.length, '| lo batches', loB.length, '| auto-killed.json | clusters.json');
