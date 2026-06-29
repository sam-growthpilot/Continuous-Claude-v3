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

## Phase 1 — Quick S2 hardening (small, high-value; SAFE + USABLE)

1. **agent-error-capture → fire-and-forget** (USABLE; review S2). QW-04 made it live on every
   Task completion with a synchronous 10s-timeout store to archival_memory. Make the store
   detached/async (don't block Task completion) and tighten the error-pattern gating so it
   doesn't pollute recall. File: `.claude/hooks/src/agent-error-capture.ts`.
2. **destructive-guard coverage gaps** (SAFE; review S2). Either recurse the classifier into
   `bash -c "…"` / `sh -c "…"` / `powershell -Command "…"` payloads (the quote-strip blind
   spot — same class as the commit-message backtick incident), or document it explicitly as
   accepted. Add `find … | xargs rm` and remaining split-flag git/docker forms. Extend
   `destructive-command-guard.test.ts`. File: `.claude/hooks/src/destructive-command-guard.ts`.

## Phase 2 — ST-05 resident recall daemon (the big arc — own plan + premortem)

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

Phase 0 (gate test) → Phase 1 (quick S2) → Phase 2 (ST-05, the headline) → Phase 3 (polish).
Phases 0/1/3 are session-sized; Phase 2 (ST-05) likely spans its own focused session with a
premortem. After ST-05, re-baseline the memory hit-rate (SG-01) and revisit ST-03/ST-10.
