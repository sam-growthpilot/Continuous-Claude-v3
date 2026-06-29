# Next-Session Plan — ST-05 + S2/S3 backlog (post review-remediation)

> Branch `snapshot/ccv3-system-update`, tip `39379ac`. Read first:
> [`../HANDOFF-2026-06-29-review-remediation.md`](../HANDOFF-2026-06-29-review-remediation.md).
> The 4 review-found S1 SAFE gaps are fixed + live. This plan covers what remains.
>
> **Run Phase 0 (the F4 gate smoke test) FIRST, in DEFAULT (non-bypass) mode.** Everything
> else can run in any mode. Per-fix protocol: TDD (write failing test → implement → run the
> ONE test file) → `cd .claude/hooks && npm run build` → `bash scripts/audit-braintrust-emits.sh`
> (must be `Found: 4 | Invariant: 4`) → commit with **`git commit -F <file>`** (NEVER backtick
> `-m` — see the incident in the handoff) → sync the changed dist to active → push `fork`.

## Phase 0 — F4 interactive-gate smoke test ✅ DONE 2026-06-29 (default mode)

The destructive-command-guard returns `permissionDecision: 'ask'` interactively. We needed to
confirm that `ask` actually surfaces a prompt and isn't swallowed by `permission-auto-allow`.

**Result: PASS.** Ran `git clean -fdn` in a default-mode session; a permission PROMPT appeared
(not a silent auto-approve) and the command completed with no output (no untracked files; `-n`
is dry-run). This also confirms the F3 split-flag fix (`-fdn`). SAFE fully confirmed for the
interactive path — no deeper `permission-auto-allow` / PermissionRequest fix needed.

## Phase 1 — Quick S2 hardening ✅ DONE 2026-06-29

Shipped: `09ba655` (agent-error-capture fire-and-forget + tightened trigger), `5a9abe5`
(destructive-guard wrapper/substitution recursion + xargs rm), then a white-box adversarial
verify sweep → round-2 remediation `3707420` (guard FPs fixed: `rm --force`/`git rebase
--abort`/`git branch -d`/`shred`-as-arg; + new coverage: rsync --delete, find -execdir, git
push --mirror/:refspec, git restore/switch/worktree, Windows rd/del, wipefs/blkdiscard,
env -i prefix; + documented accepted limitations) and `a2b211f` (capture crash-regex +
ECONNRESET). All tested, emit 4/4, LIVE-verified. Original sub-items (now done) below.

## Phase 1 (original sub-items — all addressed above)

1. **agent-error-capture → fire-and-forget** (USABLE; review S2). QW-04 made it live on every
   Task completion with a synchronous 10s-timeout store to archival_memory. Make the store
   detached/async (don't block Task completion) and tighten the error-pattern gating so it
   doesn't pollute recall. File: `.claude/hooks/src/agent-error-capture.ts`.
2. **destructive-guard coverage gaps** (SAFE; review S2). Either recurse the classifier into
   `bash -c "…"` / `sh -c "…"` / `powershell -Command "…"` payloads (the quote-strip blind
   spot — same class as the commit-message backtick incident), or document it explicitly as
   accepted. Add `find … | xargs rm` and remaining split-flag git/docker forms. Extend
   `destructive-command-guard.test.ts`. File: `.claude/hooks/src/destructive-command-guard.ts`.

## Phase 2 — ST-05 resident recall daemon ✅ SHIPPED + VERIFIED 2026-06-29

Done: `/plan` → `/premortem` (Codex, 9 findings folded into v2) → implement (kraken Python
layer + orchestrator TS layer) → end-to-end verified on the live daemon. Commits `a9dd226`
(Python recall op + query_vector seam), `624c876` (TS probeDaemon + recallViaDaemon +
memory-awareness routing), `31ffd8d` (live-script import fix the e2e gate caught). Warm
recall **136ms** (was ~10s), daemon ids == uv ids exactly, emit 4/4. Full record +
premortem v2 + the import-fix lesson in [`ST-05-DESIGN.md`](./ST-05-DESIGN.md). Original
arc notes below.

## Phase 2 (original arc notes — completed above)

**Why:** the only path to the USABLE ≤3s target. The memory hot-path is ~10s because
`memory-awareness.checkDbMemory` spawns `uv run python recall_learnings.py` per prompt
(~4-10s uv+python+psycopg boot). The BGE embedding daemon already keeps the MODEL resident
for embeds; ST-05 makes the whole RECALL path resident too. Prereq for ST-03 + ST-10.

Recommended approach — **extend the existing embedding daemon** (don't build a sibling):
1. **Research** the current daemon: `opc/scripts/core/` (embedding daemon + `recall_learnings.py`
   hybrid RRF), `~/.claude/run/ccv3-embedding.json`, and `shared/embedding-client.ts` /
   `shared/daemon-client.ts`. Confirm the daemon's socket/lifecycle/health-probe pattern.
2. **Design:** add a `recall` op to the resident daemon that runs the full hybrid query
   (embed + pgvector + FTS + RRF + cosine gate) in-process, holding a persistent psycopg
   connection — returns the same shape `recall_learnings.py --json` does today.
3. **Client:** `recallViaDaemon(query)` in the embedding/recall client; `memory-awareness`
   routes `checkDbMemory` through it when the daemon is ready. **Keep** the `uv run --text-only`
   fallback + fire-and-forget warm when the daemon is cold (no recall regression).
4. **Premortem (Codex):** corpus staleness (daemon must see new learnings), connection leaks,
   cold-start, multi-session concurrency on one daemon, the BGE-model/dim invariant
   (`BAAI/bge-large-en-v1.5`, 1024 — never change).
5. **Implement (kraken/TDD)** → **verify:** warm hot-path ≤3s, recall quality identical to the
   `uv run` path (same RRF), emit invariant 4/4, MEMORY MATCH still fires.

This is a structural arc: do it as its own `/plan` → `/premortem` → `/ralph` or a Workflow,
not a quick edit.

## Phase 3 — S3 polish + regression insurance

1. **Integration test for the 12 revived Task hooks** (review's missing regression insurance):
   replay representative PreToolUse:Task + PostToolUse:Task events through each, asserting no
   malformed output, nonzero exit, or latency-budget breach.
2. **settings-template-validation.test.ts:** add assertions that each registered hook's
   event+matcher matches active (not just that the dist exists).
3. **Dead-code + docs:** remove the now-unreferenced `checkLocalMemory` definition from
   `memory-awareness.ts`; fix the `memory-sanitize` header ("Both injection sites" → 5);
   rename/clarify `agent-model-guard` (it is the chain's hard-deny existence guard).

## Sequencing

**Phases 0, 1, 2, 3 are DONE (2026-06-29).** Phase 3 shipped: 3a `task-hooks-integration.test.ts`
(14 Task-matcher hooks, 18/18) + 3b settings event+matcher contract (`90f8d7a`); 3c dead-code
(checkLocalMemory + LOCAL_SCORE_NORMALIZE) + memory-sanitize header (6 sites) + agent-model-guard
misnomer note (`44c2653`). Remaining for next session:
- **host-memory-pressure RESTORE** (investigated 2026-06-29 → it is a REGRESSION, not aspirational):
  `d71e9ad` shipped the feature — `shared/host-ram.ts` probe (STILL PRESENT; its 22 tests PASS) +
  ~119 lines of wiring in `memory-awareness.ts`; the wiring was lost in a later overwrite (no
  intentional-removal commit). Restore = re-wire the surviving probe, INTEGRATED with ST-05's new
  `probeDaemon` flow (skip probe/recall → text-only when free RAM is low) + re-add the
  `host_memory_pressure`/`free_ram_bytes`/`embed_fallback_reason` log fields so the 3 RED
  `memory-awareness-host-ram.test.ts` go green.
- **tldr-context-inject latency** (NEW, found by 3a): runs a ~10-15s `tldr structure` on EVERY Task
  spawn (occasionally >15s). QW-04 put it on the Task matcher deliberately (Agent→Task rename), so
  it IS per-agent context injection — decide if it's worth the cold start: cache the result, route
  through a resident tldr daemon, or narrow the matcher. Documented in the 3a test (FINDING + 20s budget).
- **SG-01**: re-baseline memory hit-rate now that recall is resident. Revisit ST-03/ST-10 (ST-05 prereq).
