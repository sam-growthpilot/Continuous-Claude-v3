# Bootstrap: Continuous Claude

> Point Claude Code at this file on a new machine. It contains everything needed to set up the full system.

## Prerequisites

| Tool | Verify | Install |
|------|--------|---------|
| Docker Desktop | `docker --version` | docker.com |
| Node.js 18+ | `node --version` | nodejs.org |
| Python 3.12+ | `python --version` | python.org |
| uv | `uv --version` | `pip install uv` or `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Git | `git --version` | git-scm.com |

## Quick Start

```bash
git clone https://github.com/sam-growthpilot/Continuous-Claude-v3.git continuous-claude
cd continuous-claude

# Snapshot your existing settings FIRST — the wizard overwrites settings.json
# unconditionally (claude_integration.py has no exists-check on that file).
cp ~/.claude/settings.json ~/.claude/settings.json.mine 2>/dev/null || true

# Snapshot your plugins too. install_opc_integration() rmtree's ~/.claude/plugins
# and replaces it with the repo's (braintrust-tracing only) — see the warning below.
# Guarded because `cp -R src dst` nests into dst when dst already exists.
[ -e ~/.claude/plugins.pre-wizard ] || cp -R ~/.claude/plugins ~/.claude/plugins.pre-wizard

cd opc && uv run python -m scripts.setup.wizard
cd ..

# Layer your model/theme/voice/plugin/env preferences back on top of the
# wizard's hook registrations. Idempotent — safe to re-run any time.
node scripts/merge-settings.mjs \
  --mine ~/.claude/settings.json.mine \
  --theirs ~/.claude/settings.json \
  --out ~/.claude/settings.json

# Restore your plugins, keeping the framework's braintrust-tracing alongside them.
# Copy INTO the wizard's dir rather than swapping the whole thing, so both survive.
cp -R ~/.claude/plugins.pre-wizard/. ~/.claude/plugins/
```

Then run `/reload-plugins` in Claude Code (no restart needed) and confirm your
plugin count is back to what it was.

> Your `permissions` live in `settings.local.json`, which the wizard never
> touches — no action needed there.

### Why the plugins step is separate

The wizard takes a full `~/.claude` backup at Step 0 (`wizard.py:773`), so nothing
is *unrecoverable* — but plugins are the one thing its own merge logic will not
bring back. `install_opc_integration()` merges non-conflicting **hooks, skills,
rules, and MCP servers** from your old config (`claude_integration.py:570-602`);
`plugins` is not in that list. It only gets the `rmtree` + `copytree` at
`claude_integration.py:520-523`.

The guard on all seven `rmtree` calls tests whether the **repo** has the source
directory, never what the **target** contains — so this repo shipping a nearly
empty `plugins/` is enough to remove every marketplace plugin you have installed,
along with `installed_plugins.json` and `known_marketplaces.json` (the registry
Claude Code reads to know anything is installed at all).

`~/.claude/skills` is wiped the same way, but *is* covered by the merge, so it
should come back on its own. Verify rather than assume.

The wizard handles:
- Docker PostgreSQL + pgvector container (4 tables, idempotent schema)
- Hook installation + TypeScript build (112 source hooks compiled to dist/*.mjs)
- Skills (133), agents (43), rules (45) installed to `~/.claude/`
- CLAUDE.md and RULES.md behavioral config from templates
- Environment variables (`CLAUDE_OPC_DIR`, `PYTHONUTF8=1` on Windows)
- Git post-commit hook for automatic repo-to-active sync
- `settings.json` generated with correct local paths from template

Counts above were re-derived 2026-08-04 — don't trust them after any bulk change,
re-derive:

```bash
for d in .claude/skills/*/; do [ -f "$d/SKILL.md" ] && echo "$d"; done | wc -l  # skills
ls .claude/agents/*.md | wc -l                                                  # agents
ls .claude/rules/*.md | wc -l                                                   # rules
ls .claude/hooks/src/*.ts | wc -l                                               # hooks
```

The skills count deliberately excludes nested `SKILL.md` files — a bare
`find .claude/skills -name SKILL.md` returns 161, but 28 of those live under
`archive/`, `.archive/`, `_eval/`, `_sandbox/`, or are double-nested
(`railway-cli/railway-cli/`, `neonctl/neonctl/`).

> **Windows users**: Open a **new terminal** after the wizard completes. `setx` sets permanent environment variables but they are not available in the current terminal session.

## Post-Setup Verification

```bash
# Docker running
docker ps | grep continuous-claude-postgres

# Hooks compiled
ls ~/.claude/hooks/dist/*.mjs | wc -l  # Expect 90+

# Behavioral config exists
ls ~/.claude/CLAUDE.md ~/.claude/RULES.md

# Environment set
echo $CLAUDE_OPC_DIR  # Should point to <repo>/opc

# Memory system works
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "test" --k 1 --text-only
```

## What The System Provides

- **Persistent memory** -- PostgreSQL + pgvector semantic search across sessions
- **95+ hook source files** -- auto-inject context, enforce patterns, track state
- **40+ specialized agents** -- scout, kraken, architect, debug-agent, oracle, etc.
- **150+ skills** -- /build, /fix, /explore, /ralph, /maestro workflows
- **Cross-session continuity** -- handoffs, knowledge trees, ROADMAP tracking
- **Auto-sync** -- git commits in the repo auto-deploy to ~/.claude/

## DevOps Integration (Step 4b)

The wizard will prompt for optional DevOps tool setup:

**Linear** (issue tracking):
- CLI: `linearis` for scripted automation, `linear-cli` for interactive
- MCP: Remote server at `https://mcp.linear.app/mcp` (OAuth)
- Env vars: `LINEAR_API_TOKEN`, `LINEAR_WORKSPACE`

**Sentry** (error monitoring):
- CLI: `sentry-cli` for releases, source maps, error queries
- MCP: Remote server at `https://mcp.sentry.dev/sse` (OAuth)
- Env vars: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`

**Playwright CLI** (E2E testing):
- CLI: `@playwright/cli` for token-efficient browser automation
- Always installed — core to the QA workflow

## Supply Chain Security

A `package-install-guard` hook intercepts all package install commands and checks:
1. Typosquat detection (local curated list)
2. Known-malicious blocklist (auto-updated daily)
3. OSV.dev real-time query (malware advisories)
4. Package age check (blocks <24h old packages)

## Architecture

```
continuous-claude/              # Git repo (source of truth)
+-- .claude/
|   +-- hooks/src/*.ts          # 95 hook source files (TypeScript)
|   +-- hooks/dist/*.mjs        # Compiled hooks (esbuild output)
|   +-- skills/                 # 150+ skill definitions
|   +-- agents/                 # 50 agent configs (.md + .json)
|   +-- rules/                  # 28 operational rules
|   +-- settings.json.template  # Hook registrations (templated)
|   +-- templates/              # CLAUDE.md.template, RULES.md.template
+-- opc/                        # Operations & Python scripts
|   +-- scripts/setup/          # Wizard, docker setup, integration
|   +-- scripts/core/           # Memory, knowledge tree, learnings
|   +-- .env                    # Local config (generated by wizard)
+-- docker/
|   +-- docker-compose.yml      # PostgreSQL + pgvector
|   +-- init-schema.sql         # 4 tables: sessions, file_claims,
|                                 archival_memory, handoffs
+-- scripts/
    +-- sync-to-active.sh       # Forward sync: repo -> ~/.claude
    +-- post-commit-hook.sh     # Auto-sync on git commit

~/.claude/                      # Active directory (not in git)
+-- CLAUDE.md                   # Behavioral config
+-- RULES.md                    # Constraints & enforcement
+-- settings.json               # Hook registrations (local paths)
+-- hooks/dist/*.mjs            # Compiled hooks
+-- skills/, agents/, rules/    # Copied from repo
```

## Daily Workflow

After setup, sync is automatic:
1. Edit files in `continuous-claude/` repo
2. `git commit` triggers post-commit hook
3. Hook runs `sync-to-active.sh` -- copies to `~/.claude/`
4. Hooks are rebuilt automatically

Manual sync: `bash scripts/sync-to-active.sh`

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Hooks not firing | `cd ~/.claude/hooks && npm run build` |
| Memory recall fails | Check `echo $CLAUDE_OPC_DIR`; check Docker running |
| Knowledge tree missing | `cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/knowledge_tree.py --project <dir>` |
| Python encoding crash (Windows) | Set env var: `PYTHONUTF8=1` |
| settings.json wrong paths | Re-run wizard or regenerate from `.claude/settings.json.template` |
| Hooks stale after source edit | `cd ~/.claude/hooks && npm run build` then restart session |

## Windows-Specific Notes

- Use `python` not `python3` (triggers Microsoft Store on Windows)
- Set `PYTHONUTF8=1` as permanent user environment variable
- Git Bash paths need drive letter: `C:/Users/...` not `/Users/...`
- MCP server configs with `npx` require `cmd /c` wrapper
- Never use Edit tool on `~/.claude.json` (race condition with Claude Code writes)

## For Claude Code on a New Machine

If you are Claude Code reading this after a fresh clone:
1. Run the wizard: `cd opc && uv run python -m scripts.setup.wizard`
2. Verify with the post-setup checks above
3. Read `~/.claude/CLAUDE.md` for behavioral instructions
4. Read `~/.claude/RULES.md` for constraints and enforcement
5. Read `docs/ARCHITECTURE.md` for full system documentation
6. Run `/help` skill for interactive discovery of available commands
