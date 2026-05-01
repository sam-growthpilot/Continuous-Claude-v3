# 2026-04-26 — Orphan Experiments Archive

13 hook bundles (`.mjs` only — no source) that were never registered in
`settings.json`, never imported by other hooks, and have no surviving `.ts`
source. Verified unwired against the active `~/.claude/settings.json` before
archiving (see audit doc `.claude/docs/hook-audit-2026-04.md` Group B).

## What's here

| Hook | Likely purpose | Notes |
|---|---|---|
| `auto-learning` | PostToolUse learning capture | Superseded by `periodic-extract` + L0 quality gate |
| `drift-detector` | Detect runtime/state drift | Probably an early `/sync-drift` skill prototype |
| `erotetic-clarification` | Question-driven clarification prompt | UX experiment |
| `failure-detection` | Generic failure pattern detector | Superseded by `agent-error-capture` |
| `post-tool-use` | Generic-name PostToolUse handler | Generic shadow; live PostToolUse hooks are 26 named files |
| `pre-tool-use` | Generic-name PreToolUse handler | Generic shadow; live PreToolUse hooks are 18 named files |
| `session-start-recall` | Pull memory on session start | Superseded by `session-start-memory-loaders` (Phase 4 plan) |
| `skill-context-inject` | Skill context injection | Overlaps with `skill-activation-prompt` (LIVE) |
| `spec-anchor` | PreToolUse spec anchor binding | Spec/PRD experiment |
| `spec-intent-detector` | UserPromptSubmit intent detection | Spec/PRD experiment |
| `tldr-rebuild-prompt` | PostToolUse TLDR cache rebuild prompt | Superseded by `tldr-context-inject` (LIVE) + daemon |
| `user-confirm-learning` | UserPromptSubmit learning confirmation | UX experiment |
| `working-on-sync` | Sync the "working on" status | Probably superseded by `heartbeat` (LIVE) |

## Why archived (not deleted)

Some of these (e.g., `spec-intent-detector`, `drift-detector`, `auto-learning`)
encode design ideas that may inform Phase 4 reliability work or future
features. Archiving keeps the bundle source available for reference.

## Caveats

- Bundles only — no `.ts` sources to revive directly. If you bring one back,
  expect to re-derive intent from the bundle.
- `pre-tool-use` and `post-tool-use` have generic names that *sound* like the
  hook events but are NOT registered. The live PreToolUse/PostToolUse hooks
  are entirely separate files (see `~/.claude/settings.json`).

## Revival

See `../README.md` for the standard revival recipe.
