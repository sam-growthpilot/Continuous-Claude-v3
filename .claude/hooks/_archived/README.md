# Archived Hooks

Non-destructive archive of hook artifacts that are no longer wired but may be
revived. Each subdirectory is a dated batch with its own README explaining what
was archived and why.

## Why archive instead of delete?

Several hooks here are early prototypes for features that have since become
official Claude Code capabilities (e.g., the v4 swarm/subagent hooks prefigure
the `Agent Teams` API at https://code.claude.com/docs/en/agent-teams). Keeping
the source preserves the design history and makes future revival a `git mv`
instead of a digital archeology project.

## Build & sync isolation

The `_archived/` tree is invisible to:

- **esbuild** — uses top-level `src/*.ts` glob (does not recurse into
  `src/_archived/`)
- **sync-to-active.sh** — uses `hooks/dist/*.mjs` and `hooks/*.{sh,py,mjs,ps1}`
  globs (does not recurse into `hooks/_archived/`)
- **`scripts/audit_hook_state.mjs`** — explicitly excludes `_archived` from
  `EXCLUDE_SRC_DIRS`

So an archived hook produces zero noise in audits, builds, syncs, or settings.

## Revival recipe

To put a hook back in service:

```bash
cd .claude/hooks/_archived/<date>-<group>
mv dist/*.mjs ../../dist/
[ -d src ] && mv src/*.ts ../../src/
cd ../../.. && npm --prefix .claude/hooks run build
```

Then re-register the hook in `~/.claude/settings.json` (see
`rules/hook-dev-lifecycle.md`).

## Index

| Date | Group | Reason |
|---|---|---|
| 2026-04-26 | `agent-teams-prototype/` | v4 swarm/subagent hook prototypes — superseded by official Claude Code Agent Teams API |
