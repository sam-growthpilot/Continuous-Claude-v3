# GATE G-B — Confirmed Findings Ledger (CCv3 Fable-5 Deep Review)

**Review SHA:** `86b8f60` · **Generated:** 2026-06-11 from WF-2 run `wf_69ab5f8d-34c`
**Verification:** dual oppositional refuters on every S0/S1 (split → arbitrator must cite counter-evidence to kill); single ops-realist on S2/S3; whitespace-normalized quote match at the frozen SHA as the mechanical kill tripwire; reachability evidence required on every CONFIRM. 47 verifier agents, ~6.4M tokens.

## Outcome (248 WF-1 findings → verified)

| Verdict | Count |
|---|---|
| **CONFIRM** | **190** |
| DOWNGRADE (severity lowered, finding kept) | 48 |
| KILL (refuted / unreachable / excluded) | 10 |
| no-verdict | 0 (complete coverage) |

**Confirmed by final severity: S0 = 3 · S1 = 43 · S2 = 106 · S3 = 38.**
Confirmed by leverage: quick-win = 98 · structural = 83 · strategic = 9.
Spot-check: 3 random CONFIRMs (D5a-01, D2g-02, D3a-01) hand-verified verbatim against `86b8f60` — all matched.

---

## ONE-PAGE SUMMARY — the S0/S1 that matter (46 confirmed)

### S0 — silent corruption / contamination / data-loss (3)
- **D5a-01** — *junk-creator NAMED.* `agent-error-capture.ts` builds a `store_learning.py` shell command from un-sanitized agent error text → the 4 junk artifacts. Root cause of SEED-01. **Fast-track-ratifiable now (E2).**
- **D2d-01** — *ROADMAP contamination root cause.* The post-plan contamination guard is a negative allowlist of **registered** sibling projects; an unregistered foreign project is invisible to it → cross-project ROADMAP clobber (the Session-9 incident). Root cause of SEED-02.
- **D2b-05** — *smart-search-router writes its Grep handshake to hardcoded POSIX `/tmp/claude-search-context`* → on Windows this lands in `C:\tmp`, growing unbounded since January (confirmed live on every Grep).

### S1 — wrong hot-path behavior / exploitable injection / decision-driving false claim (43)

**Security / injection (shell-string interpolation of model-or-prompt content — the proven cross-model blind class):**
- **D2c-04 / D3a-01 / D2d-06** — `user-confirmation-detector`, `agent-error-capture`, `hook-error-pipeline` all `execSync` `store_learning.py` with prompt/agent text interpolated (bash-style escaping, wrong for cmd.exe).
- **D2b-10 / GAP4-01 / GAP4-02** — `smart-search-router` + `daemon-client` feed the raw Grep `pattern` into an `execSync`/double-shelled fallback.
- **D5b-01** — WS-0.2 memory sanitizer covers only 2 of 5 live archival→context injectors (`session-start-continuity`, `pre-plan-memory` inject raw recall = the exact prompt-injection the sanitizer exists to stop). Composes with the store-side injectors above into a poison-then-inject chain.

**Permission / safety inversions:**
- **D2a-01** — navigator-safety auto-approves destructive Bash. **ALREADY MITIGATED** — deregistered 2026-06-10 (commit eae979e); source retained for the proper `allow`→`ask` rewrite in Phase 4.
- **D2g-02 / GAP3-01** — `permission-auto-allow` auto-approves **every** PermissionRequest except 2 named tools (all Bash/Edit/Write/WebFetch), nullifying the OS permission layer.
- **D2a-02** — package-install-guard bypassed by any compound command (`cd X && npm install evil`); regexes are start-anchored.
- **D2a-05** — plan-mode approval gate silently bypassed under `--dangerously-skip-permissions`.
- **D2a-06** — `isRalphActive()` has no TTL; a stale `.ralph/state.json` permanently disables Ralph delegation enforcement.

**Dead / mis-wired enforcement (matcher split-brain + event gaps):**
- **D2b-01 / D10c-02** — 5 (→ entire agent safety+verification chain) hooks registered under matcher `"Agent"` while the live subagent tool matches `"Task"` → never fire.
- **D10c-01 / D1A-001 / D1b-03 / D4a-03** — SubagentStop is unwired at the event level (zero registrations at SHA); codegraph's `proposed_bus_updates` have **no committer**, yet the always-in-context boundary rule + facade comment assert a "downstream SubagentStop writer revalidates." Decision-driving false claim + write-dead bus symbol layer.
- **D2d-03** — `epistemic-reminder` reads `input.tool` (canonical is `tool_name`) → dead in production.
- **D2e-02** — `post-edit-diagnostics` `spawnSync('tsc')` can't resolve the `.cmd` shim on Windows → whole TS diagnostics path silently no-ops.

**Memory pipeline correctness:**
- **D3b-01** — `HYBRID_FLOOR 0.01` applied to decay-multiplied RRF scores mathematically excludes most of the corpus.
- **D3b-02** — hybrid FTS arm uses `plainto_tsquery` (AND) over the full prompt → FTS arm ~always empty.
- **D2c-01 / D3b-05 / D3c-04** — no UserPromptSubmit filter for synthetic `<task-notification>` prompts → 24.6% intent-pollution; consumer side has no machine-content guard.
- **D2b-03** — `agent-recall-injector` (delicate prior-regression file): 0-for-78 lifetime memory yield.
- **D3c-03** — `expandGitQuery` `lower.includes('pr')` matches project/problem/improve/prompt… → spurious git-query expansion.
- **D9-01** — memory-recall 27.4% hit decomposed: pollution fix alone caps best-case ~36%; floor is the bigger lever.

**ROADMAP / sync correctness:**
- **D2d-02 / D2d-09 / D2d-10 / D2F-03** — plan-selection reads newest-mtime from the machine-global `~/.claude/plans` pool; `prd-roadmap-sync`/`git-commit-roadmap` mark the current goal complete on any checked tasks file / foreign-project commit; `buildUnifiedContext` re-extracts Current Focus without the contamination guard.

**Performance (hot-path, telemetry-verified):**
- **D6a-01** — UserPromptSubmit serializes 13 process spawns → ~22-32s worst-case before any prompt answers.
- **D4b-01** — live codegraph queries run 35-50s (10× the documented 3-4s budget).
- **D4a-02** — 200ms bus-lock cap is leaky: observed lock-waits to 2293ms (11×).

**Drift / dead weight (decision-driving):**
- **D8a-01** — RULES.md claims maestro-enforcer BLOCKS agents until interview completes; the hook doesn't.
- **D8a-02** — `hook-auto-execute.md` instructs Claude to run, unprompted, any bash command in a PreToolUse deny reason (injection amplifier).
- **D7b-01 / GAP3-03 / GAP1-01** — 28 ghost skill registrations (26 arscontexta-* from a removed plugin); 18 active hook registrations absent from tracked repo settings (3-way drift); "hook coverage complete" was TS-only — 9 git-tracked Python hooks never audited.

---

## Notable DOWNGRADES (real, severity-corrected — full list in WF2-VERDICTS.json)
48 total. The cross-model rigor working as intended — e.g. **D10b-01/02** (dist-staleness + unlocked sync) S1→S2: documented-accepted gap + loud-failure, not silent corruption. **D5a-02** S1→S3, **D5a-03** S1→S2 (junk-creator siblings, lower blast radius than the named root). **D2a-03, D2g-01, D3c-01/02, D2d-04/05/12** S1→S2.

## KILLS (10)
- Refuted on the merits (arbitrated): **D2b-04, D7c-01**.
- Ops-realist KILL (phantom / immaterial): **D2e-14, D4a-07, D6a-09, D7a-05**.
- Auto-excluded (evidence only in excluded paths): **D9-02, GAP2-01, GAP2-02, GAP2-03**.

## S2/S3 confirmed (144) — the elegance/lean backlog
106 S2 + 38 S3, spread across all 29 dimensions (heaviest: D2e, D2g, D8c, D1a, D2f). These are the duplication-cluster / dead-weight / latency-polish items that feed the **structural** and **quick-win** backlog at WF-3. Full per-finding records in `WF2-VERDICTS.json`; sorted digest in `confirmed-digest.json`.

---

## GATE G-B DECISION (user)
Per the plan, WF-3 (synthesis + 2 mandatory Codex passes → report + ratified backlog) does **not** start without your ratification here. Options: ratify the confirmed ledger as-is → WF-3; adjust severities/kills first; or fast-track the D5a-01 junk-creator fix now (E2) ahead of WF-3.
