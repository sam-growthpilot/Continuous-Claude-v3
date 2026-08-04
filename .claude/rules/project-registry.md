# Project Registry

A centralized project registry exists at `.claude/project-registry.json` in the **continuous-claude repo (canonical copy)**, mirrored to `~/.claude/project-registry.json` by `sync-to-active.sh`. Use it when you need project paths, ports, URLs, stack info, or dev commands.

## Quick Reference

**Read the JSON — do not rely on a table here.** A hardcoded quick-reference table previously rotted 8 projects behind reality and was removed 2026-07-15. Illustrative examples of the entry shape (see the project-registry skill for the full schema): ExampleApp → port 3002, https://exampleapp.localhost/; gong-mcp → port 8000 (mcp-server, non-web).

## Usage

- Read the repo `.claude/project-registry.json` for structured data (the `~/.claude/` copy is a read-only mirror)
- Use the `project-registry` skill for interactive queries: "what port does ExampleApp use?"
- Update the REPO copy only, via single-process atomic read-modify-write (see the skill); the sync script propagates it

## Keeping in Sync

- The mirror syncs automatically on commit (post-commit `--changed` sync) or via `bash scripts/sync-to-active.sh`
- `exampleapp-local-dev.md` carries a ExampleApp-specific URL reference — check it if that project's URL changes
