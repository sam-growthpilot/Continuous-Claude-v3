#!/usr/bin/env bash
# Post-commit hook: auto-sync continuous-claude repo to ~/.claude/
# Canonical source: scripts/post-commit-hook.sh
# Installed to .git/hooks/post-commit by the setup wizard (install-hooks.sh, install-only-if-absent).
# --changed: incremental sync of ONLY the files this commit touched (HEAD diff), NOT a full
#   .claude mirror (the full mirror is pathologically slow on Windows). The full mirror still
#   runs for manual sync / git-pull catch-up / fresh installs (`bash scripts/sync-to-active.sh`).

REPO_ROOT="$(git rev-parse --show-toplevel)"
SYNC_SCRIPT="$REPO_ROOT/scripts/sync-to-active.sh"

if [[ -f "$SYNC_SCRIPT" ]]; then
    echo "Syncing to ~/.claude (background)..."
    # Fire-and-forget: fully detach so the sync can't linger attached to the commit shell /
    # terminal or leak its output. The output redirect is the real fix for a lingering bg proc
    # on Windows Git Bash (frees the shell's stdout/stderr pipe); nohup survives shell exit;
    # disown drops it from the job table (best-effort — job control is off in a non-interactive
    # hook shell, hence the guard).
    nohup bash "$SYNC_SCRIPT" --changed >/dev/null 2>&1 & disown 2>/dev/null || true
fi
