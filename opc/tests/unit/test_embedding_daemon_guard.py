"""Unit tests for the _check_existing_daemon() startup guard (Task #21).

Tests run entirely offline — no real TCP sockets or PIDs are opened.
All socket and PID-alive checks are mocked via unittest.mock.patch.
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# The module under test lives at opc/scripts/core/embedding_daemon.py.
# We import it via its dotted name (available when PYTHONPATH=. from opc/).
# ---------------------------------------------------------------------------
from scripts.core.embedding_daemon import (
    MODEL_NAME,
    _check_existing_daemon,
    _hide_own_console_on_windows,
)


# ---------------------------------------------------------------------------
# Helpers: build a minimal discovery-file info dict and a pre-encoded ping
# reply so we can inject it via the mock socket.
# ---------------------------------------------------------------------------

def _make_info(pid: int = 12345, port: int = 54321, model: str = MODEL_NAME) -> dict:
    return {"pid": pid, "port": port, "model": model, "dim": 1024}


def _encode_frame(obj: dict) -> bytes:
    """Mirror the daemon's _send_frame encoding: 4-byte big-endian + JSON."""
    payload = json.dumps(obj).encode("utf-8")
    return struct.pack(">I", len(payload)) + payload


def _make_mock_socket(reply: dict) -> MagicMock:
    """Return a mock socket whose recv() returns a framed ping reply."""
    raw = _encode_frame(reply)
    # recv() is called in two passes by _recv_exact: first 4 bytes, then N bytes.
    # We simulate by slicing the raw bytes across two recv() calls.
    sock = MagicMock()
    sock.__enter__ = lambda s: s
    sock.__exit__ = MagicMock(return_value=False)
    header = raw[:4]
    body = raw[4:]
    sock.recv.side_effect = [header, body]
    return sock


# ---------------------------------------------------------------------------
# Test 1 — No discovery file → proceed
# ---------------------------------------------------------------------------

def test_no_discovery_file_returns_false():
    """Guard returns False (proceed) when the discovery file is absent."""
    with patch(
        "scripts.core.embedding_daemon.read_daemon_info", return_value=None
    ):
        assert _check_existing_daemon() is False


# ---------------------------------------------------------------------------
# Test 2 — Discovery file present, PID dead → proceed
# ---------------------------------------------------------------------------

def test_dead_pid_returns_false():
    """Guard returns False when the PID in the file is no longer alive."""
    with patch(
        "scripts.core.embedding_daemon.read_daemon_info",
        return_value=_make_info(),
    ), patch(
        "scripts.core.embedding_daemon._pid_alive", return_value=False
    ):
        assert _check_existing_daemon() is False


# ---------------------------------------------------------------------------
# Test 3 — Alive PID + responsive ping returning ready + model matches → exit
# ---------------------------------------------------------------------------

def test_alive_pid_and_healthy_ping_returns_true(capsys):
    """Guard returns True when another daemon is alive and responding correctly."""
    ping_reply = {"ok": True, "ready": True, "model": MODEL_NAME, "dim": 1024}
    mock_sock = _make_mock_socket(ping_reply)

    with patch(
        "scripts.core.embedding_daemon.read_daemon_info",
        return_value=_make_info(),
    ), patch(
        "scripts.core.embedding_daemon._pid_alive", return_value=True
    ), patch(
        "scripts.core.embedding_daemon.socket.socket", return_value=mock_sock
    ):
        result = _check_existing_daemon()

    assert result is True
    captured = capsys.readouterr()
    assert "another instance alive" in captured.err
    assert "pid=12345" in captured.err
    assert "port=54321" in captured.err


# ---------------------------------------------------------------------------
# Test 4 — Alive PID + ping timeout → proceed
# ---------------------------------------------------------------------------

def test_ping_timeout_returns_false():
    """Guard returns False when the ping socket times out (daemon broken)."""
    sock = MagicMock()
    sock.__enter__ = lambda s: s
    sock.__exit__ = MagicMock(return_value=False)
    sock.connect.side_effect = TimeoutError("timed out")

    with patch(
        "scripts.core.embedding_daemon.read_daemon_info",
        return_value=_make_info(),
    ), patch(
        "scripts.core.embedding_daemon._pid_alive", return_value=True
    ), patch(
        "scripts.core.embedding_daemon.socket.socket", return_value=sock
    ):
        result = _check_existing_daemon()

    assert result is False


# ---------------------------------------------------------------------------
# Test 5 — Alive PID + ping returns wrong model → proceed
# ---------------------------------------------------------------------------

def test_wrong_model_in_ping_reply_returns_false():
    """Guard returns False when the running daemon serves a different model."""
    ping_reply = {
        "ok": True,
        "ready": True,
        "model": "some-other-model/v2",
        "dim": 768,
    }
    mock_sock = _make_mock_socket(ping_reply)

    with patch(
        "scripts.core.embedding_daemon.read_daemon_info",
        return_value=_make_info(),
    ), patch(
        "scripts.core.embedding_daemon._pid_alive", return_value=True
    ), patch(
        "scripts.core.embedding_daemon.socket.socket", return_value=mock_sock
    ):
        result = _check_existing_daemon()

    assert result is False


# ---------------------------------------------------------------------------
# Bonus: ConnectionRefused is treated as broken (proceed)
# ---------------------------------------------------------------------------

def test_connection_refused_returns_false():
    """Guard returns False when connect() raises ConnectionRefusedError."""
    sock = MagicMock()
    sock.__enter__ = lambda s: s
    sock.__exit__ = MagicMock(return_value=False)
    sock.connect.side_effect = ConnectionRefusedError("refused")

    with patch(
        "scripts.core.embedding_daemon.read_daemon_info",
        return_value=_make_info(),
    ), patch(
        "scripts.core.embedding_daemon._pid_alive", return_value=True
    ), patch(
        "scripts.core.embedding_daemon.socket.socket", return_value=sock
    ):
        result = _check_existing_daemon()

    assert result is False


# ---------------------------------------------------------------------------
# _hide_own_console_on_windows() — contract tests for Item 3a
# ---------------------------------------------------------------------------

def test_hide_own_console_is_safe_to_call():
    """Callable and never raises, regardless of platform or console state."""
    _hide_own_console_on_windows()


def test_hide_own_console_posix_is_noop():
    """On non-Windows, returns immediately without importing ctypes."""
    with patch("scripts.core.embedding_daemon.sys") as mock_sys:
        mock_sys.platform = "linux"
        _hide_own_console_on_windows()


def test_hide_own_console_fails_open_on_ctypes_error():
    """If the Win32 API call blows up, we swallow it (UX nicety, not critical)."""
    with patch("scripts.core.embedding_daemon.sys") as mock_sys:
        mock_sys.platform = "win32"
        # Force the inline ctypes import inside the function to explode.
        with patch.dict(sys.modules, {"ctypes": None}):
            _hide_own_console_on_windows()
