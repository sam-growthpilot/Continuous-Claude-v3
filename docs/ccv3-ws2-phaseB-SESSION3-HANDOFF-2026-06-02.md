# CCv3 WS-2 Phase B — Session 3 Handoff (REVIEW first, then RESUME)

**Created:** 2026-06-02, end of session 2 · **By:** Opus 4.8 (1M) · **For:** the next session.

> **Your job, in order:** (1) **Deep, thorough, skeptical review** of session-2's work (B.0 + B.4 + B.4a — the bus hardening + write-side activation). (2) Once review passes, **resume the build** (the bus READ side: B.3a → B.3b → quality gate → facade → B.5). Do NOT start (2) until (1) passes.

This doc is self-sufficient. Read it fully, then the linked plans. Verify every claim against the code — I have (deliberately) made claims you should re-check; the cross-model reviews this session found 3/3 real bugs precisely because nothing was trusted on assertion.

---

## 0. Orientation — read order

1. **This file** (the map).
2. `docs/ccv3-ws2-phaseB-plan-2026-06-02.md` — the canonical Phase B plan: §2 work breakdown, §3 gate checklist, §4 design Qs, §6 the 12-mitigation map, §8 rollback criteria, **§Build Progress** (status table + resume point). THE reference for what each step must do.
3. `~/.claude/plans/i-want-you-to-encapsulated-hare.md` — the master plan (original Part 1 doc-rot + Part 2, the 12-row pre-mortem).
4. `docs/ccv3-ws2-phaseA-plan-2026-06-01.md` — the substrate (Phase A) the write/read sides build on.
5. `.claude/rules/code-intel-boundaries.md` — L3 specialist boundary contract (single-writer rule, facade routing).
6. v3 design `~/.claude/plans/we-have-recently-done-refactored-storm.md` — §3 boundaries, §4 bus schema, §6 observability, §10 phases, §13 Q&A.

---

## 1. Current state (verified facts — re-verify them)

- **Git:** `HEAD = b12db49`, branch `main`. **9 commits this session**, **NOT pushed** to `fork` (Rev4nchist; push target — never `origin`). The user chose "don't push yet".
- **Working tree:** clean of session-2 changes. The only `M` files (`ROADMAP.md`, `docs/architecture/system-visualization/{architecture.json,index.html}`, `docs/fastmcp-connector-playbook.md`, `opc/scripts/core/store_learning.py`) are **pre-existing, not mine** — leave them. Plus pre-existing `??` untracked docs/dirs (`.codex/`, `ONBOARDING.md`, etc.) — also not mine.
- **Baseline (re-run to confirm):** `npm run build` clean · `audit-braintrust-emits.sh` 4/4 (+ context-bus surface guard OK) · all 9 bus test files green. **Verified end of session 2: a clean run is 152/152.** (One run *during* the handoff commit's concurrent sync showed 2 transient cap-test failures — the §6 flake; the immediate clean re-run was 152/152.)
- **Live bus confirmed working:** a real `.claude/cache/session/<bus_id>/context.json` was written this session and `.claude/logs/intel-bus.jsonl` is accumulating (~114 KB) — the populator + post-edit writers fire correctly.
- **The bus is LIVE but inert:** the populator (per prompt) + post-edit (per edit) WRITE the bus; **nothing READS it yet** → still **zero behavior change**. Active `~/.claude/hooks/dist/` was redeployed current (see §6 deploy gap).

### The 9 commits
```
b12db49 build(ws2): B.4a hook dist artifacts
26414a1 docs(ws2): Phase B progress -- B.4a done + live; read-side resume point
a471f10 feat(ws2): B.4a populate the context bus (turn counter, intent, edited files)
011dec8 docs(ws2): Phase B build progress -- B.0 + B.4 hardening done
9389032 feat(ws2): B.4 telemetry hardening -- intel-bus secret redaction + size rotation
8745249 feat(ws2): B.0 context-bus write-path hardening (200ms cap, never-silent drop)
02a28e1 docs(ws2): Phase B implementation plan (activate the context bus)
77aae85 chore: remove dead create-better-skills.bak remnant
9804c13 docs: close tier doc-rot -- fix stale inventory refs
```

---

## 2. REVIEW protocol — how to vet session-2 thoroughly

### 2a. Re-run the baseline (must all pass before you trust anything)
```
cd .claude/hooks && npm run build
bash ../../scripts/audit-braintrust-emits.sh        # expect 4/4 + surface guard OK
cd .claude/hooks && npx vitest run \
  src/__tests__/atomic-write.test.ts src/__tests__/atomic-write.lock-cap.test.ts \
  src/__tests__/context-bus.test.ts src/__tests__/context-bus.write-cap.test.ts \
  src/__tests__/context-bus.integration.test.ts src/__tests__/intel-bus.test.ts \
  src/__tests__/intel-bus-hardening.test.ts src/__tests__/bus-session-populator.test.ts \
  src/__tests__/post-edit-diagnostics.test.ts
```
**Run the bus suite 5–10× in a loop.** There is a KNOWN rare flake (see §6) in the busy-spin cap tests under peak CPU load — **1–2 failures** (I observed 2 once, under heavy concurrent load) in `context-bus.write-cap`/`atomic-write.lock-cap` on a *timing* assertion (e.g. `elapsed`/`wait_ms`/`p95` bounds) is the known blip; a clean run is 152/152. If a failure is on anything OTHER than those timing bounds, or it reproduces on a quiet machine, investigate — it's a regression.

### 2b. Read the diffs and check the invariants per step

Use `git show <commit>` for each. The three substantive commits + what to verify:

**B.0 — `8745249` (`atomic-write.ts`, `context-bus.ts` + 2 test files)**
- `mutateStateWithLock(path, fn, opts?)` — `opts.lockTimeoutMs` **defaults to `LOCK_TIMEOUT_MS` (5000)** so existing callers (`writeStateWithLock`) are byte-for-behavior identical. Verify NO existing caller's behavior changed.
- `context-bus.ts` `BUS_LOCK_TIMEOUT_MS = 200`. `mutateViaLock`: a lock-timeout is a **DROPPED write** — logged to intel-bus (`bus_write_dropped`) AND signaled via `opts.onOutcome({dropped:true})`, bus file untouched (no clobber), **never silent**.
- **Cross-model lift fixed:** an `outcomeKnown` flag distinguishes a real `lock_timeout` from a pre-acquire exception (`write_error`) so the intel-bus `reason` is honest. Verify the logic in `mutateViaLock`.
- `BUS_WRITE_SLOW_MS = LATENCY_BUDGET_MS` (50) — a `bus_write` timing row emits only when slow. (Was 10ms; raised to fix a load-flaky test + reduce prod noise.) The "fast write stays quiet" test asserts the **gating invariant** (`row IFF slow`), not "the write was fast" — verify it can't flake.

**B.4 — `9389032` (`intel-bus.ts` + `intel-bus-hardening.test.ts`)** — SECURITY-SENSITIVE.
- `appendIntelBus`: order is normalize → `redactSecretsDeep` → `stripNewlinesDeep` → 4KB cap → `maybeRotate` → append. Redaction runs in the HOT PATH before the cap.
- **Redaction is ReDoS-safe** — `ASSIGNMENT_RE` quantifiers bounded `{1,128}/{1,2048}`, the secret-key decision is in a `.replace` callback (`SECRET_KEY_RE`), and field-name wholesale redaction uses an **anchored** `SECRET_FIELD_NAME_RE` (so `token_count`/`*_id` are NOT over-redacted). Standalone shape patterns (OpenAI/AWS/GitHub/Slack/JWT/Bearer/postgres-creds) are all upper-bounded. **Try to find a redaction bypass** (codex found F1 delimiter-split + F2 missing shapes last time — both fixed; look for more).
- Size rotation: `MAX_INTEL_BUS_BYTES = 2_000_000` (env `CCV3_INTEL_BUS_MAX_BYTES`); single-generation rename → `.1`. `pruneIntelBus` (exported, TTL 7d) — **implemented + tested but NOT wired** (wire at session-start in B.5).
- **Accepted-as-documented (validate the reasoning):** rotation/prune **cross-process races** (two writers crossing the cap → one rotated GENERATION of telemetry history can be lost). This is telemetry-history-only; the growth bound + fail-open always hold. Codex rated it real but low-severity; I chose not to lock the telemetry hot path. **Decide if you agree.**

**B.4a — `a471f10` + `b12db49` (`context-bus.ts`, `bus-session-populator.ts` NEW, `post-edit-diagnostics.ts`, 3 test files, `.claude/settings.json`, 2 dist artifacts)** — this got the STRONGEST codex review.
- `BusEntry.current_turn` + `bumpTurn`. New UPS hook `bus-session-populator` bumps the turn + sets a sanitized `current_intent` each REAL prompt (guards mirror `memory-awareness.ts`: subagent / `<15` chars / `.trim().startsWith('/')` — **verify the guards genuinely match**; codex claimed they diverged (F5), I verified they don't because memory-awareness ALSO `.trim()`s, but RE-CONFIRM).
- `post-edit-diagnostics.recordBusFilesInPlay(filePath)` writes role `edited` only — **NOT `test_failed`** (codex F6: a type error isn't a test failure; `test_failed` reserved for a real runner). Verify it's `edited`-only.
- **The big lift (F3, 0.96): bounded growth.** `addFileInPlay` now DEDUPs load_bearing by `(path, role)` (refreshes `turn_added` in place) + caps at `LOAD_BEARING_CAP = 50` evicting oldest-turn; `addFocusSymbol`/`addRecentFinding` FIFO-capped (`FOCUS_SYMBOLS_CAP`/`RECENT_FINDINGS_CAP = 50`). **Verify the cap/dedup logic + that the new tests actually prove it.** Without this, a long edit-heavy session bloats the bus JSON → slower writes → more drops (a feedback loop).
- **Accepted-as-documented (validate):** F2 the turn counter is best-effort (a dropped per-prompt bump → a bounded, fail-safe staleness OVER-estimate); F4 a contended write is logged by `mutateBus` (not silent), so the outer `catch` in `recordBusFilesInPlay` is belt-and-suspenders.
- Registered in BOTH `.claude/settings.json` (repo) and active, **before** memory-awareness, `timeout: 10000`.

### 2c. Recommended review depth
- This is the kind of change where a **cross-model `/review`** earns its keep — consider one parallel `codex-adversary` pass over the cumulative B.0+B.4+B.4a diff (`git diff 4631b43..b12db49 -- .claude/hooks/src`) focused on: the never-silent-drop invariant, redaction bypasses, bounded-growth correctness, and the documented-accepted races. (3/3 codex passes found real bugs last session.)
- **Spot-check `addFileInPlay` dedup under re-edit** and **the redaction patterns** by hand — those are the two places a subtle bug would hide.
- Confirm `CCV3_BUS_OFF=1` still no-ops every writer.

---

## 3. The bus API you'll build on (from `.claude/hooks/src/shared/`)

- `context-bus.ts`: `readBus(busId?, opts?)` (fail-open → `emptyBus`, 50ms latency instrument), `mutateBus(busId|undefined, fn, opts?)` (single-lock RMW, 200ms cap, never-silent drop, `opts.onOutcome`), helpers `setIntent`, `bumpTurn`, `addFocusSymbol`, `addFileInPlay`, `addRecentFinding`, `emptyBus`, `busPath`. Types: `BusEntry` (now has `current_turn`), `FocusSymbol`, `FileInPlay` (8 roles), `FilesInPlay`, etc. Constants: `BUS_LOCK_TIMEOUT_MS`, `BUS_WRITE_SLOW_MS`, `LOAD_BEARING_CAP`/`FOCUS_SYMBOLS_CAP`/`RECENT_FINDINGS_CAP`, `LATENCY_BUDGET_MS`, `AMBIENT_CAP_RATIO`, `AMBIENT_MIN_SLOTS`.
- `session-bus-id.ts`: `getBusId()` — Windows-correct (`USERPROFILE` + realpath hash). `mutateBus(undefined, …)` uses it by default.
- `intel-bus.ts`: `appendIntelBus(event, opts?)` (redacted, rotated, 4KB-capped, fail-open), `pruneIntelBus(opts?)`, `intelBusPath`. Constants `MAX_INTEL_BUS_BYTES`, `MAX_LINE_BYTES`.
- `memory-sanitize.ts`: `sanitizeMemoryContent(str, cap)` + `wrapMemoryContext(body)` — **reuse for ALL bus-sourced strings** that reach an injection surface (WS-0.2 prompt-injection defense).

---

## 4. RESUME assignment — the read side, in order (each: TDD → cross-model `/review` → commit)

### B.3a — `agent-recall-injector.ts` reads the bus (read-only on bus, low risk)
- **Anchors:** `handleAgentTask` (≈L265): `extractIntent` (≈L278) → `recall(intent)` (≈L286) → floor filter (≈L293) → `buildAgentContext` (L148). Insert the bus-read **between extractIntent and recall**.
- **Design:** `readBus()` → non-stale `focus_symbols` + `files_in_play.load_bearing` (staleness = `current_turn - turn_added`; suppress age > ~3; log `stale_symbols_count`). (a) BIAS the recall query with non-stale focus terms (symbol names + load-bearing basenames, capped) — **required so the quality gate is measurable**; (b) inject a sanitized SESSION FOCUS block into `buildAgentContext` (inject even when recall is empty but the bus has focus). Log `source_age`/`injected`/`biased` to intel-bus. `memory-sanitize` everything. Fail-open (readBus already does).

### B.3b — `memory-awareness.ts` reads the bus (DELICATE — the emit-regression-victim file)
- **Anchors:** `main()` L498; 4 early guards L504–531 (subagent / `<15` / slash / `intent<3`) that `outputContinue(); return` and legitimately DON'T emit; recall L556–560; **`await emitBraintrustScore` at L602 inside a `try/catch` L599–623**; inject L625–648.
- **Insert the bus-read in the intent-build region (~L522–525)** — far from the emit and the inject. Same bias/inject/telemetry design as B.3a.
- **Emit invariant (decided Q-B1):** do **NOT** refactor the emit into a `finally`. Instead add a **reachability vitest** (a recall path emits exactly once; the 4 early guards are exempt — assert no emit + `outputContinue`). Keep `audit-braintrust-emits.sh`.
- **Discipline (non-negotiable):** surgical `Edit` only (no whole-file `Write`); **run `audit-braintrust-emits.sh` after EVERY edit**; ONE agent at a time on this file (the May-2026 regression class). Commit the rebuilt `memory-awareness.mjs` dist artifact (see §6).

### Quality gate (mitigation #12) — before B.3 stays enabled
- Fixed representative intent set; run recall WITHOUT bus-bias (baseline mean top-score + hit-rate) vs WITH. Log `source_age`/`injected`/`stale`.
- **Rollback (flip `CCV3_BUS_OFF=1` + re-measure) if ANY:** hit-rate drops vs baseline · mean top-score regresses > ~10% · high injected-stale rate · observable added prompt latency · `bus_write_dropped` storm under normal use.
- **Before the gate's integration smoke:** redeploy active (`cp .claude/hooks/dist/*.mjs ~/.claude/hooks/dist/` + verify) so the live hooks are current.

### B.1/B.2 facade — `scripts/code-intel.mjs` (model `scripts/cdp.mjs`) + `.claude/skills/code-intel/SKILL.md`
- Typed subcommands (NOT loose regex); every response states `backend` + `routing_reason`; ambiguous → `clarify`; one intel-bus row per call. Routing per `code-intel-boundaries.md`. Wire available backends (recall/TLDR/ast-grep/bus); **codegraph routing is Phase-C-deferred** (route-with-fallback). **Known wrinkle:** the facade is a standalone CLI without the hook's session context, so it can't trivially know which `bus_id` to read — solve after the bus is populated (env/`--bus`/most-recent-session). This is WHY I reordered facade AFTER the loop.

### B.5 — `code-intel-enforcer.ts` (PreToolUse, model `no-haiku-enforcer.ts`)
- **Default OFF** (`CCV3_FACADE_MODE` unset → always `{}` allow); even enabled, **only warns** (never `permissionDecision:'deny'`); exact-route-match only; G6 cross-check vs the P3 archive list. Register in BOTH settings.json (Node atomic write). **Also wire `pruneIntelBus` at session-start here.**

---

## 5. Hard guardrails (carry forward)

- **Edit repo files, not `~/.claude/`** (forward-sync is the only automatic direction). Exception: settings.json registration must hit BOTH repo + active.
- **Commit the rebuilt hook dist `.mjs` with each hook change.** The repo tracks 107 hook dist files; src-only commits leave repo dist stale → forward-sync deploys stale (the root cause of session-2's deploy gap). B.3a/B.3b WILL change `agent-recall-injector.mjs`/`memory-awareness.mjs` — commit them.
- **Cross-model `/review` per commit** (critic + codex-adversary). The codex pass found a genuine lift on all 3 substantive commits — keep it.
- **kraken needs independent verification.** Session 2: kraken over-reported a flaky test as 57/57 green, suggested a wrong settings `timeout: 5` (should be `5000` ms), and ran `git stash` via a probe (recovered). Always **re-run stability loops yourself**, verify its config/settings suggestions, and **forbid kraken any git command** in the brief.
- `mutateBus` 200ms cap + never-silent drop; intel-bus events from an **allowlist** (no raw content); B.5 enforcer **defaults OFF, never denies**.
- Per-step commits with explicit `-- <pathspec>`; `rm -f .git/index.lock && git commit -- <paths>` in one Bash call; don't parallelize a git commit with an Agent call. Push target `fork`.

---

## 6. Operational findings + gotchas (session 2)

- **Forward-sync deploy gap (investigate before B.5).** This session, neither `sync-to-active.sh` nor the post-commit forward-sync deployed new/changed hooks to active `~/.claude/hooks/dist/` (the new `bus-session-populator` was absent; `post-edit-diagnostics.mjs` was stale). Worked around via `cp .claude/hooks/dist/*.mjs ~/.claude/hooks/dist/`. Two contributing causes: (1) my hook commits omitted the tracked dist artifacts (now fixed for B.4a); (2) the sync script itself may not create new dist files / rebuild reliably. **Diagnose the sync mechanism** so B.5's new hook deploys cleanly, and **redeploy + verify active is current before the quality-gate smoke.**
- **Rare cap-test timing flake.** `context-bus.write-cap` / `atomic-write.lock-cap` busy-spin timing assertions can flake ~1-in-12 under PEAK parallel-worker CPU load (e.g., while a codex agent runs). Bounds are already generous (lower `>=150`, upper `<3000`, well under the 5000 default). If it becomes disruptive, add an **injectable clock to `acquireLockSync`** to make them deterministic (the real fix; I deferred it as not-blocking).
- **`pruneIntelBus` is unwired** — fold its session-start call into B.5.
- **Codex startup noise is cosmetic** (per `.claude/rules/codex-adversarial.md`): ~150 skill-YAML-reject lines + MCP token errors stream before the real answer; the adversary parses the clean `-o` file. Don't mistake it for failures. The adversary passes `--disable multi_agent` to dodge the gpt-4.1 sub-agent crash.
- **Windows:** `python` not `python3`; Git Bash paths need the drive letter (`/c/Users/...`); never Edit `~/.claude.json` (use Node atomic write); MCP `npx` needs `cmd /c`.
- A leftover kraken handoff file may exist at `thoughts/shared/handoffs/kraken-ws2-phaseB-b4a-bus-populate/` — harmless, untracked.

---

## 7. The 12 pre-mortem mitigations — status

| # | Mitigation | Where it lives now |
|---|---|---|
| 1 | emit invariant structural | B.3b (reachability vitest — TODO) |
| 2 | write latency / 200ms cap + instrument | ✅ B.0 |
| 3 | never-silent dropped writes | ✅ B.0 |
| 4 | bus read ≥1 turn stale | partial: `current_turn` shipped (B.4a); staleness SUPPRESSION is B.3 |
| 5 | intel-bus unbounded growth | ✅ B.4 (rotation/TTL; prune wiring → B.5) |
| 6 | `.codex/` over-broad deletion | ✅ Part 1 (surgical) |
| 7 | telemetry secret leakage | ✅ B.4 (redaction) |
| 8 | enforcer denies when env unset | B.5 (default OFF — TODO) |
| 9 | enforcer noise / circular gate | B.5 (warn-only, exact-match — TODO) |
| 10 | facade silent misroute | B.1 (typed subcommands — TODO) |
| 11 | "doc-only" commit hides deletion | ✅ Part 1 (split commits) |
| 12 | no quality metric / rollback | quality gate (TODO) + telemetry hooks shipping in B.3 |

---

## 8. One-line status

Bus hardening + write-side **done, reviewed, committed, live** (`HEAD b12db49`, 9 commits, unpushed). Read side (B.3a → B.3b-delicate → quality gate → facade → B.5) is next. Review session-2 first; everything you need is above + in the §0 plans.
