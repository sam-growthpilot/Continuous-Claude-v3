#!/usr/bin/env python3
"""Lazy knowledge tree generation with caching.

Replaces the persistent tree daemon with on-demand generation.
Tree is regenerated only when:
1. File doesn't exist
2. File is stale (older than max_age_seconds)
3. Explicitly invalidated

Usage:
    from lazy_tree import get_tree, invalidate_tree

    # Get tree (generates if needed)
    tree = get_tree("/path/to/project")

    # Invalidate after significant changes
    invalidate_tree("/path/to/project")
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from knowledge_tree import generate_tree


def get_tree_path(project_dir: str) -> Path:
    """Get the knowledge tree path for a project."""
    return Path(project_dir) / '.claude' / 'knowledge-tree.json'


def get_tree(project_dir: str, max_age_seconds: int = 300) -> dict[str, Any] | None:
    """Get knowledge tree, regenerating if stale or missing.

    Args:
        project_dir: Path to project root
        max_age_seconds: Maximum age before regeneration (default 5 min)

    Returns:
        Knowledge tree dict, or None if generation fails
    """
    tree_path = get_tree_path(project_dir)

    # Check if tree exists and is fresh
    if tree_path.exists():
        try:
            content = tree_path.read_text(encoding='utf-8')
            tree = json.loads(content)
            # Content-based stale marker (set by invalidate_tree / TS hook)
            # takes precedence over mtime: a freshly-touched file may still be
            # logically stale if a watched source file changed.
            if isinstance(tree, dict) and tree.get("_stale"):
                return regenerate_tree(project_dir)
            age = time.time() - tree_path.stat().st_mtime
            if age < max_age_seconds:
                return tree
        except (OSError, json.JSONDecodeError):
            pass  # Regenerate on error

    # Regenerate tree
    return regenerate_tree(project_dir)


def regenerate_tree(project_dir: str) -> dict[str, Any] | None:
    """Force regeneration of knowledge tree.

    Args:
        project_dir: Path to project root

    Returns:
        New knowledge tree dict, or None on failure
    """
    project_path = Path(project_dir).resolve()
    tree_path = get_tree_path(project_dir)

    # Skip infrastructure directories
    home = Path(os.environ.get("HOME") or os.environ.get("USERPROFILE") or "").resolve()
    if home and (project_path == home / ".claude" or str(project_path).endswith("/.claude")):
        return None

    try:
        tree = generate_tree(project_path)

        # Ensure .claude directory exists
        tree_path.parent.mkdir(parents=True, exist_ok=True)

        # Write tree
        tree_path.write_text(json.dumps(tree, indent=2, ensure_ascii=False), encoding='utf-8')

        return tree
    except Exception as e:
        print(f"Failed to generate knowledge tree: {e}", file=sys.stderr)
        return None


def invalidate_tree(project_dir: str) -> bool:
    """Mark tree as needing regeneration via in-place stale marker.

    The next call to get_tree() will see the _stale flag and regenerate. The
    file is preserved on disk so consumers always have a fallback to read
    instead of a missing-file race window.

    Args:
        project_dir: Path to project root

    Returns:
        True if the stale marker was written, False if no tree existed
        or the write failed.
    """
    tree_path = get_tree_path(project_dir)

    if not tree_path.exists():
        return False

    invalidated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    try:
        existing = json.loads(tree_path.read_text(encoding='utf-8'))
        if not isinstance(existing, dict):
            existing = {}
    except (OSError, json.JSONDecodeError):
        existing = {}

    existing["_stale"] = True
    existing["_invalidated_at"] = invalidated_at

    try:
        tree_path.write_text(
            json.dumps(existing, indent=2, ensure_ascii=False),
            encoding='utf-8',
        )
        return True
    except OSError:
        return False


def is_tree_stale(project_dir: str, max_age_seconds: int = 300) -> bool:
    """Check if tree is stale or missing.

    Args:
        project_dir: Path to project root
        max_age_seconds: Maximum age before considered stale

    Returns:
        True if tree needs regeneration
    """
    tree_path = get_tree_path(project_dir)

    if not tree_path.exists():
        return True

    try:
        content = json.loads(tree_path.read_text(encoding='utf-8'))
        if isinstance(content, dict) and content.get("_stale"):
            return True
    except (OSError, json.JSONDecodeError):
        return True

    try:
        age = time.time() - tree_path.stat().st_mtime
        return age >= max_age_seconds
    except OSError:
        return True


def touch_tree(project_dir: str) -> bool:
    """Update tree modification time without regenerating.

    Useful to extend freshness after access.

    Args:
        project_dir: Path to project root

    Returns:
        True if touch succeeded
    """
    tree_path = get_tree_path(project_dir)

    if tree_path.exists():
        try:
            tree_path.touch()
            return True
        except OSError:
            return False

    return False


# CLI interface for hook integration
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Lazy knowledge tree management")
    parser.add_argument("command", choices=["get", "regenerate", "invalidate", "check"],
                       help="Command to run")
    parser.add_argument("--project", "-p", default=".",
                       help="Project directory (default: current)")
    parser.add_argument("--max-age", type=int, default=300,
                       help="Max age in seconds (default: 300)")
    parser.add_argument("--json", action="store_true",
                       help="Output as JSON")

    args = parser.parse_args()
    project = Path(args.project).resolve()

    if args.command == "get":
        tree = get_tree(str(project), args.max_age)
        if tree:
            if args.json:
                print(json.dumps(tree, indent=2))
            else:
                print(f"Tree loaded for: {tree.get('project', {}).get('name', 'unknown')}")
                print(f"Components: {len(tree.get('components', []))}")
                print(f"Directories: {len(tree.get('structure', {}).get('directories', {}))}")
        else:
            print("Failed to get tree", file=sys.stderr)
            sys.exit(1)

    elif args.command == "regenerate":
        tree = regenerate_tree(str(project))
        if tree:
            print(f"Regenerated tree for: {tree.get('project', {}).get('name', 'unknown')}")
        else:
            print("Failed to regenerate tree", file=sys.stderr)
            sys.exit(1)

    elif args.command == "invalidate":
        if invalidate_tree(str(project)):
            print("Tree marked stale (file preserved for fallback reads)")
        else:
            print("No tree to invalidate")

    elif args.command == "check":
        stale = is_tree_stale(str(project), args.max_age)
        if args.json:
            print(json.dumps({"stale": stale, "max_age": args.max_age}))
        else:
            print(f"Tree is {'stale' if stale else 'fresh'}")
        sys.exit(0 if not stale else 1)
