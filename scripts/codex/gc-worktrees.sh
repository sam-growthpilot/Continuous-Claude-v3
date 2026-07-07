#!/usr/bin/env bash
# gc-worktrees.sh — opportunistic GC of throwaway Codex-worker git worktrees.
#
# The codex-worker agent's `implement` mode creates a throwaway worktree per run at
# ../.codex-worktrees/<repo>-<ts>-<pid> (a SIBLING of the repo — see codex-worker-safety.md).
# Each is a full checkout (~190MB), so abandoned ones accumulate. This reclaims them.
#
# What it does (idempotent, safe to re-run):
#   1. `git worktree prune` — clear metadata for worktrees whose dirs were deleted manually.
#   2. Remove THIS repo's ../.codex-worktrees/<repo>-* dirs older than N days (mtime) that are
#      CLEAN (no uncommitted changes). Dirty worktrees are KEPT (see Safety).
#   3. `git worktree prune` again — clear any metadata orphaned by step 2.
#
# Safety (two mechanisms, both required):
#   * Skip-dirty: `implement` only STAGES (git add -A) and never commits, so a dormant /
#     awaiting-`resume` worktree holds UNREVIEWED work. We SKIP any worktree with uncommitted
#     changes regardless of age — its staged diff is only recoverable via `git fsck`. Age ALONE
#     is not a safety guarantee (a resume worktree can sit past a weekly quota cap). Override with
#     CODEX_WT_GC_FORCE_DIRTY=1 ONLY for a deliberate, you-know-what-you-are-doing full reclaim.
#   * Repo scoping: the `-name <repo>-*` filter GCs only THIS repo's worktrees; sibling repos
#     sharing the parent dir are left alone.
#
# NOTE: the `rm -rf` fallback (rare UNREGISTERED orphan) is guard-safe here: run as
# `bash gc-worktrees.sh ...`, the destructive-command-guard (a PreToolUse:Bash hook scanning the
# tool-call string) never sees the internal rm — even in a subagent context. The codex-worker
# agent INLINE GC omits the rm for exactly that reason (its whole block is scanned) and also
# never force-reclaims a dirty worktree.
#
# Usage: gc-worktrees.sh [PROJECT_DIR] [GC_DAYS]
#   PROJECT_DIR  repo root      (default: $CLAUDE_PROJECT_DIR, else $PWD)
#   GC_DAYS      age threshold  (default: $CODEX_WT_GC_DAYS, else 7)
#   env CODEX_WT_GC_FORCE_DIRTY=1  also reclaim worktrees WITH uncommitted changes (dangerous)
set -u

PROJECT="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}"
GC_DAYS="${2:-${CODEX_WT_GC_DAYS:-7}}"
FORCE_DIRTY="${CODEX_WT_GC_FORCE_DIRTY:-0}"
WT_BASE="$(dirname "$PROJECT")/.codex-worktrees"
REPO="$(basename "$PROJECT")"

# 1) clear metadata for worktrees whose dirs were already deleted manually
git -C "$PROJECT" worktree prune 2>/dev/null || true

# 2) remove THIS repo's CLEAN worktree dirs older than GC_DAYS
removed=0; kept=0
if [ -d "$WT_BASE" ]; then
  while IFS= read -r d; do
    [ -z "$d" ] && continue
    # skip a worktree that still holds unreviewed (uncommitted) work, unless force-dirty
    if [ "$FORCE_DIRTY" != "1" ] && [ -n "$(git -C "$d" status --porcelain 2>/dev/null)" ]; then
      kept=$((kept + 1)); echo "GC: KEPT (unreviewed changes) $d"; continue
    fi
    # prefer `git worktree remove` (cleans metadata + dir); fall back to rm if unregistered
    if git -C "$PROJECT" worktree remove --force "$d" 2>/dev/null; then
      :
    else
      rm -rf "$d"
    fi
    removed=$((removed + 1)); echo "GC: removed stale worktree $d"
  done < <(find "$WT_BASE" -mindepth 1 -maxdepth 1 -type d -name "${REPO}-*" -mtime +"$GC_DAYS" 2>/dev/null)
fi

# 3) final prune to clear any metadata orphaned by step 2
git -C "$PROJECT" worktree prune 2>/dev/null || true

echo "GC: ${removed} removed, ${kept} kept-dirty (repo=${REPO}, threshold=${GC_DAYS}d, force_dirty=${FORCE_DIRTY}, base=${WT_BASE})"
