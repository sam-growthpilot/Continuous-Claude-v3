# Reverse-Sync hooks/src Regression — Reproduced, Root-Caused & Caught Live (2026-05-31)

**Severity:** HIGH. The documented `hooks/src` regression vector (regressions #1–#9 per memory) reproduced this session. Caught mid-clobber, before any continuous-claude commit. Live runtime was never affected.

## TL;DR root cause (verified)

`~/.claude/.git/hooks/post-commit` (created Jan 30, predates the sync-script fixes) contains an **unguarded reverse mirror**:

```bash
SRC="$HOME/.claude"; DST="$HOME/continuous-claude/.claude"
cp -r "$SRC/rules/"*     "$DST/rules/"
cp -r "$SRC/hooks/src/"* "$DST/hooks/src/"   # <-- THE VECTOR
cp -r "$SRC/skills/"*    "$DST/skills/"
cp -r "$SRC/agents/"*    "$DST/agents/"
cp -r "$SRC/scripts/"*   "$DST/scripts/"
cd "$HOME/continuous-claude" && git add .claude/
```

No audit gate, no `hooks/src` exclusion. This is the **third copy** of the regression vector — the `.sh` (`sync-claude.sh`) and `.mjs` (`sync-to-repo.ts`) reverse-syncs were both fixed to exclude `hooks/src` (commit `ddc0641`), but **this git hook was never touched**.

## Exact causal chain (each step verified)

1. I edited active `~/.claude/RULES.md` + `~/.claude/docs/architecture/INDEX.md` (both tracked in the separate `~/.claude` git repo).
2. PostToolUse:Write|Edit → `git-auto-commit.mjs`: `isInClaudeDir`=true, tracked=true, **10-min debounce passed** (prior `~/.claude` commit was 14:38), `hasChanges`=true → `git add -A && git commit` in `~/.claude` → created commit **`dc43818` "Auto: 2026-06-01 00:36:45"** (UTC; = 19:36:45 CDT).
3. That commit fired `~/.claude/.git/hooks/post-commit` → `cp -r hooks/src` active→repo at **19:36:45** (all 200+ repo `hooks/src` files re-stamped within ~250ms; junk like `tmpclaude-*`, `.bak`, `malicious-packages.json` copied too — signature of a blind `cp -r`) → `git add .claude/` staged it.

## Exonerated (do NOT blame these)

- **`sync-claude.sh`** — `SYNC_DIRS="rules agents skills scripts docs"`; only copies top-level `hooks/*.{sh,py,mjs,ps1}`. Never touches `hooks/src`. Has an audit pre-flight gate.
- **`sync-to-repo.ts/.mjs`** — never ran: `shouldSync()` rejects `RULES.md` (NEVER_SYNC) and `INDEX.md`/`docs` (no pattern match). `~/.claude/.last-repo-sync` does not exist (it would write it on success).

## Evidence (verified, not inferred)

`memory-awareness.ts` `sanitizeMemoryContent` line-count:
| Location | Count | Meaning |
|---|---|---|
| HEAD (`df7ecad`) | 3 | correct — WS-0.2 fix committed this session |
| repo working tree (post-clobber, mtime 19:36:45) | 0 | **clobbered** |
| active `~/.claude/hooks/src` (mtime 2026-05-26, size identical to clobbered repo) | 0 | **stale source** |
| active `~/.claude/hooks/dist` (live runtime) | 3 | **fine** — running system protected |

`agent-recall-injector.ts` reverted the Phase-3 crown jewel: `tool_name !== 'Agent' && !== 'Task'` → `!== 'Task'`. Reflog clean (HEAD never moved). Only ~10 of the 200 copied `hooks/src` files differ from HEAD (the rest are byte-identical → no git diff, just new mtime).

## Why the audit-emit guard didn't catch it

`sync-claude.sh` has the audit pre-flight — but this `.git/hooks/post-commit` does NOT route through it. And the clobber preserved `await emitBraintrustScore`, so even if it had, `audit-braintrust-emits.sh` would stay 4/4. The guard checks the emit, not the sanitizer/agent-recall content.

## Clobbered set (10 files — all reverts of this session's committed work)

`memory-awareness.ts` (WS-0.2 sanitizer), `agent-recall-injector.ts` (+test) (Phase-3 crown jewel), `auto-build.ts` (re-adds deregistered auto-build), `pageindex-navigator.ts` (Step-3 CASUAL short-circuit), `ralph-watchdog.ts`, `sentry-error-context.ts` (Step-3 early-exits), `session-start-parallel.ts`, `session-start-recovery.ts`, `shared/session-id.ts`.

## Recovery (this session)

1. `git checkout HEAD -- .claude/hooks/src` — restore repo working tree + index (only the 10 differing files change; my settings/template/INDEX edits are outside `hooks/src` and untouched).
2. Refresh active `hooks/src` from repo via Bash `cp` (no Edit hook fires) — defuse the stale landmine.
3. Verify: emit-audit 4/4, memory-sanitize 12/12, agent-recall 30/30.

## Permanent fix

Neutralize `~/.claude/.git/hooks/post-commit` — remove the `cp -r hooks/src` line (minimal, matches the `ddc0641` remediation), OR route the whole hook through `sync-claude.sh --to-repo` (audited + already excludes `hooks/src`), OR disable the hook entirely (the `.mjs` + forward sync already cover propagation). This file is NOT git-tracked (lives under `.git/`), so editing it does not re-trigger the loop.
