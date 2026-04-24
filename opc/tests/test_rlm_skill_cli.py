"""Tests for .claude/skills/rlm-analyze/cli.py file-gathering logic.

Only exercises _gather() -- subprocess wiring is out of scope (tested by
running the skill end-to-end in verification).
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

# Load the skill cli module from its non-package path
_REPO_ROOT = Path(__file__).resolve().parents[2]
_SKILL_CLI = _REPO_ROOT / ".claude" / "skills" / "rlm-analyze" / "cli.py"


def _load_skill_cli():
    spec = importlib.util.spec_from_file_location("rlm_analyze_cli", _SKILL_CLI)
    assert spec and spec.loader, f"cannot load spec from {_SKILL_CLI}"
    mod = importlib.util.module_from_spec(spec)
    sys.modules["rlm_analyze_cli"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_gather_skips_binaries_and_dotdirs(tmp_path):
    """_gather walks a directory, skipping .git/node_modules/__pycache__ and
    binary-suffix files, banners each included file, and returns file list.
    """
    (tmp_path / "keep.py").write_text("print('keep me')\n", encoding="utf-8")
    (tmp_path / "README.md").write_text("# docs\n", encoding="utf-8")

    # Should be skipped: dot-dirs
    (tmp_path / ".git").mkdir()
    (tmp_path / ".git" / "config").write_text("[core]\n", encoding="utf-8")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "mod.js").write_text("x", encoding="utf-8")
    (tmp_path / "__pycache__").mkdir()
    (tmp_path / "__pycache__" / "foo.pyc").write_text("", encoding="utf-8")
    (tmp_path / ".next").mkdir()
    (tmp_path / ".next" / "build.json").write_text("{}", encoding="utf-8")

    # Should be skipped: binary suffixes
    (tmp_path / "image.png").write_text("png-bytes", encoding="utf-8")
    (tmp_path / "archive.zip").write_text("zip-bytes", encoding="utf-8")
    (tmp_path / "lib.dll").write_text("dll-bytes", encoding="utf-8")

    mod = _load_skill_cli()
    corpus, included = mod._gather(tmp_path, max_bytes=10 * 1024 * 1024)

    included_names = {Path(p).name for p in included}
    assert "keep.py" in included_names
    assert "README.md" in included_names

    # Nothing from skip_dirs should be included
    assert "config" not in included_names
    assert "mod.js" not in included_names
    assert "foo.pyc" not in included_names
    assert "build.json" not in included_names

    # Binary files skipped by extension
    assert "image.png" not in included_names
    assert "archive.zip" not in included_names
    assert "lib.dll" not in included_names

    # Banner format present
    assert "=====" in corpus
    assert "keep.py" in corpus
    assert "print('keep me')" in corpus


def test_gather_respects_max_bytes_cap(tmp_path):
    """When concatenated content would exceed max_bytes, _gather stops
    adding files. The returned corpus fits within max_bytes."""
    # Each file is ~1000 bytes of content plus ~40 bytes of banner
    payload = "A" * 1000
    for i in range(10):
        (tmp_path / f"file-{i:02d}.txt").write_text(payload, encoding="utf-8")

    mod = _load_skill_cli()
    # Cap at ~3 files worth
    max_bytes = 3500
    corpus, included = mod._gather(tmp_path, max_bytes=max_bytes)

    assert len(corpus.encode("utf-8")) <= max_bytes
    # With a small cap we must truncate -- fewer than 10 files
    assert 0 < len(included) < 10
