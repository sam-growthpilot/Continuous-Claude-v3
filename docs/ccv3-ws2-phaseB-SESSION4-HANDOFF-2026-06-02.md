# CCv3 WS-2 Phase B — Session 4 Handoff (REVIEW → PUSH → RESUME)

**Created:** 2026-06-02, end of session 3 · **By:** Opus 4.8 (1M) · **For:** the next session.

> **Your job, in order:**
> 1. **Deep, skeptical, independent code review** of session-3's 5 commits (the bus READ side + the pre-B.3 hardening + the quality-gate refinement). Do NOT trust this doc on assertion — re-verify against the code; I have deliberately summarized things you should re-check.
> 2. **Push** the reviewed commits to `fork` (Rev4nchist) — never `origin`.
> 3. **Resume** the remaining Phase B work: B.1/B.2 facade → B.5 enforcer (+ the deploy-gap fix + deferred B.4b).

This doc is self-sufficient. Read it fully, then the linked plans. The cross-model `/review`-per-commit rhythm found genuine bugs on *every* commit this session (including one I introduced in my own fix) — keep it.

---

## 0. Orientation — read order

1. **This file** (the map).
2. `docs/ccv3-ws2-phaseB-plan-2026-06-02.md` — the canonical Phase B plan: §2 work breakdown, §3 gate checklist, §5 sequencing, §6 the 12-mitigation map, §8 rollback criteria, **§Build Progress** (now updated through session 3). THE reference for what each remaining step must do.
3. `docs/ccv3-ws2-phaseB-SESSION3-HANDOFF-2026-06-02.md` — the *previous* handoff (oriented session 3; describes B.0/B.4/B.4a in depth). Still accurate for the WRITE side.
4. `.claude/rules/code-intel-boundaries.md` — L3 specialist boundary contract (single-writer rule, facade routing) — the contract B.1/B.2/B.5 implement.
5. `docs/ccv3-ws2-phaseA-plan-2026-06-01.md` — the substrate (Phase A).
6. v3 design `~/.claude/plans/we-have-recently-done-refactored-storm.md` — §3 boundaries, §4 bus schema, §6 observability, §10 phases, §13 Q&A.

---

## 1. Current state (verified facts — re-verify them)

- **Git:** branch `main`. **5 substantive session-3 commits (`dd0d24b..40180b1`) + this handoff doc on top, NOT pushed** to `fork`. Base (last commit before session 3) = `14c5f36`. (`git log --oneline 14c5f36..HEAD`.)
  ```
  40180b1 docs(ws2): session-3 Build Progress -- B.3 read side + quality gate done
  cfb0be4 refine(ws2): B.3 quality gate -- gate query-bias to hybrid recall only
  0e85d49 feat(ws2): B.3b -- memory-awareness READS the bus + shared bus-focus module
  8929667 feat(ws2): B.3a -- agent-recall-injector READS the context bus
  dd0d24b fix(ws2): B.0/B.4/B.4a review hardening -- 5 bus findings + self-regression
  ```
- **Working tree:** the only uncommitted items are **pre-existing, not this session's** (`ROADMAP.md`, `docs/architecture/system-visualization/*`, `docs/fastmcp-connector-playbook.md`, `opc/scripts/core/store_learning.py`, plus untracked `.codex/`, `ONBOARDING.md`, etc.). Leave them — they predate session 1.
- **The bus READ side is COMPLETE and LIVE.** Both recall hooks read the bus: `agent-recall-injector.ts` (PreToolUse:Task) and `memory-awareness.ts` (UserPromptSubmit). The write/populate side (B.0/B.4/B.4a) and hardening shipped earlier. So the bus now genuinely informs recall — the "Cohesive Intelligence" payoff is on.
- **Baseline (re-run to confirm):** `cd .claude/hooks && npm run build` clean · `bash scripts/audit-braintrust-emits.sh` → **4/4** (+ context-bus surface guard OK) · the bus test suite green (counts in §2).
- **`CCV3_BUS_OFF=1` disables everything** (every reader + writer + the intel-bus appender) — verified.
- **ACTIVE DEPLOY: I deployed manually.** The §8 forward-sync deploy gap recurred — `memory-awareness.mjs` + `agent-recall-injector.mjs` were STALE in active `~/.claude/hooks/dist/` after commit. I `cp`'d repo→active and verified MATCH. **Re-verify active is current before trusting any live-session smoke** (command in §8).

---

## 2. REVIEW protocol — how to vet session-3 thoroughly

### 2a. Re-run the baseline
```
cd .claude/hooks && npm run build
bash ../../scripts/audit-braintrust-emits.sh          # expect 4/4 + surface guard OK
npx vitest run                                         # FULL hook suite -- run it ALL, not just the bus subset
```
The bus-relevant test files (run individually if you want focus): `atomic-write.test.ts`, `atomic-write.lock-cap.test.ts`, `context-bus.test.ts`, `context-bus.write-cap.test.ts`, `context-bus.integration.test.ts`, `intel-bus.test.ts`, `intel-bus-hardening.test.ts`, `bus-session-populator.test.ts`, `post-edit-diagnostics.test.ts`, **`bus-focus.test.ts` (NEW)**, **`agent-recall-injector.test.ts`** (heavily rewritten), **`memory-awareness-emit-reachability.test.ts` (NEW)**, plus the subprocess `memory-awareness.test.ts` (16 pass / 5 pre-existing `it.skip`). End-of-session counts: the 12 in-process bus files = **231 tests green**; emit-guard 4/4.
**Loop the busy-spin cap tests 5–10×** (`context-bus.write-cap`/`atomic-write.lock-cap`): a **1–2 timing-only** failure under peak CPU load is the documented §8 flake; anything else is a regression.

### 2b. The 5 commits + what to verify

**`dd0d24b` — pre-B.3 hardening (review of session-2's B.0/B.4/B.4a).** `git show dd0d24b`. The review found 5 real findings (3 codex-only). Verify each fix holds:
- **Codex#1 never-silent-drop hole** (`context-bus.ts` `mutateViaLock`): a write that fails INSIDE an acquired lock (corrupt pre-image → null transform; or `atomicWriteSync` throws) now captures `wrote = mutateStateWithLock(...)` and an `acquired && !wrote` outcome emits a `bus_write_dropped` (reason `write_error`) + `onOutcome({dropped:true})`. Confirm a SUCCESSFUL write still reports `dropped:false`.
- **Codex#2 Bearer leak** (`intel-bus.ts` `redactSecretString`): standalone SHAPE patterns now run BEFORE the generic `ASSIGNMENT_RE` pass so `Authorization: Bearer <opaque>` is fully redacted (the assignment pass used to consume "Bearer" and leave the token). Confirm it's a redaction SUPERSET — **try to find a new bypass.**
- **Codex#3 array keyHint** (`intel-bus.ts` `redactSecretsDeep`): `keyHint` now threads into the array branch so `{tokens:[...]}` is redacted.
- **Codex#5 coerce caps** (`context-bus.ts` `coerceBus`/`coerceFilesInPlay`): the per-slice caps are enforced at the READ choke point (`capTail`/`capByTurn` + new `OPEN_THREADS_CAP`), so a bloated bus file can't persist + grow on every turn-bump.
- **F6 kill-switch** (`intel-bus.ts` `appendIntelBus`): `if (process.env.CCV3_BUS_OFF === '1') return;` at the top — the choke point B.3's direct callers rely on.
- **Self-regression caught by the FIX-review:** I bounded the `ASSIGNMENT_RE` separator to `{0,40}` as a "tidy" — codex flagged it would leak a `KEY : VALUE` with 41+ spaces. **Reverted to `\s*`** (the separator was never the ReDoS surface; the `{1,2048}` value bound is) + a regression test. Confirm the regression test exists in `intel-bus-hardening.test.ts`.

**`8929667` — B.3a agent-recall reads the bus.** `git show 8929667`. Inserted bus-read between `extractIntent` and `recall`; staleness filter; **(originally biased the query +)** injected a sanitized SESSION FOCUS block; telemetry. 4 codex findings fixed (control-char strip, missing-`turn_added`=stale, telemetry-on-throw, `recall_query` log). **NOTE:** the query-bias here was later REMOVED in `cfb0be4` (see §4) — agent-recall is text-only and bias dilutes FTS; it now recalls on the bare intent and surfaces focus ONLY via the injected block.

**`0e85d49` — B.3b memory-awareness reads the bus (DELICATE).** `git show 0e85d49`. memory-awareness.ts is the historical emit-regression victim.
- **Verify the emit is untouched:** `await emitBraintrustScore(` (~L602/645) and its try/catch are byte-unchanged; the bus-read was inserted after the `intent<3` guard and the focus injection in the inject region — both FAR from the emit. emit-guard 4/4.
- **Shared module extracted:** `shared/bus-focus.ts` (NEW) — `extractBusFocus`/`buildFocusBlock`/`isFresh`/`basenameNoExt` + constants. Used by BOTH readers (no drift). `agent-recall-injector.ts` was refactored to import it (re-exports `BUS_STALENESS_MAX_AGE` for its tests). Its own unit tests: `bus-focus.test.ts`.
- **Emit reachability (Q-B1):** a SOURCE-STRUCTURE vitest (`memory-awareness-emit-reachability.test.ts`) asserts exactly one awaited emit, emit AFTER the recall, all 4 guards BEFORE the emit, emit inside a try/catch. An in-process `main()`-driving test was REJECTED (needs exporting main + guarding the on-import auto-run + mocking python-spawning internals — riskier than the regression it guards; the same Q-B1 calculus). **Decide if you agree** — if you want the dynamic test, that's the cost.
- 3 codex findings fixed: Codex#2 (far-future `turn_added` now bounded to `age >= -1` — a poisoned/clock-skew bus can't pin a term forever), Codex#3 (`SCAN_CAP=200` defensive input bound in `extractBusFocus`), critic#1 (`focus_injected` telemetry).

**`cfb0be4` — quality-gate refinement (the key design decision — see §4).** `git show cfb0be4`. Gates the query-bias to hybrid recall only. Harness `scripts/bus-quality-gate.mjs` added.

**`40180b1` — doc-only** (Build Progress table). Skip codex on this one.

### 2c. Recommended review depth
- **One cross-model `codex-adversary` pass** over the cumulative diff: `git diff 14c5f36..HEAD -- .claude/hooks/src` — focus on the redaction (new bypass shapes), the never-silent-drop completeness, prompt-injection via the focus block (every bus string must go through `sanitizeMemoryContent` + `wrapMemoryContext`), and the bias-gating correctness. (3/3-then-some codex passes found real bugs this session.)
- **Re-run the quality gate yourself** (both modes) and confirm the numbers (§4). `node scripts/bus-quality-gate.mjs` (text-only) and `node scripts/bus-quality-gate.mjs hybrid`.
- **Spot-check by hand:** the redaction patterns in `intel-bus.ts`; `isFresh` staleness bounds; that NO raw bus string reaches `additionalContext` in either reader (trace both inject paths in each).
- **Confirm `CCV3_BUS_OFF=1` no-ops** every reader + writer + appender.

---

## 3. What was built (the bus READ side)

- **`shared/bus-focus.ts` (NEW, pure, shared):** `extractBusFocus(bus)` → `{ terms, staleSymbolsCount }` (non-stale focus-symbol `id.name` + load-bearing basenames; control-char-stripped; length-capped `FOCUS_TERM_CHARS=60`; deduped; capped `MAX_FOCUS_TERMS=8`; `SCAN_CAP=200` input bound). `buildFocusBlock(terms)` → sanitized + `wrapMemoryContext`-wrapped SESSION FOCUS block (`''` when empty). `isFresh(currentTurn, turnAdded)` → `turnAdded` numeric AND `age in [-1, BUS_STALENESS_MAX_AGE(3)]`. `basenameNoExt`.
- **`agent-recall-injector.ts`:** `handleAgentTask(input, recall, readBusFn, telemetry)` (4 injected seams). Reads bus → focus block → **recalls on the bare intent (no query bias)** → injects the focus block (prepended to memory context, or alone when recall misses but bus has focus). Telemetry `agent_recall_bus_read` (biased:false). Fail-open (3 guards), read-only on bus, honors `CCV3_BUS_OFF`.
- **`memory-awareness.ts`:** bus-read after the `intent<3` guard; **biases the recall query ONLY when `daemonReady` (hybrid)**: `queryBiased = focusTerms.length>0 && daemonReady`; injects the focus block in BOTH modes; telemetry `memory_awareness_bus_read` (`biased`/`focus_injected`/`focus_count`/`stale_symbols_count`/`current_turn`). The emit at ~L645 is untouched.
- **Both:** every bus-sourced string → `sanitizeMemoryContent` + `wrapMemoryContext` (WS-0.2 prompt-injection). Read-only on the bus (no `mutateBus`). Fail-open.

---

## 4. The quality-gate result (the design decision driving `cfb0be4`)

`scripts/bus-quality-gate.mjs` (n=8 representative intents, live memory DB) measured recall WITHOUT vs WITH bus-bias in both modes:

| mode | mean top-score | hit-rate | verdict |
|---|---|---|---|
| **text-only** (FTS; daemon down) | 0.0358 → 0.0312 (**−12.8%**) | 13% → 13% | rollback-tripped |
| **hybrid** (vector+FTS; daemon up — normal path) | 0.0109 → 0.0126 (**+15.3%**) | **75% → 88%** | KEEP |

**Why:** appending focus terms shifts the query EMBEDDING toward the session working set (helps vector recall) but DILUTES FTS `ts_rank` with terms not lexically in stored learnings (hurts text-only).
**Resolution:** query-bias is gated to hybrid (memory-awareness `daemonReady`); agent-recall (always `--text-only`) drops query-bias; the focus-block INJECTION (orthogonal — never touches scores) stays in both. Net: +15.3%/+13pp where applied, neutral fallback.
**Re-runnable:** `node scripts/bus-quality-gate.mjs [hybrid]`. The harness measures the raw mechanism (recall append), not the hook gating — so re-running reproduces these mechanism numbers; the gating is verified by code + the hook tests. A stronger future eval would add intents with KNOWN strong matches (most synthetic intents here score sub-floor in baseline too).

---

## 5. PUSH (step 2 — after your review passes)

Push target is **`fork` (Rev4nchist), NEVER `origin` (parcadei)**. After the review is GREEN:
```
git push fork main
```
The 5 commits are `dd0d24b..40180b1`. (If the user wants them squashed or reordered first, do that before pushing — they're all on `main`, unpushed, so history is still malleable.)

---

## 6. RESUME assignment — remaining Phase B (step 3)

The user **stopped after the quality gate** (as planned). What's LEFT, in order:

### B.1/B.2 — `/code-intel` facade (`scripts/code-intel.mjs` + `.claude/skills/code-intel/SKILL.md`)
- Model on `scripts/cdp.mjs` (stateless Node CLI, JSON to stdout). **Typed subcommands, NOT loose regex** (`find-symbol`, `who-calls`, `code-context`, `flow`, `rename-preview`, `recall`, `bus`). Every response states `backend` + `routing_reason`; ambiguous → `clarify`; one intel-bus row per call. Routing per `code-intel-boundaries.md` (codegraph broad-first → Serena precise; TLDR owns cfg/dfg/slice/dead; ast-grep owns AST find-replace; archival_memory owns "solved before?"). Wire AVAILABLE backends (recall/TLDR/ast-grep/bus); **codegraph routing is Phase-C-deferred** (route-with-fallback). The facade READS the bus to bias ranking but **does NOT write L2** (single-writer rule §4).
- **Known wrinkle (why facade is AFTER the read loop):** the facade is a standalone CLI without the hook's session context, so it can't trivially know which `bus_id` to read. Solve via env / `--bus` / most-recent-session.

### B.5 — `code-intel-enforcer.ts` (PreToolUse) — **default OFF, never denies**
- Model on `no-haiku-enforcer.ts`. `CCV3_FACADE_MODE` unset → always `{}` allow. Even enabled, only **warns** via `additionalContext` (never `permissionDecision:'deny'`). Exact-route-match only. G6 cross-check vs the P3 archive list. Register in BOTH `.claude/settings.json` (repo) + active `~/.claude/settings.json` (Node atomic write, never the Edit tool). **Also wire `pruneIntelBus` at session-start here** (it's implemented + tested but still unwired).

### Before B.5 ships a NEW hook — FIX THE DEPLOY GAP (see §8)
The forward-sync has now failed to deploy changed hook dist twice. B.5 adds a NEW hook → it WILL be absent from active unless you fix the sync or `cp` manually. Investigate `scripts/sync-to-active.sh` + the post-commit forward-sync, or make a `cp .claude/hooks/dist/*.mjs ~/.claude/hooks/dist/` deploy step explicit + verified.

### Deferred (flagged, not silently dropped)
- **B.4b** — `grep_hit` (needs a PostToolUse:Grep signal; the existing `smart-search-router` is PreToolUse) + `read_for_context` (needs a Read signal) bus-populators. Ship once the read side proves its keep.
- **Stronger quality eval** — add KNOWN-strong-match intents; optionally a hybrid run with the daemon warmed for production-realistic latency.

### Execution model
- **Per step: TDD → cross-model `/review` (critic + codex-adversary) → commit (with rebuilt dist `.mjs`).** B.1/B.2/B.5 are NOT the delicate file, so kraken-TDD is fine — but independently re-verify kraken (it over-reported a flaky test as green + suggested a wrong timeout in session 2; **forbid kraken any git command**).

---

## 7. Hard guardrails (carry forward)

- **Edit repo files, not `~/.claude/`** (forward-sync is the only automatic direction). Exceptions: settings.json registration hits BOTH; the dist deploy `cp` (repo→active) is the sanctioned deploy workaround.
- **Commit the rebuilt hook dist `.mjs` with each hook change.** Src-only commits leave repo dist stale → forward-sync deploys stale. (This is the root of the recurring deploy gap — always commit dist AND verify active.)
- **Cross-model `/review` per commit** (critic + codex-adversary). It earned its keep on every commit this session, including catching my own self-inflicted regression in `dd0d24b`.
- **kraken needs independent verification + zero git commands.**
- `mutateBus` 200ms cap + never-silent drop; intel-bus events from an allowlist (no raw content); B.5 enforcer **defaults OFF, never denies**; `CCV3_BUS_OFF=1` kills all bus I/O.
- Per-step commits with explicit `-- <pathspec>`; `rm -f .git/index.lock && git commit -- <paths>` in one Bash call; don't parallelize a git commit with an Agent call. Push target `fork`.

---

## 8. Operational findings + gotchas

- **FORWARD-SYNC DEPLOY GAP (recurred — now twice).** After commit, `memory-awareness.mjs` + `agent-recall-injector.mjs` were STALE in active `~/.claude/hooks/dist/`. Worked around with a `cp`. **Verify active is current with this (run from repo root):**
  ```
  node -e "const fs=require('fs'),c=require('crypto');const home=process.env.USERPROFILE;const h=p=>{try{return c.createHash('md5').update(fs.readFileSync(p)).digest('hex')}catch{return 'MISSING'}};for(const f of ['memory-awareness','agent-recall-injector','bus-session-populator','post-edit-diagnostics']){const r=h('.claude/hooks/dist/'+f+'.mjs');const a=h(home+'/.claude/hooks/dist/'+f+'.mjs');console.log((r===a?'MATCH ':'STALE ')+f)}"
  ```
  If STALE: `node -e "const fs=require('fs');const home=process.env.USERPROFILE;for(const f of ['memory-awareness','agent-recall-injector']){fs.copyFileSync('.claude/hooks/dist/'+f+'.mjs',home+'/.claude/hooks/dist/'+f+'.mjs')}"`. **Fix the root cause before B.5.**
- **Rare cap-test timing flake** (`context-bus.write-cap`/`atomic-write.lock-cap`): 1–2 busy-spin timing-bound failures under peak parallel CPU load; clean re-run on a quiet machine. Not a regression. The real fix (deferred) is an injectable clock in `acquireLockSync`.
- **Codex startup noise is cosmetic** (per `.claude/rules/codex-adversarial.md`): ~150 skill-YAML-reject lines + MCP token errors stream before the real answer; the adversary parses the clean `-o` file. The adversary passes `--disable multi_agent` to dodge the gpt-4.1 sub-agent crash.
- **Windows:** `python` not `python3`; Git Bash paths need the drive letter (`/c/Users/...`); never Edit `~/.claude.json` (Node atomic write); MCP `npx` needs `cmd /c`. Test source must be ASCII — embedding control chars in `.ts` (e.g. `' '` literals) creates real NUL bytes (build control-char test inputs with `String.fromCharCode`).

---

## 9. The 12 pre-mortem mitigations — status

| # | Mitigation | Status |
|---|---|---|
| 1 | emit invariant structural | ✅ B.3b (source-structure reachability vitest + bash emit-guard) |
| 2 | write latency / 200ms cap | ✅ B.0 |
| 3 | never-silent dropped writes | ✅ B.0 + dd0d24b (in-lock hole closed) |
| 4 | bus read ≥1 turn stale | ✅ B.3 (staleness suppression + telemetry) |
| 5 | intel-bus unbounded growth | ✅ B.4 (+ dd0d24b coerce caps); `pruneIntelBus` wiring → B.5 |
| 6 | `.codex/` over-broad deletion | ✅ Part 1 |
| 7 | telemetry secret leakage | ✅ B.4 + dd0d24b (Bearer/array leaks closed) |
| 8 | enforcer denies when env unset | B.5 (TODO — default OFF) |
| 9 | enforcer noise / circular gate | B.5 (TODO — warn-only, exact-match) |
| 10 | facade silent misroute | B.1 (TODO — typed subcommands) |
| 11 | "doc-only" commit hides deletion | ✅ Part 1 (split commits) |
| 12 | no quality metric / rollback | ✅ quality gate ran; bias gated to hybrid (cfb0be4) |

---

## 10. One-line status

Bus WRITE + READ sides **done, reviewed, committed, LIVE** (5 session-3 commits `dd0d24b..40180b1`, unpushed). Query-bias gated to hybrid (+15.3% there); kill-switch + fail-open everywhere. Review → push to `fork` → then B.1/B.2 facade + B.5 enforcer (fix the deploy gap first).

---

## Kickoff prompt (paste into the fresh session)

> Resume the CCv3 WS-2 Phase B build. FIRST read the handoff in full:
> `C:/Users/david.hayes/continuous-claude/docs/ccv3-ws2-phaseB-SESSION4-HANDOFF-2026-06-02.md`
> — it has the review protocol, the 5 commits to vet, the quality-gate result, push
> instructions, the resume assignment, hard guardrails, and the (recurring) deploy gap.
> Then read the canonical plan it lists in §0 (`docs/ccv3-ws2-phaseB-plan-2026-06-02.md`).
>
> Your job, in order — do NOT push until (1) passes:
>
> (1) **DEEP, SKEPTICAL, INDEPENDENT REVIEW** of session-3's 5 commits
>     (`git log --oneline 14c5f36..HEAD`): the pre-B.3 hardening (`dd0d24b`), B.3a
>     (`8929667`), B.3b (`0e85d49` — the DELICATE memory-awareness emit-victim file),
>     and the quality-gate refinement (`cfb0be4`). Re-run the baseline (`cd .claude/hooks
>     && npm run build`, `bash scripts/audit-braintrust-emits.sh` → 4/4, `npx vitest run`
>     for the WHOLE suite; loop the cap tests 5–10×). Verify the emit invariant
>     (memory-awareness emit untouched), the bias-gating (memory-awareness biases query
>     only in hybrid; agent-recall doesn't bias), and that NO raw bus string reaches
>     additionalContext. Re-run the quality gate both modes (`node scripts/bus-quality-gate.mjs`
>     and `... hybrid`) and confirm the numbers. Run ONE cross-model codex-adversary pass
>     over `git diff 14c5f36..HEAD -- .claude/hooks/src` (redaction bypasses, never-silent-drop,
>     prompt-injection via the focus block, bias-gating). Verify active deploy is current (§8).
>
> (2) **PUSH** to `fork` (Rev4nchist, NEVER `origin`): `git push fork main`.
>
> (3) **RESUME** the remaining Phase B: **B.1/B.2 facade** (`scripts/code-intel.mjs` +
>     `.claude/skills/code-intel/SKILL.md`, typed subcommands, routing per
>     `code-intel-boundaries.md`, codegraph Phase-C-deferred) → **B.5 enforcer**
>     (`code-intel-enforcer.ts`, default OFF, never denies, + wire `pruneIntelBus` at
>     session-start, dual settings.json registration). **FIX THE FORWARD-SYNC DEPLOY GAP
>     before B.5 ships its new hook** (it failed to deploy changed dist twice this session).
>     Each step: TDD → cross-model `/review` → commit (commit the rebuilt dist `.mjs` too).
>
> Guardrails (full list in handoff §7): edit repo files not `~/.claude/`; commit the
> rebuilt hook dist `.mjs` with each hook change AND verify active is current; cross-model
> `/review` per commit; kraken needs independent verification + NO git commands; B.5 enforcer
> defaults OFF and never denies; push target `fork`. `CCV3_BUS_OFF=1` is the global kill switch.
