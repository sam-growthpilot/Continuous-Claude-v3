"""Unit tests for the _acquire_exclusive_lock() cross-process daemon lock
(BLOCKER-1 from memory-system-next-steps-2026-05-21).

These tests cover:
  * Single-process: acquire / contended / release / re-acquire
  * PID write on success
  * Failed open returns None (no fd leak, no atexit register)
  * Cross-process: spawn 2 subprocesses, verify exactly one wins the lock

The subprocess test is the BLOCKER-1 acceptance criterion: "Running 2 daemons
in parallel never produces 2 alive workers." We use a tiny inline Python
helper instead of spawning the real daemon (which would take ~30s to load
the BGE model) — the lock acquire is what we actually need to verify, not
the model load.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

from scripts.core.embedding_daemon import _acquire_exclusive_lock


# Repo-relative path so subprocess invocations can find `scripts.core.*`.
# We compute it once at import time so each test doesn't re-resolve.
_OPC_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def lock_path(tmp_path: Path) -> Path:
    """Unique lock file per test, in pytest's tmp_path so cleanup is automatic."""
    return tmp_path / "ccv3-test-acquire-lock.lock"


# ---------------------------------------------------------------------------
# Single-process: contract tests
# ---------------------------------------------------------------------------

def test_first_acquire_returns_fd(lock_path: Path) -> None:
    """An unheld lock can be acquired; returns a non-negative fd."""
    fd = _acquire_exclusive_lock(lock_path)
    try:
        assert fd is not None
        assert fd >= 0
    finally:
        if fd is not None:
            os.close(fd)


def test_second_acquire_returns_none_while_held(lock_path: Path) -> None:
    """While process holds the lock, a second acquire from the same process fails."""
    fd1 = _acquire_exclusive_lock(lock_path)
    try:
        assert fd1 is not None
        fd2 = _acquire_exclusive_lock(lock_path)
        assert fd2 is None, "Second acquire must return None while first holds"
    finally:
        if fd1 is not None:
            os.close(fd1)


def test_acquire_succeeds_after_release(lock_path: Path) -> None:
    """Releasing the lock fd lets the next acquire succeed."""
    fd1 = _acquire_exclusive_lock(lock_path)
    assert fd1 is not None
    os.close(fd1)

    fd2 = _acquire_exclusive_lock(lock_path)
    try:
        assert fd2 is not None, "Re-acquire after release must succeed"
    finally:
        if fd2 is not None:
            os.close(fd2)


def test_acquire_writes_holder_pid(lock_path: Path) -> None:
    """The lock file contains the holder PID for post-mortem debugging.

    NOTE: on Windows, msvcrt.locking is mandatory — outside reads (including
    Path.read_text) are blocked while the lock is held. We therefore verify
    the PID by reading through the same fd we already own. The on-disk bytes
    only become readable via a fresh handle after the holder releases.
    """
    fd = _acquire_exclusive_lock(lock_path)
    try:
        assert fd is not None
        # Rewind, read what we wrote. The function seeks to 0 + writes PID + \n.
        os.lseek(fd, 0, os.SEEK_SET)
        # Read more than we expect to ensure we get the whole value.
        raw = os.read(fd, 256).decode("utf-8").strip()
        assert raw == str(os.getpid()), (
            f"Expected PID {os.getpid()} in lock file, got {raw!r}"
        )
    finally:
        if fd is not None:
            os.close(fd)


def test_open_failure_returns_none(tmp_path: Path) -> None:
    """If the lock path is unwritable (parent doesn't exist), return None."""
    bad_path = tmp_path / "nonexistent-subdir" / "lock.file"
    fd = _acquire_exclusive_lock(bad_path)
    assert fd is None, "Lock path with missing parent dir must return None"


# ---------------------------------------------------------------------------
# Cross-process: the BLOCKER-1 acceptance test
# ---------------------------------------------------------------------------

# Inline subprocess helper. The child:
#   1. Tries to acquire the lock at the given path.
#   2. Prints "ACQUIRED <pid>" on success or "BLOCKED <pid>" on failure.
#   3. Sleeps long enough for the other process to also try (and block).
#   4. Exits 0 either way (the test reads stdout, not exit codes).
#
# We pass the lock path via argv[1] and the sleep duration via argv[2].
_CHILD_SCRIPT = """
import os, sys, time
sys.path.insert(0, sys.argv[1])
from scripts.core.embedding_daemon import _acquire_exclusive_lock
from pathlib import Path
lock_path = Path(sys.argv[2])
sleep_s = float(sys.argv[3])
fd = _acquire_exclusive_lock(lock_path)
if fd is None:
    print(f"BLOCKED {os.getpid()}", flush=True)
else:
    print(f"ACQUIRED {os.getpid()}", flush=True)
    time.sleep(sleep_s)
    try:
        os.close(fd)
    except OSError:
        pass
"""


def _spawn_lock_child(lock_path: Path, sleep_s: float) -> subprocess.Popen:
    """Spawn a child Python that tries to acquire the lock."""
    return subprocess.Popen(
        [
            sys.executable,
            "-c",
            _CHILD_SCRIPT,
            str(_OPC_ROOT),
            str(lock_path),
            str(sleep_s),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def test_two_subprocesses_exactly_one_acquires(lock_path: Path) -> None:
    """Spawn 2 processes racing for the lock — exactly one wins.

    This is the BLOCKER-1 acceptance criterion. The winner holds the lock
    for 1.5s (the sleep), giving the loser plenty of time to attempt and
    fail. If both succeed (or both fail) the test fails loudly.
    """
    p1 = _spawn_lock_child(lock_path, sleep_s=1.5)
    p2 = _spawn_lock_child(lock_path, sleep_s=1.5)

    out1, _ = p1.communicate(timeout=10)
    out2, _ = p2.communicate(timeout=10)

    acquired = sum(1 for o in (out1, out2) if "ACQUIRED" in o)
    blocked = sum(1 for o in (out1, out2) if "BLOCKED" in o)

    assert acquired == 1, (
        f"Exactly one process must acquire the lock; got acquired={acquired}. "
        f"p1 stdout: {out1!r}, p2 stdout: {out2!r}"
    )
    assert blocked == 1, (
        f"Exactly one process must be blocked; got blocked={blocked}. "
        f"p1 stdout: {out1!r}, p2 stdout: {out2!r}"
    )


def test_serial_subprocesses_each_succeed(lock_path: Path) -> None:
    """If the first subprocess fully releases before the second starts,
    the second should also acquire successfully. Sanity check that the
    lock is not 'sticky' once the holder exits."""
    p1 = _spawn_lock_child(lock_path, sleep_s=0.1)
    out1, _ = p1.communicate(timeout=10)
    assert "ACQUIRED" in out1

    # P1 has exited, lock released. Now P2 should win too.
    p2 = _spawn_lock_child(lock_path, sleep_s=0.1)
    out2, _ = p2.communicate(timeout=10)
    assert "ACQUIRED" in out2
