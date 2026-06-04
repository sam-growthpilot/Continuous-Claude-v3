"""Regression tests for the daemon discovery/lock path rendezvous.

Root cause (2026-06-03): the daemon derived its discovery + lock paths from
Python ``tempfile.gettempdir()`` (honors ``TMPDIR``) while the Node hook client
(``embedding-client.ts``) used ``os.tmpdir()`` (honors ``TEMP``, ignores
``TMPDIR``). In the Claude Code session ``TMPDIR != TEMP``, so the Node spawner
and the Python daemon read/wrote DIFFERENT files -> the spawner never saw the
daemon it started -> a thundering herd of husk daemons, and recall fell back to
the multi-second in-process embed.

The fix anchors both languages to one environment-independent location,
``~/.claude/run/``, which Node ``os.homedir()``, Python ``Path.home()``, and
PowerShell ``$HOME`` all resolve to ``USERPROFILE`` identically on Windows.

These tests run entirely offline -- no sockets, no PIDs, no daemon.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from scripts.core.embedding_daemon import (
    DAEMON_INFO_PATH,
    DAEMON_LOCK_PATH,
    _canonical_run_dir,
)

_EXPECTED_DIR = Path.home() / ".claude" / "run"


# ---------------------------------------------------------------------------
# 1 -- the constants live under ~/.claude/run/ (NOT a temp dir)
# ---------------------------------------------------------------------------

def test_discovery_path_is_under_claude_run() -> None:
    assert DAEMON_INFO_PATH == _EXPECTED_DIR / "ccv3-embedding.json"


def test_lock_path_is_under_claude_run() -> None:
    assert DAEMON_LOCK_PATH == _EXPECTED_DIR / "ccv3-embedding-daemon.lock"


# ---------------------------------------------------------------------------
# 2 -- the paths are NOT derived from tempfile.gettempdir() (the old bug).
#      In the Claude session TMPDIR puts gettempdir() under ...\Temp\claude;
#      the canonical path must not live there.
# ---------------------------------------------------------------------------

def test_paths_not_under_tempdir() -> None:
    tmp = Path(tempfile.gettempdir()).resolve()
    # The canonical dir must not be inside the process temp dir.
    assert tmp not in _canonical_run_dir().resolve().parents
    assert _canonical_run_dir().resolve() != tmp


# ---------------------------------------------------------------------------
# 3 -- ENV INDEPENDENCE: mutating TMPDIR / TEMP / TMP must NOT move the
#      rendezvous dir. This is the property that was broken (Python honored
#      TMPDIR, Node honored TEMP). _canonical_run_dir() must ignore all three.
# ---------------------------------------------------------------------------

def test_run_dir_ignores_tmpdir_temp_tmp(monkeypatch) -> None:
    baseline = _canonical_run_dir()
    for var in ("TMPDIR", "TEMP", "TMP"):
        monkeypatch.setenv(var, str(Path.home() / "some-other-temp"))
    after = _canonical_run_dir()
    assert after == baseline == _EXPECTED_DIR


# ---------------------------------------------------------------------------
# 4 -- the run dir exists after resolution (daemon + client both mkdir it).
# ---------------------------------------------------------------------------

def test_run_dir_is_created() -> None:
    d = _canonical_run_dir()
    assert d.exists() and d.is_dir()
