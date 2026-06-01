# CCv3 Hardening — State + Next Items (2026-06-01)

**Read order for a continuing session:** this file (current state) -> `docs/ccv3-hardening-progress-2026-05-31.md` (Session 1-3 detail + the 6 hard gates) -> `docs/ccv3-hardening-handoff-2026-05-30.md` (the original 3-workstream plan) -> `docs/ccv3-lean-audit-2026-05-30.md` (the audit).

---

## Where we are

The **Phase 0-3 tier** of the hardening program is **functionally complete**. Item 4 (P3 dead-weight) shipped this session; only Item 6 (PageIndex, telemetry-gated) remains inside that tier. The larger WS-0.1 / WS-1 / WS-2 arc from the original handoff was deliberately scoped OUT of this tier and is the open strategic backlog (below).

**Git:** 10 commits this session, `cc1ec7f..99c7543`, **pushed to `fork` (Rev4nchist/Continuous-Claude-v3)**. `fork/main == HEAD == 99c7543`. Remotes: `origin` = parcadei (NEVER push), `fork` = Rev4nchist (push target).

**Verification baseline (green):** `audit-braintrust-emits.sh` 4/4 · `hook-manifest-check.mjs` OK (no missing dist) · `npm run build` clean · the 4 live systems (session-start-continuity, skill-activation, TLDR, system-coherence) all ran green.

## Shipped this session (2026-06-01)

| Commit | What |
|---|---|
| `f65837e` | Deleted 8 tracked dead files (3 `.bak`/`.backup`, `skill-rules.json.backup`, dead `session-start-tldr-cache` hook src+dist+test); dropped that hook from `system-coherence-stress.mjs` array |
| `0264da3` | Archived 8 dead-weight skills (skill-creator, create-better-skills, claude-in-chrome, agentica-{claude-proxy,infrastructure,server}, wiring, tdd-migration-pipeline) -> gitignored `skills/archive/` |
| `d7d1ae3` `f196ac1` | **Excalidraw skill repaired** (not archived): port reconciled 3000/3002 -> **3100**; eval status fail->pass; live smoke test PASS; canvas start-command documented |
| `04117cc` | Removed 3 vibe-trading agent dupes from global (byte-identical to `Projects/vibe-trading/.claude/agents/`) |
| `a233a43` | Dropped 14 broken `math/*` routings from `skill-rules.json` (skills live archived) |
| (active-only) | MCP cleanup: `~/.mcp.json` next-devtools removed; `~/.claude/mcp.json` trimmed to **excalidraw + exa**; idearalph removed |
| `5041628` | Vendored official `vercel-labs/next-skills` (next-best-practices/cache-components/upgrade) as real dirs in `.claude/skills/`; gitignored `.agents/` mirror |
| `9d7e91e` | `init-project` Phase 4.5: project-scoped `next-devtools-mcp` for future Next.js 16+ projects |
| `99c7543` | `/review` follow-up: closed 3 dangling refs (cheatsheet port, settings.json.template dead-hook reg, vet-skill -> skill-forge) |

Also did a `/review` (4 reviewers) of the whole sweep -> verdict **APPROVE** + the 3 dangling-ref fixes above.

## Open items (prioritized)

1. **Repair the Codex CLI** -> see `docs/codex-cli-repair-handoff-2026-06-01.md`. `codex --version` hangs in both shells; `/review` + `/premortem` have **no cross-model lift** until fixed. After the fix, correct the stale claims in `codex-adversarial.md` (CLI version, auth model) + `cli-integration-strategy.md` (Codex version). **This is the next planned session.**

2. **Item 6 — PageIndex keep-vs-archive** (the last Phase 0-3 item). DEFERRED pending `.claude/logs/pageindex-nav.jsonl` hit-vs-fallback telemetry (the navigator was instrumented in Step 3). Once enough prompts have accrued: if it always static-falls-back, archive the homegrown PageIndex pillar (~7,100 LOC + 4 hooks); if it's used, keep + improve.

3. **Reference-cleanup tail from `/review`** (non-blocking doc-rot; the genuinely-broken 3 were already fixed in `99c7543`):
   - `.codex/` UNTRACKED local mirror still has the dead `session-start-tldr-cache` hook (src+dist+`.sh` + `hooks.json:336` registration) and a `wiring` route in `.codex/hooks/src/path-rules.ts:52`. Local-only; clean on this machine if `.codex/` is active.
   - Doc visualizations / inventories still list removed items: `docs/architecture/system-visualization/{hooks,agents}-visualization.html`, `.claude/docs/architecture/quick-ref/hook-catalog.md`, `docs/skills/README.md`, `docs/agent-skill-map.md`, `.claude/skills/tldr-code/SKILL.md`, `SYSTEM-ROADMAP.md`. Regenerate `knowledge-tree.json` (it references `create-better-skills.bak` archive paths).
   - `shadcn-create`/`agent-browser` SKILL.md use the still-live but **deprecated** `mcp__claude-in-chrome__*` tools -> a Playwright-MCP migration is a separate task (NOT a sweep break; the tools work).

4. **Strategic backlog (WS-0.1 / WS-1 / WS-2)** from `docs/ccv3-hardening-handoff-2026-05-30.md` §2-3, scoped out of the Phase 0-3 tier. Re-decide after re-measuring. The 6 hard gates still apply if resumed:
   - **WS-0.1** session-id consolidation -> `shared/session-bus-id.ts` **with the `file_claims` migration / dual-read** (Gate G5; 6,720 live rows). Carries the Windows `USERPROFILE`/`cwd_inode` fixes (findings #11/#12).
   - **WS-1 P1** per-prompt hot-path prune (merge the 3 Ralph UPS hooks; early-exit sentry/braintrust) — must precede WS-2 Phase A (Gate G2).
   - **WS-2** context-bus spine (Phases A-E) — the v3 "Cohesive Intelligence" substrate. Biggest effort; gated; standalone value at A or B.5.

5. **Codex telemetry honesty:** the `/review` codex-lift row for 2026-06-01 should record **codex_only = 0 (CLI down)** so the cross-model-lift metric isn't inflated by a non-functional pass.

## Operational notes carried forward

- Per-step commits with explicit `-- <pathspec>`; `rm -f .git/index.lock && git commit -- <paths>` in one Bash call (a `git-auto-commit` hook intermittently leaves a stale lock). Don't parallelize a git commit with an Agent call.
- `skills/archive/` and `.agents/` are **gitignored**; archival = `git rm` from the tracked tree (recoverable via history) + local copy in the ignored dir. `git mv` into a pre-existing archive dir NESTS — rebuild flat from the active copy.
- Editing active `~/.claude/{rules,docs,...}` triggers a `~/.claude` auto-commit -> forward-sync churn (harmless; the dangerous reverse-clobber is closed). Prefer editing repo files where the change has a repo home.
- `settings.json` (active) is NOT in the repo and is ahead of repo `.claude/settings.json`; hook-registration changes must hit BOTH. `_eval-progress.json` IS repo-tracked.
- New-machine setup reads `.claude/settings.json.template` (now clean of the dead tldr-cache hook) via `wizard.py`.
