#!/usr/bin/env bash
# gc-worktrees.sh — opportunistic GC of throwaway Codex-worker git worktrees.
#
# The codex-worker agent's `implement` mode creates a throwaway worktree per run at
# ../.codex-worktrees/<repo>-<ts>-<pid> (a SIBLING of the repo — see codex-worker-safety.md).
# Each is a full checkout (~190MB), so abandoned ones accumulate. This reclaims them.
#
# What it does (idempotent, safe to re-run):
#   1. `git worktree prune` — clear metadata for worktrees whose dirs were deleted manually.
#   2. For THIS repo's ../.codex-worktrees/<repo>-* dirs older than N days (mtime): if the worktree
#      is CONFIRMED CLEAN (see Safety), `git worktree remove --force` it (clears dir + metadata).
#      A dir that git can't remove is an unregistered ORPHAN — it is REPORTED, never auto-deleted.
#   3. `git worktree prune` again — clear any metadata orphaned by step 2.
#
# Safety (all three, by design):
#   * Skip-dirty, exit-code checked: `implement` only STAGES (git add -A) and never commits, so a
#     dormant / awaiting-`resume` worktree holds UNREVIEWED work. We reclaim ONLY a worktree whose
#     `git status --porcelain` EXITS 0 AND is empty. A broken/unreadable worktree (non-zero status)
#     is KEPT, never mistaken for clean. Age ALONE is not a safety guarantee (a resume worktree can
#     sit past a weekly quota cap). Override with CODEX_WT_GC_FORCE_DIRTY=1 ONLY for a deliberate,
#     you-know-what-you-are-doing reclaim of dirty *registered* worktrees.
#   * No recursive-delete: there is deliberately NO `rm -rf`. Removal is ONLY via
#     `git worktree remove --force` (needs valid worktree metadata). An unregistered orphan is
#     reported for manual review — auto-`rm -rf` here would route a recursive delete around the
#     destructive-command-guard (which only scans the Bash tool-call string), so we don't.
#   * Repo scoping: the `-name <repo>-*` filter GCs only THIS repo's worktrees; sibling repos
#     sharing the parent dir are left alone.
#   * Race note: the clean-check and the remove are adjacent but not atomic/locked. The 7-day age
#     filter is the practical mitigation — a worktree you are actively resuming is recent, so it is
#     never GC-eligible. The residual (resuming a >Nd-old dormant worktree at the exact instant GC
#     runs) is accepted as negligible rather than adding a lock to a backstop sweep.
#
# Usage: gc-worktrees.sh [PROJECT_DIR] [GC_DAYS]
#   PROJECT_DIR  repo root      (default: $CLAUDE_PROJECT_DIR, else $PWD)
#   GC_DAYS      age threshold  (default: $CODEX_WT_GC_DAYS, else 7)
#   env CODEX_WT_GC_FORCE_DIRTY=1  also reclaim DIRTY registered worktrees (dangerous)
set -u

PROJECT="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}"
GC_DAYS="${2:-${CODEX_WT_GC_DAYS:-7}}"
FORCE_DIRTY="${CODEX_WT_GC_FORCE_DIRTY:-0}"
WT_BASE="$(dirname "$PROJECT")/.codex-worktrees"
REPO="$(basename "$PROJECT")"

# 1) clear metadata for worktrees whose dirs were already deleted manually
git -C "$PROJECT" worktree prune 2>/dev/null || true

# 2) remove THIS repo's CONFIRMED-CLEAN worktree dirs older than GC_DAYS
removed=0; kept=0; orphans=0
if [ -d "$WT_BASE" ]; then
  while IFS= read -r d; do
    [ -z "$d" ] && continue
    # reclaim ONLY a confirmed-clean worktree: git status must EXIT 0 AND report no changes.
    if [ "$FORCE_DIRTY" != "1" ]; then
      st="$(git -C "$d" status --porcelain 2>/dev/null)"; rc=$?
      if [ "$rc" -ne 0 ] || [ -n "$st" ]; then
        kept=$((kept + 1)); echo "GC: KEPT (dirty or unreadable — status rc=$rc) $d"; continue
      fi
    fi
    # remove via git ONLY (no rm -rf). A failure means an unregistered orphan → report, don't delete.
    if git -C "$PROJECT" worktree remove --force "$d" 2>/dev/null; then
      removed=$((removed + 1)); echo "GC: removed stale worktree $d"
    else
      orphans=$((orphans + 1)); echo "GC: ORPHAN (unregistered — inspect + remove manually) $d"
    fi
  done < <(find "$WT_BASE" -mindepth 1 -maxdepth 1 -type d -name "${REPO}-*" -mtime +"$GC_DAYS" 2>/dev/null)
fi

# 3) final prune to clear any metadata orphaned by step 2
git -C "$PROJECT" worktree prune 2>/dev/null || true

echo "GC: ${removed} removed, ${kept} kept-dirty, ${orphans} orphan (repo=${REPO}, threshold=${GC_DAYS}d, force_dirty=${FORCE_DIRTY}, base=${WT_BASE})"
