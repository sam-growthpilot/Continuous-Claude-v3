#!/usr/bin/env node
// WF-0 deterministic harvest for the CCv3 Fable-5 deep review (2026-06-10).
// Read-only over repo + active mirror + telemetry snapshots; writes ONLY under docs/reviews/2026-06-10/harvest/.
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';

const REPO = 'C:/Users/david.hayes/continuous-claude';
const ACTIVE = join(homedir(), '.claude');
const HARVEST = join(REPO, 'docs/reviews/2026-06-10/harvest');
const SNAP = join(HARVEST, 'snapshot');
mkdirSync(SNAP, { recursive: true });

const out = {};
const write = (name, data) => writeFileSync(join(HARVEST, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));

// --- 0. Freeze SHA -----------------------------------------------------------
const sha = execSync('git rev-parse HEAD', { cwd: REPO, encoding: 'utf8' }).trim();
write('review-sha.txt', sha + '\n');

// --- 1. Raw-log snapshot (self-pollution guard: tables derive ONLY from these) -
const LOGS = ['memory-recall.jsonl', 'intel-bus.jsonl', 'agent-recall.jsonl', 'codex-lift.jsonl', 'pageindex-nav.jsonl'];
for (const f of LOGS) {
  const src = join(REPO, '.claude/logs', f);
  if (existsSync(src)) copyFileSync(src, join(SNAP, f));
}

const lines = (f) => {
  const p = join(SNAP, f);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};

// --- 2. Inventories ----------------------------------------------------------
const hooksSrc = readdirSync(join(REPO, '.claude/hooks/src')).filter((f) => f.endsWith('.ts'));
const hooksDist = readdirSync(join(REPO, '.claude/hooks/dist')).filter((f) => f.endsWith('.mjs'));
const skills = readdirSync(join(REPO, '.claude/skills'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name);
const agents = readdirSync(join(REPO, '.claude/agents')).filter((f) => f.endsWith('.md'));
const rules = readdirSync(join(REPO, '.claude/rules')).filter((f) => f.endsWith('.md'));
out.inventory = { hooks_src: hooksSrc.length, hooks_dist: hooksDist.length, skills: skills.length, agents: agents.length, rules: rules.length };
write('inventory-hooks.json', hooksSrc);
write('inventory-skills.json', skills);
write('inventory-agents.json', agents);
write('inventory-rules.json', rules);

// --- 3. Registration diff sets (ACTIVE settings.json = runtime truth) ---------
const regCmds = (p) => {
  const s = JSON.parse(readFileSync(p, 'utf8'));
  const rows = [];
  for (const [ev, arr] of Object.entries(s.hooks || {})) for (const m of arr || []) for (const h of m.hooks || []) rows.push({ event: ev, matcher: m.matcher || '*', command: h.command || '' });
  return rows;
};
const activeRegs = regCmds(join(ACTIVE, 'settings.json'));
const repoRegs = regCmds(join(REPO, '.claude/settings.json'));
const mjsOf = (c) => { const m = c.match(/([\w.-]+)\.mjs/); return m ? m[1] : null; };
const activeMjs = new Set(activeRegs.map((r) => mjsOf(r.command)).filter(Boolean));
const repoMjs = new Set(repoRegs.map((r) => mjsOf(r.command)).filter(Boolean));
const srcBase = new Set(hooksSrc.map((f) => f.replace(/\.ts$/, '')));
out.registrations = {
  active_total: activeRegs.length, repo_total: repoRegs.length,
  active_unique_hooks: activeMjs.size, repo_unique_hooks: repoMjs.size,
  registered_active_but_no_src: [...activeMjs].filter((h) => !srcBase.has(h)),
  src_but_never_registered_active: [...srcBase].filter((h) => !activeMjs.has(h)),
  active_only_vs_repo: [...activeMjs].filter((h) => !repoMjs.has(h)),
  repo_only_vs_active: [...repoMjs].filter((h) => !activeMjs.has(h)),
};
write('registrations-active.json', activeRegs);
write('registrations-diff.json', out.registrations);

// --- 4. Telemetry tables (filtered + unfiltered) -------------------------------
const isTestSession = (s) => typeof s === 'string' && /^(test-|loadtest-)/.test(s);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

// memory-recall
const mr = lines('memory-recall.jsonl');
const mrTable = (rows) => {
  const polluted = rows.filter((r) => /<task-notification>|<system-reminder>|<context |<\/antml/.test(r.intent || ''));
  const kept = rows.filter((r) => (r.kept_after_floor ?? 0) > 0);
  const scores = rows.map((r) => r.top_score ?? 0).sort((a, b) => a - b);
  const q = (f) => scores.length ? scores[Math.min(scores.length - 1, Math.floor(f * scores.length))] : 0;
  const bySource = {}; rows.forEach((r) => { bySource[r.source || 'unknown'] = (bySource[r.source || 'unknown'] || 0) + 1; });
  const bySub = {}; rows.forEach((r) => { const k = r.subagent || 'main'; bySub[k] = (bySub[k] || 0) + 1; });
  return { rows: rows.length, hit_rate_pct: pct(kept.length, rows.length), intent_pollution_pct: pct(polluted.length, rows.length), polluted_count: polluted.length, top_score_p25: q(0.25), top_score_p50: q(0.5), top_score_p75: q(0.75), by_source: bySource, by_subagent_top: Object.fromEntries(Object.entries(bySub).sort((a, b) => b[1] - a[1]).slice(0, 12)) };
};
out.memory_recall = { unfiltered: mrTable(mr), filtered: mrTable(mr.filter((r) => !isTestSession(r.session_id))) };
write('table-memory-recall.json', out.memory_recall);

// intel-bus
const ib = lines('intel-bus.jsonl');
const ibTable = (rows) => {
  const bySpec = {}, byQt = {}, byAgent = {};
  rows.forEach((r) => { bySpec[r.specialist || 'null'] = (bySpec[r.specialist || 'null'] || 0) + 1; byQt[r.query_type || 'null'] = (byQt[r.query_type || 'null'] || 0) + 1; byAgent[r.agent || 'null'] = (byAgent[r.agent || 'null'] || 0) + 1; });
  const corrNull = rows.filter((r) => !r.correlation_id).length;
  const days = new Set(rows.map((r) => (r.ts || '').slice(0, 10)));
  return { rows: rows.length, distinct_days: days.size, by_specialist: bySpec, by_query_type_top: Object.fromEntries(Object.entries(byQt).sort((a, b) => b[1] - a[1]).slice(0, 12)), by_agent: byAgent, correlation_null_pct: pct(corrNull, rows.length), codegraph_rows: rows.filter((r) => /codegraph/.test(r.specialist || '')).length };
};
out.intel_bus = { unfiltered: ibTable(ib), live_only: ibTable(ib.filter((r) => !r.backfilled && !/^backfill-/.test(r.bus_id || ''))) };
write('table-intel-bus.json', out.intel_bus);

// agent-recall
const ar = lines('agent-recall.jsonl');
const arBySub = {}; ar.forEach((r) => { const k = r.subagent_type || r.subagent || 'unknown'; arBySub[k] = (arBySub[k] || 0) + 1; });
const agentNames = agents.map((a) => a.replace(/\.md$/, ''));
out.agent_recall = { rows: ar.length, by_subagent: Object.fromEntries(Object.entries(arBySub).sort((a, b) => b[1] - a[1])), agents_never_appearing: agentNames.filter((a) => !(a in arBySub)) };
write('table-agent-recall.json', out.agent_recall);

// codex-lift + pageindex
const cl = lines('codex-lift.jsonl');
out.codex_lift = { rows: cl.length, total_claude_only: cl.reduce((a, r) => a + (r.claude_only || 0), 0), total_codex_only: cl.reduce((a, r) => a + (r.codex_only || 0), 0), total_both: cl.reduce((a, r) => a + (r.both || 0), 0) };
const pi = lines('pageindex-nav.jsonl');
out.pageindex = { rows: pi.length, note: pi.length < 20 ? 'pillar near-unused since per-prompt hook disabled 2026-06-01' : '' };
write('table-codex-pageindex.json', { codex_lift: out.codex_lift, pageindex: out.pageindex });

// --- 5. Exclusion manifest + seeds --------------------------------------------
write('exclusion-manifest.json', {
  excluded_paths: ['.codex/', 'node_modules/', '.claude/hooks/dist/', '.claude/skills/_snapshots/', '.claude/skills/_archived/', '.claude/agents/_archived/', '.claude/hooks/archive/', 'opc/archive/', 'docs/reviews/'],
  rule: 'Findings citing these paths are auto-KILLED by refuters. Review src, never dist. The review dir itself is not a review target.',
});
write('seeded-findings.json', [
  { id: 'SEED-01', title: 'junk-creator: daily ~07:24 process invokes store_learning.py with unquoted shell metachars (5 artifacts to date)', severity: 'S0', lead: 'identical creation minute on consecutive days (06-06 07:24:49, 06-07 07:24:23) -> scheduled/logon task, NOT interactive. Check Task Scheduler + logon-time hooks.' },
  { id: 'SEED-02', title: 'post-plan-roadmap cross-project contamination guard miss (foreign Salesforce goal written to ROADMAP 2026-06-06)', severity: 'S0' },
  { id: 'SEED-03', title: 'dev-dep vulns in .claude/hooks (vitest UI critical, vite/rollup high) - pre-existing, NOT codegraph', severity: 'S2' },
  { id: 'SEED-04', title: 'full parallel vitest run hangs on Windows daemon/socket suite', severity: 'S2' },
  { id: 'SEED-05', title: '~4 pre-existing failing test files + 1 worker crash', severity: 'S2' },
  { id: 'SEED-06', title: 'stray scripts/.claude/logs artifact from facade test nested-cwd (quarantined)', severity: 'S3' },
  { id: 'SEED-07', title: 'doubled continuous-claude/continuous-claude/.ralph/ path from relative -p arg', severity: 'S3' },
  { id: 'SEED-08', title: 'warm hybrid recall latency 13-17s dominated by uv-run startup', severity: 'S2' },
  { id: 'SEED-09', title: 'codegraph 3-4s/call Node+WASM startup tax (amortized by freshness cache)', severity: 'S3' },
  { id: 'SEED-10', title: 'C.3 4-week telemetry watch deferred (not started)', severity: 'S2' },
  { id: 'SEED-11', title: 'RULES.md enforcement-claim mismatch (P-docs, unspecified)', severity: 'S3' },
  { id: 'SEED-12', title: 'WS-0.1 session-id consolidation deferred (G5: needs file_claims migration; 2 competing getSessionId schemes live)', severity: 'S2' },
  { id: 'SEED-13', title: 'recall-intent pollution: <task-notification> XML blobs used as recall intents', severity: 'S1' },
  { id: 'SEED-14', title: 'hook catalog (155 lines) covers fraction of 120 hooks - doc drift', severity: 'S2' },
  { id: 'SEED-15', title: 'settings.json template gap: 18 active-only registrations incl package-install-guard; 1 repo-only (periodic-extract). New machine from template lacks the supply-chain guard', severity: 'S1' },
  { id: 'SEED-16', title: 'store_learning Braintrust emit is a synchronous bounded(2s) HTTP call in the store hot path (CodeRabbit PR#9; candidate fire-and-forget)', severity: 'S2' },
]);

// --- 6. Summary ---------------------------------------------------------------
write('SUMMARY.md', `# WF-0 Harvest Summary (review SHA ${sha.slice(0, 12)})\n\n` +
  `Inventory: ${out.inventory.hooks_src} hook srcs / ${out.inventory.hooks_dist} dists / ${out.inventory.skills} skills / ${out.inventory.agents} agents / ${out.inventory.rules} rules\n` +
  `Registrations (ACTIVE=runtime truth): ${out.registrations.active_total} entries -> ${out.registrations.active_unique_hooks} unique hooks; ` +
  `registered-but-no-src: ${out.registrations.registered_active_but_no_src.length}; src-never-registered: ${out.registrations.src_but_never_registered_active.length}\n` +
  `memory-recall: ${out.memory_recall.unfiltered.rows} rows, hit ${out.memory_recall.unfiltered.hit_rate_pct}%, INTENT POLLUTION ${out.memory_recall.unfiltered.intent_pollution_pct}%\n` +
  `intel-bus: ${out.intel_bus.unfiltered.rows} rows (${out.intel_bus.live_only.rows} live), codegraph rows: ${out.intel_bus.live_only.codegraph_rows}, corr-null ${out.intel_bus.live_only.correlation_null_pct}%\n` +
  `agent-recall: ${out.agent_recall.rows} rows; agents never appearing: ${out.agent_recall.agents_never_appearing.length}/${agentNames.length}\n` +
  `codex-lift: claude_only ${out.codex_lift.total_claude_only} / codex_only ${out.codex_lift.total_codex_only} / both ${out.codex_lift.total_both}\n` +
  `pageindex-nav: ${out.pageindex.rows} rows ${out.pageindex.note}\n`);
console.log(readFileSync(join(HARVEST, 'SUMMARY.md'), 'utf8'));
