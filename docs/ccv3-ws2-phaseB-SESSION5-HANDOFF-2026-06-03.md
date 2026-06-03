# CCv3 WS-2 Phase B — Session 5 Handoff (MERGE #5 → RESUME Phase 3)

**Created:** 2026-06-03, end of session 4 (review→push→PR→CodeRabbit) · **By:** Opus 4.8 (1M) · **For:** the next session.

> **Your job, in order:**
> 1. **Land PR #5** — confirm CodeRabbit's re-review of the tip is clean, then merge `ws2/phase-b-context-bus` → `fork/main` (the user merges, or does it on request). This is the bus READ side + hardening.
> 2. **Resume the remaining Phase B work**, in order: **B.5-pre deploy-guard → B.1/B.2 `/code-intel` facade → B.5 enforcer → stronger quality eval → close-out.**
>
> This doc is self-sufficient. The **canonical execution spec** (full step design + the pre-mortem mitigation table) is the plan file `~/.claude/plans/we-have-been-working-resilient-blum.md` — read it; this handoff is the map + status.

---

## 0. Orientation — read order
1. **This file** (the map + status).
2. `~/.claude/plans/we-have-been-working-resilient-blum.md` — the **approved, pre-mortem-hardened execution plan**. §3.0/3.1/3.2/3.3 are the remaining work, file-by-file, with the locked decisions and the "Risk Mitigations (Pre-Mortem)" record. THE reference for what each remaining step must do.
3. `docs/ccv3-ws2-phaseB-plan-2026-06-02.md` — canonical Phase B plan (§2 work breakdown, §3 gate checklist, §6 12-mitigation map, §Build Progress).
4. `docs/ccv3-ws2-phaseB-SESSION4-HANDOFF-2026-06-02.md` — the PRIOR handoff (review-then-push orientation; still accurate for the bus mechanics).
5. `.claude/rules/code-intel-boundaries.md` — the L3 specialist routing contract the facade (B.1) + enforcer (B.5) implement.

---

## 1. Current state (verified 2026-06-03)

- **Git:** branch `main` locally @ **`1d1b3e7`**. A PR branch **`ws2/phase-b-context-bus`** (same tip, `1d1b3e7`) is pushed to **`fork`** (Rev4nchist) — **NEVER push to `origin` (parcadei).**
- **PR #5 is OPEN:** https://github.com/Rev4nchist/Continuous-Claude-v3/pull/5 — base `main` ← head `ws2/phase-b-context-bus`, **19 commits** (the bus READ side + hardening + earlier unpushed B.0/B.4/B.4a + Codex-CLI repair). **CodeRabbit is the merge gate** (the user wants CodeRabbit review before merge).
- **CodeRabbit round 1** posted 2 "Major/Quick-win" findings; **both addressed in `1d1b3e7`** (see §2). A reply was posted on the PR explaining each resolution. CodeRabbit auto-re-reviews `1d1b3e7` — **confirm it comes back clean before merge.**
- **Bus READ + WRITE sides are LIVE** in active `~/.claude/`: both recall hooks (`agent-recall-injector.ts` PreToolUse:Task, `memory-awareness.ts` UserPromptSubmit) read the bus via shared `shared/bus-focus.ts`. Query-bias gated to **hybrid** recall.
- **Baseline (all GREEN this session):** `npm run build` clean · `audit-braintrust-emits.sh` **4/4** · bus test subset **260 pass** (then 235 after fixes — counts vary with which files are passed; all green) · cap-test loop ×5 clean · quality gate text-only −12.8% (correctly gated off) / **hybrid +33.6% top-score, 63%→88% hit-rate (KEEP ENABLED)**.
- **`CCV3_BUS_OFF=1` disables everything** (every reader + writer + appender).

---

## 2. What shipped in session 4 (review → push → PR → CodeRabbit triage)

1. **Independent re-review of session-3's commits** (`dd0d24b`/`8929667`/`0e85d49`/`cfb0be4`) via a 4-agent Workflow + the premortem's Codex pass. Verdict: **GREEN at HEAD.** `0e85d49`'s "concerns" (bias not gated / text-only dilution) were the commit *in isolation* — **fixed by `cfb0be4`** at HEAD. Hybrid path uses safe `plainto_tsquery`; text-only gets bare intent → bus terms never reach raw `to_tsquery`.
2. **Deep pre-mortem** (Claude + cross-model Codex) on the plan. Folded the verified findings in (commit `d7557bd`):
   - **bus-focus.ts allowlist** — `push()` now `.replace(/[^\p{L}\p{N}_.$#-]/gu,'')` after the control strip → drops tsquery operators (`| & ! : * ( ) ' "`) AND Unicode bidi/zero-width/`\p{Cf}` from untrusted focus terms before they reach `to_tsquery` / the injected SESSION FOCUS block. Preserves real symbol/file tokens. +4 tests.
   - **memory-awareness `focus_terms` telemetry** (Codex#2) — biased recall now reproducible from intel-bus.
   - agent-recall injection test migrated to the stronger property (markers stripped at source).
3. **Push protection footgun handled:** GitHub blocked the push on a **fake Slack-token test fixture** (`intel-bus-hardening.test.ts:258`). User allowlisted it; commit `3069867` then runtime-constructs the fixture (`'xoxb-' + ...`, like the `ghp_` test) so it never trips again.
4. **PR opened (#5)** → CodeRabbit. **CodeRabbit fixes (`1d1b3e7`):**
   - **Finding 2 (valid, fixed):** `scripts/bus-quality-gate.mjs` `recall()` fails soft (`ok:false`) but the caller ignored it — a total recall failure could emit a misleading "KEEP ENABLED". Added a failure-guard (ABORT exit 2 if >half fail; WARN otherwise) before the verdict.
   - **Finding 1 (light mitigation):** capped logged `focus_terms` to ≤8 count / ≤32 chars each; kept terms (not hashed) to preserve reproducibility; intel-bus is local + secret-shapes still redacted.

---

## 3. THE OPEN GATE — land PR #5 first

Before any Phase 3 code:
1. Confirm CodeRabbit's re-review of `1d1b3e7` has **no remaining actionable comments** (`gh pr view 5 --repo Rev4nchist/Continuous-Claude-v3 --comments`; check `gh api repos/Rev4nchist/Continuous-Claude-v3/pulls/5/comments`). Triage any new finding real-vs-noise (same skeptical bar); fix-and-push or reply.
2. **Merge** when clean (user's call / on request): `gh pr merge 5 --repo Rev4nchist/Continuous-Claude-v3 --squash` (or `--merge` to preserve the 19-commit history — confirm the preference; the per-commit history is reviewed and meaningful, so `--merge` may be preferred). After merge, `fork/main` carries the bus READ side.
3. Phase 3 then branches off the merged `fork/main` (fresh feature branch → its own PR, same CodeRabbit gate).

---

## 4. Remaining Phase B work (Phase 3) — in order

> Full file-by-file design + the locked decisions live in the plan file §3.0–3.3. Summary:

### 3.0 — Deploy-gap fix FIRST (pre-commit **staleness** guard) — before B.5 ships a new hook
- **Do NOT run `npm run build` in the hook** — the existing `.git/hooks/post-commit` documents "npm run build hangs on Windows in git-hook context." A building guard would hang every commit.
- Static check: tracked `scripts/precommit-build-guard.sh` — if any staged `.claude/hooks/src/**/*.ts` (excl. `__tests__`, `*.d.ts`), require **≥1** staged `.claude/hooks/dist/*.mjs`, else BLOCK with "run `npm run build` && `git add dist/`". Fail-open; `SKIP_BUILD_GUARD=1` + `--no-verify` escapes. (esbuild bundles `shared/*` into entrypoints — no 1:1 map, so "≥1 dist staged", not per-file.)
- **Durability:** tracked idempotent `scripts/install-hooks.sh` (chains, never clobbers an existing `pre-commit`), called from `wizard.py`; install locally + stage-test BEFORE relying on it.

### 3.1 — B.1/B.2 `/code-intel` facade (`scripts/code-intel.mjs` + `.claude/skills/code-intel/SKILL.md`)
- Model on `scripts/cdp.mjs` (stateless Node CLI, `out/ok/fail`, JSON to stdout, typed subcommands — NOT loose regex). Every response carries `backend` + `routing_reason`; ambiguous → `clarify`; one intel-bus row per call; reads bus to bias ranking but **never writes L2** (single-writer rule).
- **Executable backends (verified):** `recall` (`uv run python opc/scripts/core/recall_learnings.py --query Q --k 5 --json [--text-only]`, cwd=`$CLAUDE_OPC_DIR`, PYTHONPATH=OPC), **TLDR** (on PATH, JSON: cfg/dfg/slice/dead/diagnostics/impact/structure/search), and the **bus** (read `context.json` directly). **codegraph is absent** (Phase C); **ast-grep + Serena are MCP-only** → route-with-fallback (to TLDR) or route-with-guidance (return the exact invocation), never crash.
- **Bus-id discovery** (the CLI-context wrinkle): `--bus <id>` arg → compute from `COORDINATION_SESSION_ID`+`CLAUDE_PROJECT_DIR` → most-recently-modified `<CLAUDE_PROJECT_DIR>/.claude/cache/session/*/context.json`. `getBusId()` = `sanitizeBusPart(getSessionId())-sha256(realpath(cwd).toLowerCase())[:12]`.

### 3.2 — B.5 `code-intel-enforcer.ts` (PreToolUse) — default OFF, never denies
- Model on `no-haiku-enforcer.ts`. `CCV3_FACADE_MODE` unset → `{}` allow. Even enabled: **warn-only** via `additionalContext`, never `deny`. Exact-route-match only; G6 cross-check vs the P3 archive list. 4-case test. **Also wire `pruneIntelBus` at session-start** (+ a smoke test that a >7-day file is actually pruned). Register in **BOTH** `.claude/settings.json` + active `~/.claude/settings.json` (Node atomic write, matcher `Grep|Agent`, 5000ms).

### 3.3 — Stronger quality eval (read-only)
- Extend `bus-quality-gate.mjs` with KNOWN-strong-match intents derived from EXISTING DB rows (reference by id/hash; **0 DB writes** — assert it) + a warmed-daemon hybrid run. (The CodeRabbit failure-guard is already in.)

### Deferred (flagged, not dropped)
- **B.4b** — `grep_hit` (PostToolUse:Grep) + `read_for_context` (Read) bus-populators. Ship once the read side proves its keep.
- **E1 (elephant):** Phase B ships INERT — the facade is a manual CLI, the enforcer is OFF/warn-only. Adoption ≠ quality; the actual routing-through-the-facade payoff is future work. Note this in the eventual close-out.

---

## 5. Key technical facts (carry forward)
- **Hybrid quality-gate works + helps:** +33.6% top-score / 63%→88% hit-rate (KEEP). Text-only −12.8% is *expected* (mechanism the code gates off). Needs a warm recall daemon for the hybrid leg.
- **Deploy gap root cause (root-caused, not the sync script):** `sync-to-active.sh` is correct (dedicated dist `cp` block). The gap is (a) **build-forget** (committing `.ts` without rebuilt `.mjs`) and (b) the **async background post-commit sync racing** — dist was STALE in active immediately after EVERY commit this session; `cp`-fixed each time. ALWAYS hash-verify active after a hook commit (one-liner in plan §8 / prior handoff §8) and `cp` if stale. Phase 3.0's guard addresses (a); (b) is why the per-commit hash-verify ritual stays.
- **Full parallel `vitest run` HANGS on this Windows machine** — a pre-existing daemon/socket suite blocks indefinitely even serially (every suite passes in isolation; bus suites are pure). **Run the bus subset explicitly**, not the whole suite. Candidate follow-up: add hard timeouts to the daemon/socket tests. NOT a session-3/4 regression.
- **GitHub push-protection:** synthetic-secret test fixtures must be runtime-constructed (`'xoxb-' + ...`) or they block the push. The Slack one is fixed; watch for new ones.

---

## 6. Hard guardrails
- **Edit repo files, not `~/.claude/`** (forward-sync is the only auto direction). Exceptions: settings.json registration hits BOTH; the dist `cp` (repo→active) is the sanctioned deploy workaround.
- **Commit the rebuilt dist `.mjs` with every hook change** AND hash-verify active afterward.
- **Cross-model `/review` per commit** (critic + codex-adversary) — it caught real bugs on every session-3 commit and the bypass in the premortem.
- **`plan-to-ralph-enforcer`:** this session's plan-approved state file was cleared (sanctioned bypass) to allow `.ts` edits. A fresh session starting clean won't have a plan-approved state, so edits flow — but if you `ExitPlanMode` again, clear `$TEMP/claude-plan-approved-*<session>*.json` to unblock direct/agent code edits.
- **memory-awareness.ts is the DELICATE emit-victim file** — surgical edits only, emit-guard 4/4 after each, never whole-file rewrite.
- **Push target `fork`, never `origin`.** Per-step commits with explicit `-- <pathspec>`; `rm -f .git/index.lock && git commit -F <msgfile> -- <paths>` in one Bash call.
- **Build/verify vehicle:** user chose Workflow orchestration for Phase 3 (fan out TDD modules + parallel review). The delicate file aside, the 3 new modules (guard, facade, enforcer) are greenfield and parallelizable.

---

## 7. One-line status
Bus WRITE + READ sides **done, reviewed, committed, LIVE, and in PR #5** (CodeRabbit re-reviewing the tip `1d1b3e7`). Merge #5 → then Phase 3: deploy-guard → facade → enforcer → eval. Plan file is the execution spec; bus subset (not full suite) is the test gate; hash-verify active after every hook commit.

---

## 8. Kickoff prompt (paste into the fresh session)

Resume the CCv3 WS-2 Phase B build. FIRST read this handoff in full:
C:/Users/david.hayes/continuous-claude/docs/ccv3-ws2-phaseB-SESSION5-HANDOFF-2026-06-03.md — then the approved execution plan it points to (~/.claude/plans/we-have-been-working-resilient-blum.md, §3.0–3.3 + the pre-mortem mitigation record) and the canonical plan (docs/ccv3-ws2-phaseB-plan-2026-06-02.md).

Your job, in order:

(1) LAND PR #5 (https://github.com/Rev4nchist/Continuous-Claude-v3/pull/5, branch ws2/phase-b-context-bus on fork=Rev4nchist, NEVER origin). Confirm CodeRabbit's re-review of the tip (1d1b3e7) has no remaining actionable comments — triage any new finding real-vs-noise, fix-and-push or reply. Then merge on the user's go (gh pr merge 5 --repo Rev4nchist/Continuous-Claude-v3; confirm --merge vs --squash — the per-commit history is reviewed/meaningful).

(2) RESUME Phase 3 off the merged fork/main, as its own feature branch → its own PR (same CodeRabbit gate). Order: 3.0 pre-commit STALENESS guard (static src⇒dist, NO in-hook npm build — it hangs on Windows; + tracked install-hooks.sh, called from wizard.py) → 3.1 /code-intel facade (scripts/code-intel.mjs model cdp.mjs + SKILL.md; typed subcommands; executable backends = recall/TLDR/bus, codegraph absent + ast-grep/Serena MCP-only => route-with-fallback/guidance; bus-id discovery via --bus/env/most-recent) → 3.2 enforcer (code-intel-enforcer.ts default OFF, never denies, warn-only; wire pruneIntelBus at session-start + smoke test; dual settings.json registration via Node atomic write) → 3.3 stronger quality eval (read-only, 0 DB writes). B.4b is deferred.

Per step: TDD → cross-model /review (critic + codex-adversary) → commit WITH rebuilt dist .mjs → hash-verify active dist == repo dist (cp if stale) → push. Test gate = the BUS SUBSET, not the full vitest suite (it hangs on a pre-existing Windows daemon/socket test). memory-awareness.ts is the delicate emit-victim file (surgical edits, emit-guard 4/4 after each). Drive build + review through Workflow orchestration. Push target fork; never origin.
