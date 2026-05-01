"""Tests for lazy_tree.py - Phase 5 of CCv3 Memory Remediation Plan.

Verifies the file-deletion -> stale-marker conversion in invalidate_tree(),
plus content-aware stale detection in is_tree_stale() and get_tree().

Prior to the fix, invalidate_tree() called tree_path.unlink(), creating a
race window where a consumer could observe a missing tree.json. The TS
hook (tree-invalidate.ts) had already been converted to write a stale
marker; this brings the Python CLI path into alignment.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from unittest import mock

import pytest

# Ensure scripts/core is importable as a package via PYTHONPATH=opc
_CORE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_CORE_DIR))

import lazy_tree  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def project_with_tree(tmp_path):
    """Build a fake project directory with a populated knowledge tree on disk."""
    claude_dir = tmp_path / ".claude"
    claude_dir.mkdir(parents=True)
    tree_path = claude_dir / "knowledge-tree.json"
    payload = {
        "project": {"name": "test-project"},
        "components": [{"name": "alpha"}, {"name": "beta"}],
        "structure": {"directories": {"src": {}}},
    }
    tree_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return tmp_path, tree_path, payload


# ---------------------------------------------------------------------------
# invalidate_tree
# ---------------------------------------------------------------------------


def test_invalidate_tree_writes_stale_marker_in_place(project_with_tree):
    """invalidate_tree must preserve the file and merge a stale marker."""
    project_dir, tree_path, original = project_with_tree

    result = lazy_tree.invalidate_tree(str(project_dir))

    assert result is True, "invalidate_tree should report success"
    assert tree_path.exists(), "tree file must remain on disk after invalidation"

    after = json.loads(tree_path.read_text(encoding="utf-8"))
    assert after.get("_stale") is True
    assert "_invalidated_at" in after
    # Original payload is preserved so consumers can still read fallback data
    assert after.get("project") == original["project"]
    assert after.get("components") == original["components"]


def test_invalidate_tree_returns_false_when_missing(tmp_path):
    """No file -> no marker to write, return False without raising."""
    result = lazy_tree.invalidate_tree(str(tmp_path))
    assert result is False
    assert not (tmp_path / ".claude" / "knowledge-tree.json").exists()


def test_invalidate_tree_recovers_from_corrupt_json(tmp_path):
    """A corrupt tree should still get a stale marker written cleanly."""
    claude_dir = tmp_path / ".claude"
    claude_dir.mkdir()
    tree_path = claude_dir / "knowledge-tree.json"
    tree_path.write_text("not valid json {", encoding="utf-8")

    result = lazy_tree.invalidate_tree(str(tmp_path))

    assert result is True
    after = json.loads(tree_path.read_text(encoding="utf-8"))
    assert after == {"_stale": True, "_invalidated_at": after["_invalidated_at"]}


# ---------------------------------------------------------------------------
# is_tree_stale
# ---------------------------------------------------------------------------


def test_is_tree_stale_respects_content_marker(project_with_tree):
    """A fresh-mtime file with _stale=True must still report stale."""
    project_dir, tree_path, _ = project_with_tree

    # Sanity: a freshly written tree is NOT stale by mtime
    assert lazy_tree.is_tree_stale(str(project_dir)) is False

    # After invalidation, even though mtime is newer than 300s ago,
    # content marker forces stale=True
    lazy_tree.invalidate_tree(str(project_dir))
    assert lazy_tree.is_tree_stale(str(project_dir)) is True


def test_is_tree_stale_falls_back_to_mtime(project_with_tree):
    """Without a content marker, stale is decided by mtime age."""
    project_dir, tree_path, _ = project_with_tree

    old_mtime = time.time() - 1000  # 1000s old, well past 300s default
    import os
    os.utime(tree_path, (old_mtime, old_mtime))

    assert lazy_tree.is_tree_stale(str(project_dir), max_age_seconds=300) is True
    assert lazy_tree.is_tree_stale(str(project_dir), max_age_seconds=2000) is False


def test_is_tree_stale_when_missing(tmp_path):
    """Missing tree counts as stale."""
    assert lazy_tree.is_tree_stale(str(tmp_path)) is True


# ---------------------------------------------------------------------------
# get_tree (content-marker takes precedence over fresh mtime)
# ---------------------------------------------------------------------------


def test_get_tree_regenerates_when_marker_set(project_with_tree):
    """Fresh mtime + _stale marker -> regenerate path is taken."""
    project_dir, _tree_path, _ = project_with_tree
    lazy_tree.invalidate_tree(str(project_dir))

    sentinel = {"project": {"name": "regenerated"}, "components": []}
    with mock.patch.object(lazy_tree, "regenerate_tree", return_value=sentinel) as m:
        out = lazy_tree.get_tree(str(project_dir))
        assert out == sentinel
        m.assert_called_once()


def test_get_tree_serves_cached_when_fresh(project_with_tree):
    """No stale marker + fresh mtime -> read from disk, no regen call."""
    project_dir, _tree_path, original = project_with_tree

    with mock.patch.object(lazy_tree, "regenerate_tree") as m:
        out = lazy_tree.get_tree(str(project_dir))
        assert out["project"] == original["project"]
        m.assert_not_called()
