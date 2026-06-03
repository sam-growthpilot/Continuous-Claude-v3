#!/usr/bin/env node
/**
 * WS-2 Phase B.3 quality gate (#12) -- recall WITHOUT bus-bias vs WITH bus-bias.
 *
 * Mirrors the production read path (memory-awareness / agent-recall-injector):
 * calls recall_learnings.py --json --text-only with the BARE intent (baseline)
 * vs intent + session focus terms (biased), exactly as the B.3 hooks build
 * `recallQuery = intent + ' ' + focusTerms.join(' ')`. Reports mean top-score,
 * hit-rate, and latency, then a rollback verdict against plan section-8 thresholds.
 *
 * Run: node scripts/bus-quality-gate.mjs   (needs CLAUDE_OPC_DIR + the memory DB)
 *
 * NOTE: text-only mode (floor 0.05) is the deterministic, daemon-free gate. A
 * hybrid (vector+FTS, floor 0.01) run is a follow-up if the daemon is warmed.
 */
import { spawnSync } from 'node:child_process';

const OPC = process.env.CLAUDE_OPC_DIR;
if (!OPC) {
  console.error('CLAUDE_OPC_DIR is unset -- cannot locate recall_learnings.py');
  process.exit(2);
}
const MODE = process.argv[2] === 'hybrid' ? 'hybrid' : 'text-only';
const FLOOR = MODE === 'hybrid' ? 0.01 : 0.05; // HYBRID_FLOOR vs TEXT_ONLY_FLOOR

// Representative (intent, focus) cases. The focus terms model a real session
// working set (symbol names + file basenames), mostly RELATED to the intent (as
// in production) with a couple of tangential sets to probe dilution risk.
const CASES = [
  { intent: 'fix the context bus write path drop handling', focus: ['context-bus', 'mutateViaLock', 'atomic-write'] },
  { intent: 'redact secrets in telemetry before they reach disk', focus: ['intel-bus', 'redactSecretsDeep', 'appendIntelBus'] },
  { intent: 'bias memory recall with the session working set', focus: ['bus-focus', 'extractBusFocus', 'memory-awareness'] },
  { intent: 'agent recall injector should read the context bus', focus: ['agent-recall-injector', 'handleAgentTask', 'readBus'] },
  { intent: 'emit braintrust score reachability invariant', focus: ['memory-awareness', 'emitBraintrustScore'] },
  { intent: 'knowledge tree regeneration unicode crash on windows', focus: ['knowledge_tree', 'tree_schema'] },
  { intent: 'ralph state checkpoint and scheduler', focus: ['ralph-state', 'ralph-checkpoint', 'ralph-scheduler'] },
  { intent: 'codex adversary cross model review setup', focus: ['codex-adversary', 'review'] },
];

function recall(query) {
  const t0 = Date.now();
  const args = ['run', 'python', 'scripts/core/recall_learnings.py', '--query', query, '--k', '5', '--json'];
  if (MODE === 'text-only') args.push('--text-only');
  const res = spawnSync('uv', args, { cwd: OPC, env: { ...process.env, PYTHONPATH: OPC }, encoding: 'utf-8', timeout: 90000 });
  const ms = Date.now() - t0;
  if (res.status !== 0 || !res.stdout) return { top: 0, hits: 0, ms, ok: false };
  let data;
  try { data = JSON.parse(res.stdout); } catch { return { top: 0, hits: 0, ms, ok: false }; }
  const results = Array.isArray(data?.results) ? data.results : [];
  const scores = results.map((r) => r.score ?? r.final_score ?? 0);
  const top = scores.length ? Math.max(...scores) : 0;
  const hits = scores.filter((s) => s >= FLOOR).length;
  return { top, hits, ms, ok: true };
}

const rows = [];
for (const c of CASES) {
  const base = recall(c.intent);
  const biased = recall(`${c.intent} ${c.focus.join(' ')}`);
  rows.push({ intent: c.intent, base, biased });
}

const n = rows.length;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const baseTop = mean(rows.map((r) => r.base.top));
const biasedTop = mean(rows.map((r) => r.biased.top));
const baseHit = mean(rows.map((r) => (r.base.hits > 0 ? 1 : 0)));
const biasedHit = mean(rows.map((r) => (r.biased.hits > 0 ? 1 : 0)));
const baseMs = mean(rows.map((r) => r.base.ms));
const biasedMs = mean(rows.map((r) => r.biased.ms));
const topDeltaPct = baseTop > 0 ? ((biasedTop - baseTop) / baseTop) * 100 : 0;

console.log(`\nWS-2 B.3 QUALITY GATE -- recall WITHOUT vs WITH bus-bias (${MODE}, floor=${FLOOR})\n`);
console.log('intent'.padEnd(52) + 'base_top  bias_top  b_hit  x_hit');
for (const r of rows) {
  console.log(
    r.intent.slice(0, 50).padEnd(52) +
      r.base.top.toFixed(4).padStart(8) + '  ' +
      r.biased.top.toFixed(4).padStart(8) + '  ' +
      String(r.base.hits).padStart(5) + '  ' +
      String(r.biased.hits).padStart(5),
  );
}
console.log(`\n--- AGGREGATE (n=${n}) ---`);
console.log(`mean top-score : base ${baseTop.toFixed(4)} -> biased ${biasedTop.toFixed(4)} (${topDeltaPct >= 0 ? '+' : ''}${topDeltaPct.toFixed(1)}%)`);
console.log(`hit-rate       : base ${(baseHit * 100).toFixed(0)}% -> biased ${(biasedHit * 100).toFixed(0)}%`);
console.log(`mean latency   : base ${baseMs.toFixed(0)}ms -> biased ${biasedMs.toFixed(0)}ms`);

const fails = [];
if (biasedHit < baseHit) fails.push(`hit-rate dropped (${(baseHit * 100).toFixed(0)}% -> ${(biasedHit * 100).toFixed(0)}%)`);
if (topDeltaPct < -10) fails.push(`mean top-score regressed >10% (${topDeltaPct.toFixed(1)}%)`);
console.log('\n--- ROLLBACK VERDICT (plan section 8) ---');
if (fails.length) console.log('ROLL BACK -- ' + fails.join('; '));
else console.log('KEEP ENABLED -- no rollback threshold tripped (hit-rate held; top-score within -10%).');
