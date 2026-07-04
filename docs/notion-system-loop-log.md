# Notion System — Autonomous Improvement Loop

**Goal (north star):** a reliable, self-maintaining Notion "operating picture" for the CCv3/FourthOS portfolio — every project has a living, data-rich status card; a portfolio rollup answers "what needs my attention?" at a glance; the system self-heals (monitors its own sweep, surfaces failures), is idempotent + reversible, and is genuinely useful day-to-day.

**Mode:** autonomous loop (Dave away) — review → design → deploy → verify, iterating until reliable + useful. All work on `feature/notion-platform`, reversible, tested before live writes.

**Baseline (start of loop, 2026-07-03):**
- Card engine (`scripts/project-cards/`): assembler + refresh + sweep + hub gallery; 23 tests; 1 live card (Connector Ecosystem), daily `CCv3-Project-Cards` task 07:45.
- Deterministic dashboard sync (preview-verified, not cut over).
- notion-bridge v1.6 (drift resolved), notion-cli skill/rule.
- Commits: dee1e6b, 40d4f88, cb571ed. PR #14.

---

## Iteration log

_(appended per iteration below)_

## Iteration 1 — Review + Reliability foundation (2026-07-03)

**Review:** 5-lens workflow (20 agents, adversarial-verified). 15 confirmed high/critical + 8 innovation ideas.

Top confirmed defects:
- REL#1 (high/S): self-heal broken — contentHash advances at refresh before publish; a failed publish strands stale content forever. Fix: separate `publishedHash` set only on confirmed publish.
- REL#2 (high/S): sweep has no try/catch; JSONL telemetry written last → failures emit nothing. Fix: try/catch/finally always-emit with phase/error.
- REL#3 (high/S): unguarded state.json parse wedges engine. Fix: guard + quarantine + rebuild-from-empty.
- REL#4 (high/M): no heartbeat/staleness detector.
- ARCH: publish success trusted from LLM stdout marker, no read-back verify; hardcoded IDs across 4+ files; no tests on the two riskiest surfaces.
- CORR (high/S x3): refused-launch false RED; stale hex after recovery; empty-Health→GREEN.
- USE (high): dead stats row; Review Date dropped; hub can't answer "what needs attention?".
- INNOV: portfolio cockpit rollup; sweep self-monitoring; staleness Watch; health sparkline; embed liveness probe; bidirectional decisions.

**Iteration 1 build (this pass): reliability + correctness foundation** — shared config/state/util lib + ntn retry; publishedHash self-heal; sweep error-handling + telemetry + heartbeat + publish read-back verification; state guard/quarantine; dashboard status-bug fixes; assembler correctness (health default, escaping); tests. Usefulness redesign + cockpit → iteration 2.
