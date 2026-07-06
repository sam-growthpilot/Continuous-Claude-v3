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

**Iteration 1 RESULT (committed 69126b7):** GREEN. Shared lib (config/state/util) + ntn retry + verifyCardEmbed; publishedHash self-heal; sweep try/catch/finally telemetry + read-back-verified publish; state quarantine; dashboard 3 status bugs; assembler neutral-health + escaping. Tests: assemble 15 / sweep 11 / state 9 / dashboard self-test 11 — all green. Live-verified: real hardened sweep published+read-back-verified Connector Ecosystem (publishedHash==contentHash), rerun = 0-publish no-op. Reliability spine done.

## Iteration 2 — Usefulness + portfolio cockpit (2026-07-04)

Addresses the review's USEFULNESS + INNOVATION findings. Goal: make it answer "what needs my attention?" and be worth opening daily.
- FLAGSHIP: portfolio **cockpit** rollup card at the top of the Hub — health counts (G/Y/R), a prioritized attention list (Red/Yellow + decision-needed + stale + review-date-due, ordered), portfolio signal.
- Richer cards: wire the dead stats row; surface Review Date; staleness signal; Decision text + Impact; health-over-time sparkline (new history store).
- Hub gallery: attention column + attention-first ordering.
- Self-monitoring: surface the iter1 heartbeat as a staleness signal.
Build via sequenced workflow (history lib → parallel assembler/cockpit/refresh/sweep on disjoint files → tests).

**Iteration 2 RESULT:** GREEN + deployed live. Shared lib/history.mjs + lib/attention.mjs (single attention source). Portfolio COCKPIT (cockpit.mjs) live at the top of the Hub under "🎯 Portfolio Cockpit" — health counts + prioritized "needs your attention" list + sweep-health line. Richer cards: real stats row, Review Date tile, staleness Watch, Decision/Finding text, inline-SVG health sparkline + trend. Hub gallery now attention-ordered with an Attention column (width 5). Health history seeded (logs/health-history.jsonl). Tests: assemble 21 / cockpit 10 / sweep 11 / state 9 / history 8 — all green. Live-verified: real sweep published+verified the card, appended 6 history points, published the cockpit embed (at hub top), reordered the hub. Fixed a real bug found during deploy: verifyCardEmbed was hardcoded to the card heading so the cockpit read-back false-negatived — parameterized the section heading; confirmed verifyCardEmbed(hub, cockpit-heading)=true on the live page.

Note: the interactive test run was killed at ~7min by MY Bash timeout (3 sequential claude -p calls); the scheduled task's 30min limit covers it. Iteration-3 candidate: make the hub-table refresh deterministic ntn (no claude -p) to drop 1 of the 3 publish calls.

**Iteration 3 (hardening, commit 0cfa52f):** cockpit read-back section fix (verifyCardEmbed now takes a heading; landed with iter2) + global sweep time budget (cockpit+hub+telemetry always complete; deferred cards self-heal).

## CONVERGENCE (2026-07-04)

The system is RELIABLE and USEFUL, with production-path evidence.

**Reliability — proven via the real CCv3-Project-Cards scheduled task (LastTaskResult=0, clean telemetry cockpitPublished:true/hubRefreshed:true, cockpit read-back verified=true):**
- Self-heals: a failed/unverified publish re-flags next sweep (publishedHash ≠ contentHash), never strands stale content.
- Read-back verified: card AND cockpit publishes confirmed by reading the embed back, not by trusting an LLM stdout marker.
- Telemetry on every run incl. crashes (try/catch/finally always emits a structured sweep.jsonl row with phase+error).
- Corruption-tolerant state (quarantine + fresh start), transient ntn retry, global time budget.
- 59 tests green (assemble 21 / cockpit 10 / sweep 11 / state 9 / history 8) + dashboard self-test 11.

**Useful:**
- Portfolio Cockpit at the top of the Reporting Hub answers "what needs my attention?" (health counts + prioritized attention list + sweep-health line).
- Richer cards: real stats, review-date countdown, staleness, decision text, health sparkline + trend.
- Attention-ordered hub gallery with an Attention column. Health history accumulating for trends.

**Deliberately deferred (do with Dave present — risk/ROI):**
1. Deterministic ntn hub-TABLE refresh (drop 1 of 3 claude -p; block-surgery on the shared hub — pattern proven in DashboardSync.psm1).
2. Cockpit hash-skip (it republishes every sweep; add a content-hash no-op like cards).
3. Bidirectional "decisions awaiting Dave" push; state RMW lock for concurrent manual+sweep.

Loop stopped at convergence: mandate (reliable + useful) met with live evidence; remaining items are incremental or carry shared-page block-surgery risk better done attended.
