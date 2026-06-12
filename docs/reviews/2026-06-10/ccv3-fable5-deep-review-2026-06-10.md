# CCv3 Fable-5 Deep Review — "Hone to Elegance"

**Date:** 2026-06-10 → 2026-06-12 · **Frozen review SHA:** `86b8f60` (post-merge main; PRs #8/#9/#10) · **Model:** Fable 5 (ultracode), cross-model Codex (gpt-5.5 @ xhigh)
**Scope:** whole-system, recent-weighted — the 145 commits since the 2026-05-16 memory-upgrade era · **Method:** parallel discovery → adversarial verification → synthesis → cross-model pass.

---

## 1. Executive Verdict — `mixed` (elegant spine, baroque periphery)

CCv3's **core substrate is genuinely sound** — adversarial verification (WF-1 D5b) cleared the SQL layer, secret handling, path-traversal defenses, and the L3 code-intel boundary/bus *design* as well-built. But the **enforcement and intelligence periphery is largely dead or mis-wired** — the signature of accreted growth, not elegance. The hard numbers: of **111 hook sources only 76 register (35 never fire)**; **30 of 36 agents never appear in recall**; memory recall sits at a **27.4% hit rate**; **24.6% of recall queries are synthetic-prompt pollution**; the context bus symbol layer is **write-dead**; and the entire agent safety+verification chain is registered on a matcher (`Agent`) the live tool (`Task`) never matches.

The good news: the defects cluster tightly around a handful of root causes, and most are cheap to fix. **The 5 that matter for an "elegantly working" system:**

| # | Finding | Why it's the keystone |
|---|---------|----------------------|
| **D5a-01** (S0) | **junk-creator NAMED** — `agent-error-capture.ts` shells un-sanitized agent text into `store_learning.py` | Root of SEED-01; produces silent on-disk corruption (the 4 junk artifacts, regenerating daily ~07:24). The poison end of the poison-then-inject chain. |
| **D2d-01** (S0) | **ROADMAP contamination** — guard is a negative allowlist of *registered* siblings, blind to foreign projects | Root of SEED-02 (the Session-9 Salesforce-goal clobber). Cross-project data corruption. |
| **D2c-01** (S1) | **intent pollution** — no UserPromptSubmit filter for synthetic `<task-notification>` prompts | Single upstream chokepoint feeding 24.6% garbage into *every* recall/bus consumer. |
| **D9-01** (S1) | **recall floor diagnosis** — 27.4% hit decomposed; the HYBRID_FLOOR math is a bigger lever than pollution | The keystone that sequences the entire memory-quality cluster. |
| **D6a-01** (S1) | **prompt hot-path** — UserPromptSubmit serializes 13 process spawns (~22-32s before any answer) | The dominant user-perceived latency tax on the hottest path. |

**Disposition:** quick-wins execute this arc (Phase 4 via /ralph); structural refactors are separately-planned arcs with their own premortems; the report is not the deliverable — the **ratified backlog** is.

---

## 2. Confirmed Ledger — severity × leverage

**248 WF-1 findings → adversarially verified → 190 CONFIRM · 48 DOWNGRADE · 10 KILL · 0 no-verdict.** Every CONFIRM carries reachability evidence; every quote content-matched at SHA `86b8f60`; 3 random CONFIRMs hand-verified verbatim.

| Confirmed severity | Count | | Confirmed leverage | Count |
|---|---|---|---|---|
| **S0** silent-corruption/contamination | **3** | | quick-win (≤1 session) | 98 |
| **S1** wrong-hot-path / injection / false-claim | **43** | | structural (needs design) | 83 |
| **S2** measurable waste | **106** | | strategic (roadmap-level) | 9 |
| **S3** polish | **38** | | | |

**Post-WF2 adjustments (Codex cross-model pass 1):** `D2e-02` S1→**S2** (post-edit-diagnostics tsc no-op is advisory-only, not decision-driving) · `D3c-03` S1→**S2** (`'pr'` substring git-expansion is a recall-precision leak, not a blocking false claim). Net confirmed S1 = 41 after Codex.

**KILLS (10):** refuted on merits — `D2b-04`, `D7c-01`; immaterial (ops-realist) — `D2e-14`, `D4a-07`, `D6a-09`, `D7a-05`; excluded paths — `D9-02`, `GAP2-01/02/03`. **DOWNGRADES (48):** the cross-model rigor working as intended — e.g. `D10b-01/02` S1→S2 (dist-staleness / unlocked sync are documented-accepted + loud-failure, not silent corruption). Full per-finding records: `wf2/WF2-VERDICTS.json`.

---

## 3. Eleven Thematic Clusters (root-cause grouping)

1. **Shell-string injection into `store_learning.py`** (the junk-creator + the proven cross-model-blind class) — `D5a-01, D2c-04, D3a-01, D2d-06, D2g-05, D3a-05` · SEED-01. Multiple hooks build the command by interpolating untrusted text; sh-style escaping is wrong on every platform (`execSync` always shells).
2. **Grep-pattern shell injection in the search-router path** — `D2b-05, D2b-10, GAP4-01, GAP4-02, D2b-06, D8a-02`. `smart-search-router` + `daemon-client` feed the model-controlled raw Grep pattern into `execSync` on every Grep when the TLDR daemon is down.
3. **Matcher split-brain (`Agent` vs live `Task`)** — `D2b-01, D10c-02, D8a-01, D10c-03, D2a-07, D10c-04, D2b-08`. The entire spawn pre-hook chain (explore-to-scout, agent-model-guard, maestro-enforcer) + post-spawn verifiers never fire.
4. **Write-dead context bus / unwired SubagentStop** — `D10c-01, D1A-001, D1b-03, D4a-03, D4b-03, D1A-002/005`. codegraph's facade produces `proposed_bus_updates` with **no committer** (SubagentStop has zero registrations); the boundary rule + facade comment falsely assert the writer exists.
5. **ROADMAP cross-project contamination + unguarded post-commit race** — `D2d-01/02/09/10, D2F-03, D2d-13, D10b-04/05/06` · SEED-02.
6. **Memory recall floor + intent pollution (the 27.4% failure)** — `D9-01, D2c-01, D3b-01/02/05, D3c-04, D2b-03, D3c-03, …`. Two co-dominant causes: pollution (no synthetic-prompt filter) and floor math (HYBRID_FLOOR on decay-multiplied RRF + plainto_tsquery AND-semantics → FTS arm ~always empty).
7. **UserPromptSubmit / SessionStart hot-path latency** — `D6a-01, D6b-01/02, D3b-04, …` · SEED-08. 13 serial spawns; uv cold-start tax dominates.
8. **Settings drift (active-only vs repo/template)** — `GAP3-03, GAP1-01, D2a-02, D2g-02, GAP3-01, …` · SEED-15. 18 live registrations absent from tracked repo settings — a new-machine safety gap.
9. **Dead weight (committed junk, orphan hooks/skills/agents, duplicated libs)** — `D7d-*, D7b-*, D7c-*, D2g-06..10, D1A-007`. 35/111 hook srcs never register.
10. **Permission / plan-mode safety inversions** — `D2a-01, D2g-02, GAP3-01, D2a-05/06, D2a-02`.
11. **Codegraph facade latency + unmeasurable telemetry (adoption-gate risk)** — `D4b-01, D1b-04/05/06, D9-03` · SEED-09/10. Live queries 16-88s (median ~62s, 10× the documented 3-4s); `ensureFresh` spawns one full process per dirty file with no cap.

---

## 4. Elegance-Gap Analysis

**Verdict: `mixed`** — a clean spine wrapped in dead/mis-wired periphery.

**Duplication clusters (8):** the **7 `getSessionId` implementations** (4 distinct fallback semantics — consolidate to one canonical impl); the **`.claude/scripts/core/` 30-entry frozen mirror** of `opc/scripts` (with `recall_learnings.py` in 3 divergent versions); multiple sync scripts; 4 dead lib duplicates in `hooks/src/lib/`; the `frontend-*`/`fourth-*` skill families; redundant test/review/build skills.

**Dead weight (7, utilization-weighted):** 35 never-registered hook srcs (~26 truly dead prototypes); 30/36 agents never-recalled; 28 ghost skill registrations (26 `arscontexta-*` from a removed plugin); near-dead PageIndex (16 rows); triple-dead `memory-client.ts` + sole consumer; `handoff-index` (the build's only `better-sqlite3` dependency + `--external` flag).

**Leaking seams (6):** poison-then-inject memory chain (store-side injectors D5a → unsanitized recall injectors D5b); write-dead bus → permanently-starved `bus-focus.ts` reader (existing degradation, not just a future gap — *Codex*); matcher split-brain → whole safety chain dead while the *code* looks correct (*Codex*); permission-auto-allow → removes the user's last DENY gate on top of every injection vector (*Codex*).

---

## 5. Ratified Backlog (3-tier)

### Tier 1 — Quick wins (12; the Phase-4 /ralph batch)
| ID | Sev | Action | Verify |
|----|-----|--------|--------|
| **QW-01** D5a-01/D2c-04/D2d-06/D3a-01 | S0 | **Argv-ify all `store_learning.py` shell-outs** — `execSync`/string-concat → `spawnSync(argv, {shell:false})` across **all 3** hooks (agent-error-capture, user-confirmation-detector [explicit `shell:true`], hook-error-pipeline) in one PR (*Codex: execSync always shells — fix the call shape, not the escaping*) | run each with crafted error text (`& \| < > ^ %`); no junk file; stored row intact |
| **QW-02** D2b-05 | S0 | smart-search-router: `/tmp/claude-search-context` → `os.tmpdir()` | grep `/tmp/` in hooks/src = 0; handshake lands in OS temp |
| **QW-03** D2d-01/D2d-02/D2F-03 | S0 | ROADMAP contamination: positive project-identity allowlist + own-plan selection. *Codex: ship a stopword quick-win (`claude`,`continuous`,`code`,`anthropic` + word-boundary) FIRST, then the structural rewrite* | reproduce Session-9 foreign-goal write → blocked |
| **QW-04** D2b-01/D10c-02/D8a-01/D10c-04 | S1 | Matcher split-brain `Agent`→`Task` on spawn hooks (3 surfaces: repo+active+template). *Codex: run a live-telemetry pre-flight (zero historical `Agent`-matcher fires) BEFORE flipping, so the edit can't kill live behavior* | spawn a subagent → maestro-enforcer/agent-model-guard fire |
| **QW-05** D2d-03 | S1 | epistemic-reminder `input.tool`→`input.tool_name`. *Codex: also fix the output schema — `hookEventName` body field isn't a recognized injector key; two-layer dead* | Grep PostToolUse payload → epistemic warning injected |
| **QW-06** D3b-01/D3b-02/D3b-08 | S1 | Recall floor + FTS arm: raise HYBRID_FLOOR (one-line), `plainto_tsquery`→`websearch_to_tsquery`. *Codex: HYBRID_FLOOR is structural-impact but a one-line quick-win* | recall a known-stored learning currently excluded → returns |
| **QW-07** D2c-01/D3b-05/D3c-04/… | S1 | Intent-pollution filter: UserPromptSubmit-side synthetic-prompt drop + machine-content/length guard | feed `<task-notification>` → no recall row logged |
| **QW-08** D7b-01/D7b-02/… | S1 | Ghost skill-registration cleanup (28 dead `arscontexta-*`/archived entries) | grep `arscontexta-` in skill-rules.json = 0 |
| **QW-09** D8a-02 | S1 | Defuse `hook-auto-execute.md` auto-run guardrail (stop instructing Claude to run unprompted bash from deny reasons) | rule has no 'execute that command without asking' |
| **QW-10** D2e-02/D2e-08 | S1→S2 | post-edit-diagnostics: resolve `tsc` `.cmd` shim on Windows + restore bus 'edited' write | edit a .ts with a type error → diagnostics reports it |
| **QW-11** D2d-09/D2d-10/D2d-13 | S1 | ROADMAP write-guard: own-project containment on commit/PRD sync | unrelated checked tasks file → current goal NOT marked complete |
| **QW-12** D1A-007/.ssr_slice/tmpclaude | S2 | Stray-artifact quarantine (untracked `.ssr_slice.txt` + tracked `tmpclaude-*` junk) | git status clean; check-ignore matches |

### Tier 2 — Structural (10; separately-planned arcs w/ premortems)
SubagentStop + bus-commit wiring (D10c-01/D1A-001) · **session-identity consolidation, 7→1** (D7d-01) · UserPromptSubmit hot-path re-architecture (D6a-01) · codegraph facade latency 35-50s→budget (D4b-01) · resident recall daemon + cache (D6b-01/02) · **permission-layer redesign** — *Codex: auto-allow removal is a PRECONDITION for the injection fixes, not a parallel track* (D2g-02/GAP3-01) · complete the sanitizer coverage (D5b-01) · argv-ify Grep-path injection fallbacks (D2b-10/GAP4) · bus lock + write-amplification hardening (D4a-02) · agent-recall-injector 0-for-78 fix (D2b-03, delicate prior-regression file).

### Tier 3 — Strategic (4; roadmap-level)
Memory recall floor redesign + corpus-health program (D9-01) · three-way settings/template drift reconciliation + source-of-truth (GAP3-03) · elegance/pruning program (collapse duplication clusters, prune dead periphery) · telemetry joinability + intel-bus consumer (Phases C.3/D/E).

### Deletions (12; deletion-quarantine protocol applied to each)
**SAFE-to-delete (quarantine-then-remove):** 11 tracked `tmpclaude-*-cwd` files (+ `.gitignore`); `test-build.ts` stub; `ebr-data-prep.skill` 16KB zip; 4 dead `hooks/src/lib/` duplicates; `memory-client.ts`+`skill-usage.ts` (remove barrel re-export first); `handoff-index` (drops `better-sqlite3`). **HOLD (operator-confirm / higher-risk):** `.ssr_slice.txt`; 26 dead hook prototypes (relocate 6 misfiled libs first); `.claude/scripts/core/` mirror (forward-syncs into active — higher risk); `ralph-state.py` v1 + orphan test copies; orphan agents `memory-extractor.md`/`braintrust-analyst.md`; 14 zero-ref skills + Fourth presentation redundancy (~46MB) + 4 memory rule-stubs.

**Sequencing:** Wave 0 (S0, ratifiable now): QW-01, QW-02, QW-03 — independent, stop active corruption/contamination. Wave 1 (S1 one-field/one-constant): QW-05, QW-06, QW-07, QW-04 (after telemetry pre-flight), QW-08, QW-09. Wave 2 (S1/S2 with small blast radius): QW-10, QW-11, QW-12. Note D2a-01 navigator-safety **already mitigated** (deregistered 2026-06-10, `eae979e`).

---

## 6. [Codex] Cross-Model Appendix

**Pass 1 (adversary-over-ledger) — COMPLETE** (`wf3/codex-pass1-ledger.md`). gpt-5.5 challenged the Claude panel; cross-model lift (6 items not in the Claude confirmed set):
1. **`agent-error-capture` dual-name guard = false-correctness signal** — the *code* handles `Task`, but the matcher is `Agent`-only; a reviewer reading the source is misled into thinking the hook works.
2. **permission-auto-allow + injection = zero circuit-breaker** — auto-allow removal is a *precondition* for the injection fixes.
3. **ripgrepFallback is Windows-self-limiting** — the `2>/dev/null` POSIX redirect passes literally to `rg` on cmd.exe → early failure (hidden reliability bug as much as injection).
4. **write-dead bus is an EXISTING degradation** — `bus-focus.ts` reads always-empty `focus_symbols` today, silently contributing nothing to recall.
5. **D2e-02 → S2** and 6. **D3c-03 → S2** (severity corrections, applied above).
Plus fix-framing sharpening on D5a-01 (execSync always shells), D2d-01 (`'continuous'` token also toxic), D2b-01 (telemetry pre-flight), HYBRID_FLOOR (one-line quick-win).

**Pass 2 (independent shell-flow security sweep) — STOPPED / PARTIAL** (`wf3/codex-pass2-security.md`). The `codex exec` ran into an abnormally long slow-path (>18 min vs 45-120s norm) and was halted to avoid blocking the deliverable. Security cross-model coverage is served by Pass 1 (injection family + ripgrep-Windows + auto-allow compound risk) and the WF-2-confirmed Claude D5a/D5b/D2c/D3a/D2d/GAP4 dimensions. **Residual gap:** no independent gpt-5.5 grep-sweep for *net-new* shell sites. Recommend a focused security re-run (smaller scope, verified `--disable multi_agent`, short timeout) before the Phase-4 injection fixes ship.

**codex-lift telemetry:** `claude_only:190, codex_only:6, both:184` logged to `.claude/logs/codex-lift.jsonl`.

---

## 7. Review-of-the-Review (appendix)

**Orchestration:** ~62 Fable-5 discovery agents (WF-1, 3 runs) + 47 verification agents (WF-2, ~6.4M tokens, 3 same-session resumes) + 3 synthesis + 2 Codex (WF-3). Every finding evidence-locked (file:line + ≤3-line verbatim quote); every S0/S1 re-read by 2 oppositional refuters at the frozen SHA; content-mismatch = mechanical auto-kill.

**Why the rigor:** this repo's own history — a documented 80%-false-claim incident, recent claims-vs-reality catches, shell-quoting bugs that survived multiple Claude-family reviews. The cross-model lift (6 Codex-only findings, including a path the panel cleared) validates the adversarial design.

**Coverage:** all 29 planned dimensions + 4 critic-driven gap-fills; critics confirmed all 111 hook srcs carry a verdict line. **Kill/downgrade stats:** 10 killed (4 excluded, 2 refuted, 4 immaterial), 48 downgraded — the verification *removed* ~23% of raw findings, evidence the panel wasn't rubber-stamping.

**The spend/rate-limit saga (operational honesty):** WF-1 hit the monthly spend limit (salvaged + resumed); WF-2 hit spend then transient server throttle and completed via **same-session resume** (cached agents replay free — the disk-checkpoint + resumeFromRunId design held); WF-3's Codex pass 2 hit a codex-exec slow-path and was stopped. No finding was lost; every partial was salvaged to disk.

**Interim mitigation:** D2a-01 navigator-safety (auto-approve destructive Bash) was **deregistered mid-review** (2026-06-10, `eae979e`) under explicit authorization — the one fix taken before ratification, because it was a live safety inversion.

**Spot-check:** 3 random CONFIRMs (D5a-01, D2g-02, D3a-01) hand-verified verbatim against `86b8f60` — all matched.

---

*Artifacts: `harvest/` (WF-0) · `findings/D*.json` (WF-1, 248) · `wf2/WF2-VERDICTS.json` + `GATE-B-LEDGER.md` (WF-2) · `wf3/synthesis.json` + `codex-pass1-ledger.md` + `codex-pass2-security.md` (WF-3) · `findings.json` (machine-readable confirmed set). Remotes: push `fork` (Rev4nchist), never `origin`.*
