# CCv3 System-Update Backlog — Execution Plan

> The ratified backlog from the Fable-5 deep review. **Work top-down, respect the gates.** Each item carries its finding IDs (trace to `docs/reviews/2026-06-10/findings.json`), the concrete action, and its dependency/gate. Severity legend: **S0** silent-corruption · **S1** wrong hot-path / exploitable / decision-driving false claim · **S2** measurable waste · **S3** polish.

Counts: **190 confirmed** (S0:3 ✅ · S1:41 · S2:108 · S3:38). Codex cross-model: 184 corroborated, 6 codex-only, 2 S1→S2 downgrades.

---

## ✅ Wave 0 — S0 Critical (SHIPPED)

| ID | Fix | Commit | Closes |
|----|-----|--------|--------|
| QW-01 | `store_learning.py` `execSync`(shell) → `spawnSync` argv (junk-creator + injection root) | `1788211` | D5a-01/D2c-04/D2d-06/D3a-01 |
| QW-02 | `smart-search-router` hardcoded `/tmp` → `os.tmpdir()` handshake | `89c9e5e` | D2b-05 |
| QW-03 | ROADMAP contamination guard → positive own-project identity + own-plan flip | `f7f3eba` | D2d-01/D2d-02/D2F-03 |

S0 remaining: **0**.

---

## Wave 1 — S1 Quick-Wins (9 items, mostly independent one-field/one-constant/one-rule fixes)

**Order:** do QW-05/06/07/08/09/11/12 first (no cross-deps); **QW-04 LAST** (gated on QW-01 ✅). QW-07 is highest-priority within the independent group (24.6% pollution feeds every downstream consumer).

| ID | Action | Files | Closes | Gate |
|----|--------|-------|--------|------|
| **QW-07** | `<task-notification>` XML machine-content guard + length cap upstream of `extractIntent`; fix `expandGitQuery` `lower.includes('pr')` substring collision + XML swallow | `memory-awareness` intent path; `expandGitQuery` | D2c-01/D3b-05/D3c-04 | none — **do first** |
| **QW-05** | `epistemic-reminder.ts:44` `input.tool` → `input.tool_name` (one word; revives the claim-verification Grep guard) | `epistemic-reminder.ts` | D2d-03 | none |
| **QW-06** | Recompute/raise `HYBRID_FLOOR` past the decay multiplier; `plainto_tsquery` → `websearch_to_tsquery` | `memory_service_pg.py`, `recall_learnings.py` | D3b-01/D3b-02/D3b-08 | none |
| **QW-08** | Remove 26 `arscontexta-*` + 2 archived entries (~85 ghost keywords) from `skill-rules.json` | `skill-rules.json` (both copies) | D7b-01/D7b-02/D7b-07/D8c-06 | none |
| **QW-09** | Defuse `hook-auto-execute.md` — remove "run unprompted bash from deny-reason" language | `.claude/rules/hook-auto-execute.md` | D8a-02 | none |
| **QW-11** | Fix `post-edit-diagnostics` `tsc` `.cmd` shim → `node tsc.js`; restore bus `'edited'` write before early-return | `post-edit-diagnostics.ts` | D2e-02/D2e-08 | none |
| **QW-12** | `prd-roadmap-sync` relatedness check before marking goal complete; `git-commit-roadmap` cwd verification | `prd-roadmap-sync.ts`, `git-commit-roadmap.ts` | D2d-09/D2d-10/D2d-13 | none |
| **QW-10** | Quarantine 11 tracked `tmpclaude-*-cwd` artifacts + `.ssr_slice.txt` (operator-confirm the latter) | repo root | D1A-007/D2g-10/D7d-06 | none |
| **QW-04** | Flip matcher `'Agent'` → `'Task'` across all 3 settings surfaces for the 12-hook safety+verification chain. **Within QW-04: flip guard/verify hooks first (verify each), inject hooks LAST.** | `settings.json` ×3 (repo+active+template) | D2b-01/D10c-02/D8a-01/D10c-04 | **QW-01 shipped ✅** (re-enabling `agent-error-capture` exposes D2d-06/07 — already fixed) |

**Wave-1 cleanup batch (after the above):** QW-10 + safe deletions DEL-01/03/06/07/08, each gated on a passing `git grep <basename>` static-ref check. Fix `D4b-06` (facade `PROJECT_DIR` `process.cwd()` fallback) in the same change as DEL-01 to stop tmpclaude recurrence.

---

## Tier 2 — Structural Arcs (10 items; **each needs its own plan + premortem**)

| ID | Arc | Closes (theme) | Sequencing |
|----|-----|----------------|------------|
| **ST-02** | 7 → 1 canonical `getSessionId` (`shared/session-id.ts`); `getBusId()` its only composer; delete 4 clones; fix the `shared/index.ts` barrel re-export | D7d-01 (corr-null 60.7%) | **prerequisite for ST-01 and SG-04** |
| **ST-01** | `SubagentStop` hook + bus symbol writer (commit `proposed_bus_updates`) | D1A-001/D10c-01 (write-dead bus) | after ST-02; **before SG-04** |
| **ST-05** | Resident recall daemon (kill the per-call uv-run boot tax) | D2b-03 (agent-recall 0-for-78 budget) | **prerequisite for ST-03 and ST-10** |
| **ST-03** | UserPromptSubmit 13-spawn serial → parallel (the 22–32s wall) | D6a-01 | after ST-05 |
| **ST-10** | Fix `agent-recall-injector` 0-for-78 lifetime yield (**DELICATE** — Hook Source Regression history; emit-guard + post-spark verify on every edit) | D2b-03 | after ST-05 |
| **ST-04** | codegraph facade latency 35–88s → budget (freshness-probe redesign + reindex budget) | D4b-01 | **before the C.5 deny-gate flip** |
| **ST-06** | Permission-layer redesign — remove `permission-auto-allow`'s "auto-approve ALL" | D2g-02/GAP3-01 | **before ST-08** (precondition for injection fixes to mean anything — Codex finding) |
| **ST-08** | argv-ify the remaining Grep-path shell-injection sites (`smart-search-router`, `daemon-client`) + the shared `storeLearning(content,opts)` helper | D2b-10/GAP4-01/GAP4-02 + D5a/D5b cluster | after ST-06 |
| **ST-07** | Memory sanitizer coverage 2 → 5 injectors (route all 5 through `injectRecall()`) | D5b-01 (poison-then-inject) | after ST-02; independent otherwise |
| **ST-09** | Bus lock + write-amplification hardening (200ms cap redesign) | D4a-02 | after ST-01 (new writer changes contention profile) |

**Dependency summary:** `ST-02 → ST-01 → SG-04` · `ST-05 → ST-03 + ST-10` · `ST-04 before C.5` · `ST-06 → ST-08`.

---

## Tier 3 — Strategic Programs (4 items)

| ID | Program | Depends on |
|----|---------|-----------|
| **SG-02** | 3-way settings/template drift reconciliation + source-of-truth enforcement (18 hooks live in active but absent from tracked repo, incl. `package-install-guard`, `permission-auto-allow`); extend `/sync-drift` with a drift gate; fix bootstrap template still registering the deregistered `navigator-safety` | can start **parallel with Wave 1** |
| **SG-01** | Memory recall floor + corpus-health SLO; re-baseline the 27.4% hit rate after the math fixes + daemon | after QW-06/QW-07 + ST-05 |
| **SG-03** | Elegance / pruning program — collapse the named duplication clusters; owns the operator-confirm deletion items | after Wave 1 hygiene stabilizes |
| **SG-04** | Telemetry joinability + intel-bus consumer (build `intel-bus-stats.mjs`, §9 metrics, WRRF weight recalibration from 30 days of `bus-wrrf.jsonl`); re-examine codex-lift ROI with accepted/rejected disposition tracking | after ST-02 + ST-01 (terminal tier) |

---

## Deletions (12 items — quarantine-first, per-item `git grep` static-ref check)

- **Safe batch (Wave 1 cleanup):** DEL-01 (`tmpclaude-*`), DEL-03 (`test-build.ts` console.log stub), DEL-06 (dead lib dupes), DEL-07 (`memory-client` triple-dead + python3 caller), DEL-08 (`handoff-index` + `better-sqlite3` build dep).
- **Higher-risk (two-step / config-first):** DEL-09 (`.claude/scripts/core` stale mirror — **remove from SYNC_DIRS first**, then `git rm`), DEL-05 (26 dead hook prototypes — **relocate 6 live-misfiled shared libs first**, then archive true-dead).
- **Operator-confirm (defer to SG-03):** DEL-02, DEL-11 (doc-coupled agents), DEL-12 (per-item-grep skills, incl. the 4 memory rule-stubs once the memory SKILL is confirmed to cover their content).

---

## The C.5 deny-flip gate (the substrate end-state milestone)

Flip `code-intel-enforcer` to **deny-mode** only when **all three** are green:
1. In-facade routing **≥80%** measured in `intel-bus.jsonl` (needs ST-04 latency fix + the `tldr-cli.md` instruction-surface patch + QW-04 reviving the spawn chain to raise facade invocations).
2. Enforcer switched default-OFF → warn-mode, **wrong matcher corrected**, telemetry flowing.
3. `intel-bus-stats.mjs` built and computing §9 metrics (real denominator, not zero).

Only then is the facade-bypass rate an enforced invariant.
