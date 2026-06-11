// WF-2 verdict merge: resolve every WF-1 finding to a final verdict.
// hi (S0/S1): hiMerged unanimous-CONFIRM stands; KEEP-AND-FLAG resolved by arbitration.
// lo (S2/S3): ops-realist verdict. Plus the 4 mechanically auto-killed (exclusion).
import fs from 'node:fs';

const ROOT = 'C:/Users/david.hayes/continuous-claude/docs/reviews/2026-06-10';
const FDIR = ROOT + '/findings/';
const W2 = ROOT + '/wf2/';
const OUT = process.argv[2]; // path to w5l5z3k6y.output

const res = JSON.parse(fs.readFileSync(OUT, 'utf8')).result;

// 1. original findings: id -> meta
const orig = {};
for (const f of fs.readdirSync(FDIR).filter((x) => /^(D|GAP)\w*\.json$/.test(x) && x !== 'GAPS-MANIFEST.json')) {
  const j = JSON.parse(fs.readFileSync(FDIR + x_(f), 'utf8'));
  const arr = Array.isArray(j) ? j : (j.findings || []);
  for (const it of arr) orig[it.id] = { id: it.id, dimension: j.dimension || f.replace('.json', ''), title: it.title, severity: it.severity, leverage: it.leverage || null, proposed_class: it.proposed_class || null, seed_ref: it.seed_ref || null };
}
function x_(f) { return f; }

// 2. arbitration verdicts: id -> {verdict, adjusted_severity, reason}
const arb = {};
for (const chunk of (res.arbVerdicts || [])) for (const v of (chunk.verdicts || [])) arb[v.id] = v;

// 3. lo ops verdicts: id -> verdict obj
const lo = {};
for (const b of (res.loVerdicts || [])) for (const v of (b.verdicts || [])) lo[v.id] = v;

// 4. auto-killed (exclusion)
let autoKilled = [];
try { autoKilled = JSON.parse(fs.readFileSync(W2 + 'auto-killed.json', 'utf8')); } catch {}
const autoKillIds = new Set(autoKilled.map((a) => a.id));

// 5. resolve every finding
const final = {}; // id -> {id, dimension, title, orig_sev, final_verdict, final_sev, source, reason}
function setF(id, verdict, finalSev, source, reason, extra) {
  const m = orig[id] || { id, dimension: '?', title: '(unknown finding id)', severity: '?' };
  final[id] = { id, dimension: m.dimension, title: m.title, orig_sev: m.severity, leverage: m.leverage, proposed_class: m.proposed_class, seed_ref: m.seed_ref, final_verdict: verdict, final_sev: finalSev, source, reason: (reason || '').slice(0, 400), ...(extra || {}) };
}

// hi: hiMerged
for (const h of (res.hiMerged || [])) {
  const m = orig[h.id];
  if (h.verdict === 'CONFIRM') {
    setF(h.id, 'CONFIRM', m ? m.severity : '?', 'hi-unanimous', (h.refuterA && h.refuterA.reason) || '', { refuterA: h.refuterA && h.refuterA.verdict, refuterB: h.refuterB && h.refuterB.verdict });
  } else { // KEEP-AND-FLAG -> arbitration
    const a = arb[h.id];
    if (a) {
      const fv = a.verdict; // CONFIRM | DOWNGRADE | KILL
      const fs2 = fv === 'KILL' ? null : (a.adjusted_severity || (m ? m.severity : '?'));
      setF(h.id, fv, fs2, 'arbitrated', a.reason || '', { refuterA: h.refuterA && h.refuterA.verdict, refuterB: h.refuterB && h.refuterB.verdict, counter_evidence: (a.counter_evidence || '').slice(0, 300) });
    } else {
      setF(h.id, 'KEEP-AND-FLAG', m ? m.severity : '?', 'unresolved-no-arb', 'split refuters, arbitrator did not return a verdict for this id', { refuterA: h.refuterA && h.refuterA.verdict, refuterB: h.refuterB && h.refuterB.verdict });
    }
  }
}

// lo
for (const id of Object.keys(lo)) {
  const v = lo[id];
  const m = orig[id];
  const fv = v.verdict; // CONFIRM | DOWNGRADE | KILL | KEEP-AND-FLAG
  const fs2 = fv === 'KILL' ? null : (v.adjusted_severity || (m ? m.severity : '?'));
  setF(id, fv, fs2, 'lo-ops', v.reason || '', { unreachable: v.unreachable || false });
}

// auto-killed
for (const a of autoKilled) if (!final[a.id]) setF(a.id, 'KILL', null, 'auto-exclusion', a.reason || 'evidence only in excluded paths');

// 6. coverage: any original finding with no verdict?
const missing = Object.keys(orig).filter((id) => !final[id] && !autoKillIds.has(id));
for (const id of missing) setF(id, 'NO-VERDICT', orig[id].severity, 'MISSING', 'no refuter/ops/arb verdict produced for this id');

// 7. stats
const byVerdict = {}; const confirmedBySev = {}; const downgrades = []; const kills = []; const noVerdict = [];
for (const id of Object.keys(final)) {
  const f = final[id];
  byVerdict[f.final_verdict] = (byVerdict[f.final_verdict] || 0) + 1;
  if (f.final_verdict === 'CONFIRM') confirmedBySev[f.final_sev] = (confirmedBySev[f.final_sev] || 0) + 1;
  if (f.final_verdict === 'DOWNGRADE') downgrades.push(`${id} ${f.orig_sev}->${f.final_sev}`);
  if (f.final_verdict === 'KILL') kills.push(id);
  if (f.final_verdict === 'NO-VERDICT') noVerdict.push(id);
}

fs.writeFileSync(W2 + 'WF2-VERDICTS.json', JSON.stringify({ generated_from: 'w5l5z3k6y / wf_69ab5f8d-34c', review_sha: '86b8f60', total: Object.keys(final).length, byVerdict, confirmedBySev, findings: final }, null, 2) + '\n');

// confirmed digest sorted by sev then dimension
const sevRank = { S0: 0, S1: 1, S2: 2, S3: 3 };
const confirmed = Object.values(final).filter((f) => f.final_verdict === 'CONFIRM').sort((a, b) => (sevRank[a.final_sev] ?? 9) - (sevRank[b.final_sev] ?? 9) || a.dimension.localeCompare(b.dimension));
fs.writeFileSync(W2 + 'confirmed-digest.json', JSON.stringify(confirmed.map((f) => ({ id: f.id, sev: f.final_sev, leverage: f.leverage, proposed_class: f.proposed_class, dimension: f.dimension, title: f.title, seed_ref: f.seed_ref })), null, 2) + '\n');

console.log('TOTAL resolved:', Object.keys(final).length);
console.log('byVerdict:', JSON.stringify(byVerdict));
console.log('confirmed by final severity:', JSON.stringify(confirmedBySev));
console.log('downgrades:', downgrades.length, '| kills:', kills.length, '| no-verdict:', noVerdict.length);
if (noVerdict.length) console.log('NO-VERDICT ids:', noVerdict.join(', '));
console.log('--- confirmed S0/S1 ---');
for (const f of confirmed.filter((c) => c.final_sev === 'S0' || c.final_sev === 'S1')) console.log(`[${f.final_sev}] ${f.id} (${f.dimension}) ${String(f.title).slice(0, 110)}`);
