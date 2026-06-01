# CCv3 Hardening — Progress + Phase 3 Continuation (2026-05-31)

**Status:** Phases 0–2 COMPLETE. Phase 3 crown jewel (agent-side recall) SHIPPED + live + load-tested.

**Continuation session (2026-05-31, session 2):** Tail items **1, 2, 3, 5 DONE** (commits `ded901b`→`28184c3`, **5 ahead of fork/main, NOT yet pushed**). **MAJOR:** caught the `hooks/src` regression reproducing live — the **THIRD vector** (`~/.claude/.git/hooks/post-commit` ran an unguarded `cp -r hooks/src` active→repo). Root-caused, recovered from HEAD, active src refreshed, and the vector neutralized (post-commit re-routed through the audited `sync-claude.sh`, which excludes `hooks/src`). Full forensics + recovery: `docs/ccv3-reverse-sync-regression-2026-05-31.md`. **Remaining: item 4 (dead-weight) + item 6 (PageIndex, still deferred).**

Predecessor: `docs/ccv3-hardening-handoff-2026-05-30.md` (the original plan). This doc supersedes it for execution status.

---

## Shipped this session (commit run)

| Phase / Step | What shipped | Commit / Tag |
|---|---|---|
| **0** Clear the decks | Deactivated stale `ccv3-visualization` Ralph; fixed `session-start-recovery.ts:125` gate; fixed `knowledge_tree.py` discovery (IGNORE_DIRS + path-segment matching — killed test-dir junk); hygiene (scratch deleted, branch deleted, 5 commits pushed) | `e48dc92` `ccv3-phase0` |
| **1** WS-0.3 sync fix | Deleted both stale-active-src build paths (`sync-to-active.sh` ×2 build block + neutralized `auto-build.ts`); `auto-build` later deregistered | `b20fe25` `ccv3-step1` |
| **1** WS-0.2 injection fix | `shared/memory-sanitize.ts` (strip ctrl, HTML-encode, cap, data-only wrap) at both injection sites; +completion fixes (sanitize type/id/subagentType; cap-before-encode) | `6171a8c` + `a16e7f9` `ccv3-step2` |
| **1** Neon token | Plaintext bearer → `Bearer ${NEON_API_KEY}` in `~/.claude.json` (live config, not git-tracked) | — |
| **1** review remediation | Cross-model `/review` (Codex+critic) → fixed 2 real defects + caught/fixed a `--skip-build` regression | `ec22cbb` `2702bbd` |
| **2** Step 3 hot-path | pageindex-navigator CASUAL short-circuit + hit/fallback instrumentation; sentry/braintrust/ralph-watchdog early-exits; **NEW `scripts/hook-manifest-check.mjs`** gate; auto-build deregistered | `7d858cf` `ccv3-step3` |
| **2** Step 4 session-id | Windows `HOME` fallback fix (`session-id.ts:27`); dead import removed. **No `file_claims` migration** (recon-proven: `session_id` is a transient non-key column) | `f6a654e` `ccv3-step4` |
| **3** agent-recall (crown jewel) | **Activated agent-side memory recall** — the audit's #1 gap | `017929a` `ccv3-phase3-agent-recall` |

### Agent-recall is now LIVE (operational note)
- Root cause was one guard: `agent-recall-injector.ts` skipped unless `tool_name === 'Task'`, but Claude Code sends `tool_name === 'Agent'`. Fixed to accept both.
- Kill-switch: **`CCV3_AGENT_RECALL_OFF=1`** disables it instantly if it ever degrades agent latency.
- `RECALL_TIMEOUT_MS` raised 2000→3500 (cold `uv` startup ~2.2s).
- Load-test: 3 concurrent `Agent` events fired real recalls (`agent-recall.jsonl` 1→4), all exit 0 in <500ms, fail-open. Only tested at 3-way concurrency; the 10+-parallel (Ralph) case is bounded by per-call timeout + fail-open but not stress-tested.

---

## Phase 3 tail — status

**DONE this session (commits `ded901b`..`28184c3`, unpushed):**
- ~~1. BGE daemon fail-fast~~ — DONE `28184c3`. Implemented at **5000ms**, NOT the 3s the recon suggested: text-only recall measured **~750ms warm**, so the 12s ceiling was never the bottleneck — only a DB *hang* trips it. 5s sits safely above cold `uv` (~2.2s)+query, avoiding the 2000ms-SIGKILL regression. `timeout: useHybrid ? 12000 : 5000` in `memory-awareness.ts`. emit-audit 4/4, tests green.
- ~~2. TLDR warm-cache removal~~ — DONE `a08014a`. Verified `isCacheStale()` permanently true (cache dir never created). Deregistered from both settings; **source-file retirement folded into the item-4 deletion sweep** (`session-start-tldr-cache.ts` + dist + `tldr-hooks.test.ts` now dead).
- ~~3. RLM doc~~ — DONE `42a950e`. RLM was already architected (`docs/architecture/rlm/rlm-architecture.md`); added discoverability (INDEX "System at a Glance" row + Role/dormant framing line).
- ~~5. P-docs~~ — DONE `2ceefc9`. **NOTE:** `plan-to-ralph-enforcement.md` was CORRECT (documents the *separate* `plan-to-ralph-enforcer`, which genuinely blocks) — left untouched. Fixed only the false "BLOCKED/enforced, not advisory" claim in active `~/.claude/RULES.md` + repo `RULES.md.template`.

**REMAINING:**
- ~~4. P3 dead-weight~~ — **COMPLETED 2026-06-01** (Maestro, commits `f65837e`..`f196ac1`). See the **Session 3** block below for what shipped + key findings.
6. **PageIndex keep-vs-archive** — still the only open item (deferred, telemetry-gated).

### Session 3 (2026-06-01) — item 4 done + excalidraw repair
Six commits on `main` (unpushed), each per-phase with explicit pathspec:
- `f65837e` deleted 8 tracked dead files (3 stale `.bak`/`.backup`, `skill-rules.json.backup`, dead `session-start-tldr-cache` hook src+dist, its test) + dropped that hook from `system-coherence-stress.mjs:278` (dangling-ref guard).
- `0264da3` archived 8 dead-weight skills (skill-creator, create-better-skills, claude-in-chrome, agentica-{claude-proxy,infrastructure,server}, wiring, tdd-migration-pipeline) — removed from tracked tree; local copies in **gitignored** `skills/archive/`.
- `d7d1ae3` + `f196ac1` **excalidraw skill repaired** (user-requested, replaced archival): port reconciled 3000/3002→**3100** across 7 scripts + SKILL.md + `~/.claude/mcp.json`; eval status corrected fail→pass; **live smoke test PASS** (server boot + health + create + export + delete round-trip); start-command documented.
- `04117cc` removed 3 vibe-trading agent dupes from global (byte-identical to `Projects/vibe-trading/.claude/agents/`).
- `a233a43` dropped 14 broken `math/*` routings from skill-rules.json (skills 100→86; they live in `skills/archive/math/`).
- MCP cleanup (active-only, no repo home): `~/.mcp.json` next-devtools removed (→7 servers); `~/.claude/mcp.json` trimmed to **excalidraw + exa** (8 dupes/dead removed).

**Key findings (carry forward):**
- `liaison` + `surveyor` are **LIVE** (maestro Jury pattern + migrate Phase-5 spawn) — the audit's "possibly dead" was wrong; KEPT. Reverse-reference closure earned its keep.
- `skills/archive/` is **gitignored** — archival = `git rm` from the tracked tree (recoverable via history) + local copy in the ignored `archive/`. `git mv` into a pre-existing archive dir nests; de-nest by rebuilding from the clean active copy.
- excalidraw-mcp's `_eval-progress.json` "structural-FAIL" was **stale (2026-03-07)** — scripts were actually present + correct. Always re-verify eval-tracker claims against live files.
- Verification baseline still green post-sweep: emit-audit 4/4, `hook-manifest-check` OK (no missing dist), `npm run build` clean (deleted hook orphaned no imports), 0 dist churn.

<details><summary>Original item-4 scope (for history)</summary>

4. **P3 dead-weight** — BEFORE archiving anything, run **reverse-reference closure** (Codex #4): scan skills/hooks/settings/`.mcp.json`/rules for consumers (e.g. `claude-in-chrome` still has live `mcp__claude-in-chrome__*` refs). Then archive `skill-creator`(==`skill-forge`)/`create-better-skills`/`claude-in-chrome`; **delete `*.bak`/`*.backup`** (confirmed in `hooks/src`: `session-start-continuity.ts.bak`, `skill-activation-prompt.ts.bak`, `skill-activation-prompt.ts.backup`) **+ the now-dead `session-start-tldr-cache.{ts,mjs}` + `tldr-hooks.test.ts`**; reconcile `math/*` routing; move vibe-trading agents (`quant-analyst`/`risk-officer`/`paper-trader`) out of global; remove `next-devtools`+`idearalph` MCP + dedupe 6 dup `.claude/mcp.json` entries. **Deletions need user confirmation. Best done in a fresh, clean context** (per the original handoff — avoids dangling references).

</details>

(Original item 6, full detail — still the open item:)
6. **PageIndex keep-vs-archive** — DEFERRED until `.claude/logs/pageindex-nav.jsonl` (instrumented in Step 3) has real hit-vs-fallback data. Decide after telemetry.

### New operational note (2026-05-31, session 2)
- **THIRD reverse-sync vector found + fixed:** `~/.claude/.git/hooks/post-commit` did a raw `cp -r hooks/src` active→repo with no audit gate (the `.sh`/`.mjs` were fixed in `ddc0641`; this hand-rolled git hook, no repo template, was missed). It fires when `git-auto-commit` commits `~/.claude` (10-min debounce) after editing any tracked active file. **Now routed through `sync-claude.sh --to-repo`**; original at `~/.claude/.git/hooks/post-commit.bak.2026-05-31`. **Lesson: editing active `~/.claude/{rules,docs,...}` files can still trigger a `~/.claude` auto-commit → forward sync churn; the dangerous reverse-clobber is closed, but prefer editing repo files where possible.**

### Deferred beyond Phases 0–3 (scope decisions)
- **WS-2 context-bus spine** (Phases A–E) — out of scope per the approved Phases-0–3 tier; re-decide after re-measuring.
- **Ralph 3→1 UPS-hook merge** — recon showed the 3 already early-exit; low ROI; skipped.
- **`session-bus-id.ts` unification** — was a WS-2 enabler; the two `getSessionId` impls are cleanly domain-separated (DB-coord vs temp-file); not needed for Phases 0–3.
- **sync read-only-ness** (Codex #3) — `sync-agent-json.py --apply` writes regenerated sidecars into the REPO `agents/` dir during forward sync; bounded + idempotent but leaves uncommitted `agents/*.json` after a sync. Make sync generate-to-active only.

---

## Operational notes (learned this session — read before continuing)
- **Commit lock-safe:** a `git-auto-commit.mjs` hook intermittently leaves a stale 0-byte `.git/index.lock` (no surprise commits in the log, so no data risk). Pattern that works: `rm -f .git/index.lock && git add <paths> && git commit -- <paths>` in ONE Bash call (no PostToolUse hook fires mid-call). Do NOT parallelize a git commit with an Agent call — the lock failure cascades and cancels the sibling.
- **Per-step commits:** use `git commit -- <explicit pathspec>` to isolate; `git add <X> && git commit` (no pathspec) once swept 8 unrelated staged files in — always use the `-- <pathspec>` form.
- **`settings.json`:** active `~/.claude/settings.json` is NOT in the repo (NEVER_SYNC) and is meaningfully ahead of repo `.claude/settings.json`. Edits to hook registrations must hit BOTH (active for effect, repo for reference). Use Node atomic read-modify-write. `scripts/hook-manifest-check.mjs` validates registrations (run it after any settings change).
- **dist LF/CRLF churn:** `post-plan-roadmap.mjs`/`roadmap-completion.mjs`/`session-start-continuity.mjs` show as modified after every build (line-ending only, no real content change) — exclude them from commits. Consider a `.gitattributes` for `*.mjs`.
- **Sync footgun is fixed** but `sync-to-active.sh` still accepts `--skip-build` as a no-op (the post-commit hook passes it — do NOT remove the flag again).
- **Codex false-positive caution:** Codex's pass-2 claimed `scripts` was added to `IGNORE_DIRS` — it was NOT (verified). Always verify cross-model findings against live code.

## Verification baseline (all green at handoff)
`audit-braintrust-emits.sh` = 4/4 · `hook-manifest-check.mjs` exit 0 (UPS 13, PostToolUse 27, no missing dist) · memory-sanitize 12/12 · agent-recall-injector 30/30.
