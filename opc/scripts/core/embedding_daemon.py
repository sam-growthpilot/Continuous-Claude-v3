#!/usr/bin/env python3
"""Persistent BGE-large embedding daemon (Task 11 Path A).

Wraps ``BAAI/bge-large-en-v1.5`` via ``sentence-transformers.SentenceTransformer``
in a long-lived process so the ``memory-awareness`` UserPromptSubmit hook and
``recall_learnings.py`` can do query-time embedding within the 2s budget.

The bottleneck the daemon solves is **subprocess startup**: importing
``sentence_transformers`` + ``torch`` and loading bge-large is ~30-45s cold
on Windows CPU, but a hot ``model.encode`` is ~30-100ms. A daemon loaded
once eliminates the 30s import tax on every recall call.

Two execution modes:

* **One-shot** (stdin -> stdout). Reads a text from stdin, prints the JSON
  vector to stdout. Used for debug / smoke checks. Pays the full cold
  start each invocation.

* **Daemon** (long-lived process, TCP loopback, length-prefixed JSON frames).
  Pre-warms the model at startup, then services embed/ping/shutdown
  requests with hot-path latency. PID/port written to
  ``$TEMP/ccv3-embedding.json`` so clients can find the daemon. Mirrors
  the Phase 2 rerank daemon protocol (TCP, ``TCP_NODELAY``, 4-byte
  big-endian length prefix, JSON UTF-8 payload, 100MB sanity cap).

Locked decisions (Task 1.1 + user, 2026-05-18):
* Model: ``BAAI/bge-large-en-v1.5`` (1024-dim; bound by archival_memory
  schema -- DO NOT change without a re-embed migration).
* Wrapper: ``SentenceTransformer.encode(text, convert_to_numpy=True).tolist()``
  to byte-for-byte match what ``LocalEmbeddingProvider`` writes today.
* Lifecycle: spawn-on-first-hit detached. Daemon stays loaded across calls.
* Discovery file path: ``$TEMP/ccv3-embedding.json``.
* Transport: TCP loopback on 127.0.0.1, port 0 (OS-assigned), ``TCP_NODELAY``.

Usage::

    # Daemon
    uv run --project opc python opc/scripts/core/embedding_daemon.py --daemon
    # ... writes {pid, port, model, dim} to $TEMP/ccv3-embedding.json
    #     AFTER the model is fully loaded.

    # One-shot
    echo "memory hardening" | \\
        uv run --project opc python opc/scripts/core/embedding_daemon.py

    # Bench
    uv run --project opc python opc/scripts/core/embedding_daemon.py --bench
"""

from __future__ import annotations

import argparse
import atexit
import json
import math
import os
import signal
import socket
import socketserver
import struct
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

# Module-level state. The model is loaded LAZILY via load_model() -- do NOT
# import torch / sentence_transformers at module import time so callers that
# only need the constants / metadata path can import cheaply.
_MODEL: Any | None = None
_MODEL_LOCK = threading.Lock()

MODEL_NAME = "BAAI/bge-large-en-v1.5"
EMBEDDING_DIM = 1024

# Daemon discovery file. Cross-platform via tempfile.gettempdir().
DAEMON_INFO_PATH = Path(tempfile.gettempdir()) / "ccv3-embedding.json"

# BLOCKER-1 (memory-system-next-steps-2026-05-21): cross-process exclusive
# lock used to serialize daemon startup across non-TS spawn paths (Windows
# Task Scheduler pre-warm, direct CLI invocations). The TS-side spawn lock
# in embedding-client.ts covers the hook path; this closes the gap for
# everything else.
DAEMON_LOCK_PATH = Path(tempfile.gettempdir()) / "ccv3-embedding-daemon.lock"


def load_model() -> Any:
    """Load the bge-large embedding model (cached at module level).

    Lazy import of ``sentence_transformers`` + ``torch`` so the module is
    cheap to import. Subsequent calls return the cached instance.

    Returns:
        Loaded ``SentenceTransformer`` instance for ``BAAI/bge-large-en-v1.5``.
    """
    global _MODEL
    with _MODEL_LOCK:
        if _MODEL is not None:
            return _MODEL
        t0 = time.perf_counter()
        print(f"[embedding] loading {MODEL_NAME}...", file=sys.stderr, flush=True)
        # Lazy imports so the module is cheap when only metadata is needed.
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415

        # device=None lets sentence-transformers pick (cuda > mps > cpu).
        # Matches what LocalEmbeddingProvider does when device is None.
        model = SentenceTransformer(MODEL_NAME, device=None)
        elapsed = time.perf_counter() - t0
        # Sanity check: dim must match what's stored in archival_memory.
        actual_dim = model.get_sentence_embedding_dimension()
        if actual_dim != EMBEDDING_DIM:
            raise RuntimeError(
                f"[embedding] model dim mismatch: got {actual_dim}, "
                f"expected {EMBEDDING_DIM} for {MODEL_NAME}"
            )
        print(
            f"[embedding] loaded {MODEL_NAME} (dim={actual_dim}) in {elapsed:.2f}s",
            file=sys.stderr,
            flush=True,
        )
        _MODEL = model
        return model


def embed(text: str, model: Any | None = None) -> list[float]:
    """Embed a single text into a 1024-dim vector.

    Mirrors ``LocalEmbeddingProvider.embed`` byte-for-byte: calls
    ``model.encode(text, convert_to_numpy=True).tolist()`` with no extra
    normalization. The output vector must match what ``recall_learnings.py``
    currently produces in-process so that cosine similarity against rows
    stored in ``archival_memory.embedding`` is preserved.

    Args:
        text: Text to embed.
        model: Optional preloaded SentenceTransformer. When None, calls
            ``load_model()``. Used by the daemon to share the pre-warmed
            instance.

    Returns:
        List of 1024 Python floats.
    """
    if model is None:
        model = load_model()
    # The model is NOT thread-safe for concurrent ``encode`` on the same
    # instance (PyTorch model state, ndarray reuse, etc.). The daemon
    # serialises calls via _MODEL_LOCK below; here we just compute.
    # NOTE: parallel embed_batch calls from different threads will queue up
    # at the lock in the daemon path; that's intentional.
    vec = model.encode(text, convert_to_numpy=True).tolist()
    return vec


def embed_batch(texts: list[str], model: Any | None = None) -> list[list[float]]:
    """Embed a list of texts. Mirrors ``LocalEmbeddingProvider.embed_batch``."""
    if model is None:
        model = load_model()
    if not texts:
        return []
    vecs = model.encode(texts, convert_to_numpy=True).tolist()
    return vecs


# ---------------------------------------------------------------------------
# One-shot CLI mode
# ---------------------------------------------------------------------------

def _run_oneshot() -> int:
    """One-shot mode: read text from stdin, print JSON vector to stdout."""
    text = sys.stdin.read()
    # Strip a trailing newline added by `echo`. Preserve internal whitespace
    # because embeddings DO depend on text shape.
    if text.endswith("\n"):
        text = text[:-1]
    if not text:
        print("[embedding] no text on stdin", file=sys.stderr)
        return 0
    t0 = time.perf_counter()
    vec = embed(text)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    print(
        f"[embedding] oneshot embed: {elapsed_ms:.1f}ms (dim={len(vec)})",
        file=sys.stderr,
        flush=True,
    )
    print(json.dumps({"vector": vec}))
    return 0


# ---------------------------------------------------------------------------
# Daemon mode (TCP loopback, length-prefixed JSON frames)
# ---------------------------------------------------------------------------

# Length-prefix framing: 4-byte big-endian uint32 payload length, then
# `length` UTF-8 bytes of JSON. Mirrors the Phase 2 rerank daemon protocol.

# Serialises model.encode calls -- sentence-transformers + torch are NOT
# thread-safe for concurrent inference on the same model instance. Same
# lesson kraken hit on the Phase 2 rerank daemon.
_EMBED_CALL_LOCK = threading.Lock()


def _recv_exact(sock: socket.socket, n: int) -> bytes:
    """Read exactly `n` bytes or raise EOFError on short read."""
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise EOFError(f"socket closed after {len(buf)}/{n} bytes")
        buf.extend(chunk)
    return bytes(buf)


def _recv_frame(sock: socket.socket) -> dict[str, Any]:
    """Receive a single length-prefixed JSON frame."""
    header = _recv_exact(sock, 4)
    (length,) = struct.unpack(">I", header)
    if length > 100 * 1024 * 1024:  # 100 MB sanity limit
        raise ValueError(f"frame too large: {length} bytes")
    payload = _recv_exact(sock, length)
    return json.loads(payload.decode("utf-8"))


def _send_frame(sock: socket.socket, obj: dict[str, Any]) -> None:
    """Send a single length-prefixed JSON frame."""
    payload = json.dumps(obj, default=str).encode("utf-8")
    sock.sendall(struct.pack(">I", len(payload)) + payload)


def _model_ready() -> bool:
    """Return True if the model has been loaded into the cache."""
    return _MODEL is not None


class _EmbeddingHandler(socketserver.BaseRequestHandler):
    """Handle one embedding request per connection."""

    def handle(self) -> None:  # noqa: D401 (socketserver API)
        try:
            self.request.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass
        try:
            req = _recv_frame(self.request)
            cmd = req.get("cmd", "embed")
            if cmd == "ping":
                _send_frame(self.request, {
                    "ok": True,
                    "ready": _model_ready(),
                    "model": MODEL_NAME,
                    "dim": EMBEDDING_DIM,
                })
                return
            if cmd == "shutdown":
                _send_frame(self.request, {"ok": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            if cmd == "embed":
                text = req.get("text", "")
                if not isinstance(text, str):
                    _send_frame(self.request, {"error": "text must be a string"})
                    return
                t0 = time.perf_counter()
                with _EMBED_CALL_LOCK:
                    vec = embed(text, model=None)
                elapsed_ms = (time.perf_counter() - t0) * 1000
                _send_frame(self.request, {
                    "vector": vec,
                    "elapsed_ms": elapsed_ms,
                    "dim": len(vec),
                })
                return
            if cmd == "embed_batch":
                texts = req.get("texts", [])
                if not isinstance(texts, list):
                    _send_frame(self.request, {"error": "texts must be a list"})
                    return
                if not all(isinstance(t, str) for t in texts):
                    _send_frame(self.request, {"error": "all texts must be strings"})
                    return
                t0 = time.perf_counter()
                with _EMBED_CALL_LOCK:
                    vecs = embed_batch(texts, model=None)
                elapsed_ms = (time.perf_counter() - t0) * 1000
                _send_frame(self.request, {
                    "vectors": vecs,
                    "elapsed_ms": elapsed_ms,
                    "count": len(vecs),
                })
                return
            _send_frame(self.request, {"error": f"unknown cmd: {cmd!r}"})
        except (EOFError, ConnectionResetError, BrokenPipeError):
            # Client disconnected before we could reply -- nothing useful to do.
            return
        except Exception as exc:  # noqa: BLE001
            try:
                _send_frame(self.request, {"error": str(exc)})
            except OSError:
                pass


class _ThreadingTCPServer(socketserver.ThreadingTCPServer):
    """Threading TCP server with SO_REUSEADDR and faster shutdown."""

    allow_reuse_address = True
    daemon_threads = True


def _write_daemon_info(pid: int, port: int) -> None:
    """Write daemon discovery file. Called AFTER model is loaded.

    Clients should treat the file's absence (or stale PID) as
    "daemon not ready" and fall back to in-process embedding.
    """
    info = {
        "pid": pid,
        "port": port,
        "started_at": time.time(),
        "model": MODEL_NAME,
        "dim": EMBEDDING_DIM,
    }
    DAEMON_INFO_PATH.write_text(json.dumps(info), encoding="utf-8")


def _delete_daemon_info() -> None:
    """Remove daemon discovery file (best-effort)."""
    try:
        DAEMON_INFO_PATH.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        pass


def _check_existing_daemon() -> bool:
    """Return True if another healthy daemon instance is already running.

    Defense-in-depth startup guard (Task #21). Called at the top of
    ``_run_daemon`` BEFORE the 30s model load.  If this returns True the
    caller should ``sys.exit(0)`` cleanly without loading the model.

    Decision table
    ~~~~~~~~~~~~~~
    * Discovery file absent                    → False (proceed, we're first)
    * File present, PID dead                   → False (stale; proceed)
    * File present, PID alive, ping fails      → False (broken instance; take over)
    * File present, PID alive, wrong model     → False (different model; take over)
    * File present, PID alive, ping ok, model matches → True (exit cleanly)

    The discovery file is NOT deleted on a dead-PID find — we let the normal
    startup path overwrite it, avoiding a delete-then-crash race.
    """
    info = read_daemon_info()
    if not info:
        return False

    pid = int(info.get("pid", 0))
    port = int(info.get("port", 0))

    if not _pid_alive(pid):
        return False

    # PID is alive — try a ping with 1500ms timeout.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(1.5)
            sock.connect(("127.0.0.1", port))
            _send_frame(sock, {"cmd": "ping"})
            reply = _recv_frame(sock)
    except (OSError, ConnectionRefusedError, EOFError, ValueError, json.JSONDecodeError):
        # Any failure: can't reach the daemon — proceed (it's broken).
        return False

    # Ping succeeded — check that the model matches.
    if reply.get("model") != MODEL_NAME:
        return False

    # Another healthy instance is running.
    print(
        f"[embedding] daemon: another instance alive (pid={pid} port={port}) — exiting",
        file=sys.stderr,
        flush=True,
    )
    return True


def _acquire_exclusive_lock(lock_path: Path = DAEMON_LOCK_PATH) -> int | None:
    """Cross-process exclusive lock on the daemon startup path.

    Returns an open file descriptor on success (caller must keep it open for
    the lifetime of the daemon). Returns ``None`` if another process already
    holds the lock.

    Why this exists (BLOCKER-1): two daemon spawners that both pass
    ``_check_existing_daemon()`` at the same instant can race and end up
    with two model-load processes, two port binds, and a stomped discovery
    file. The TS-side spawn lock in ``embedding-client.ts`` covers the
    hook path; this OS-level lock covers Windows Task Scheduler pre-warm,
    direct CLI starts, and any other path the TS lock doesn't see.

    Implementation:
        * Windows uses ``msvcrt.locking(fd, LK_NBLCK, 1)`` on byte 0.
        * POSIX uses ``fcntl.flock(fd, LOCK_EX | LOCK_NB)``.
        * On success we register an ``atexit`` hook to close the fd and
          unlink the lock file. Lock contents are the holder's PID for
          debugging — never load-bearing, since the OS owns the actual lock.
        * Failure modes (file-open error, lock contention) return ``None``
          and do NOT register cleanup, so a losing acquirer never deletes
          the winning daemon's lock file.

    Args:
        lock_path: Path of the lock file. Defaults to DAEMON_LOCK_PATH but
            tests can pass a temp path to avoid cross-test interference.

    Returns:
        Open file descriptor, or ``None`` if another holder exists.
    """
    try:
        fd = os.open(str(lock_path), os.O_RDWR | os.O_CREAT, 0o644)
    except OSError as exc:
        print(
            f"[embedding] daemon: lock open failed: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return None

    try:
        if sys.platform == "win32":
            import msvcrt  # noqa: PLC0415
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            except OSError:
                os.close(fd)
                return None
        else:
            import fcntl  # noqa: PLC0415
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                os.close(fd)
                return None
    except Exception:
        # Defensive: any unexpected error releasing the lock-related
        # imports/syscalls. Treat as "couldn't acquire" so we don't half-hold.
        try:
            os.close(fd)
        except OSError:
            pass
        return None

    # Write the holder PID for debugging. Best-effort — failure here does
    # NOT release the lock (the OS still owns it via the fd).
    try:
        os.lseek(fd, 0, os.SEEK_SET)
        os.write(fd, f"{os.getpid()}\n".encode("utf-8"))
        try:
            os.fsync(fd)
        except OSError:
            # Some filesystems (e.g. some Windows temp filesystems) don't
            # support fsync on this kind of handle. Not fatal.
            pass
    except OSError:
        pass

    # Register cleanup ONLY on the success path. A loser that already
    # returned None never reaches this line, so it can't unlink the
    # winner's lock file.
    def _cleanup(_fd: int = fd, _path: Path = lock_path) -> None:
        try:
            os.close(_fd)
        except OSError:
            pass
        try:
            os.unlink(str(_path))
        except OSError:
            pass

    atexit.register(_cleanup)
    return fd


def _hide_own_console_on_windows() -> None:
    """Hide our own console window on Windows so a Bash-spawned or
    Task-Scheduler-spawned daemon doesn't clutter the taskbar.

    No-op on POSIX. Fail-open if the Win32 call doesn't work (e.g., daemon
    launched without an attached console). The hook spawn path already passes
    ``windowsHide: true``; this protects the non-hook paths.
    """
    if sys.platform != "win32":
        return
    try:
        import ctypes  # noqa: PLC0415
        hwnd = ctypes.windll.kernel32.GetConsoleWindow()  # type: ignore[attr-defined]
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)  # type: ignore[attr-defined]  # SW_HIDE
    except Exception:
        # Don't break the daemon over a UX nicety.
        pass


def _run_daemon(port: int) -> int:
    """Run the embedding daemon on 127.0.0.1:port (port=0 means pick free)."""
    # UX: hide our console window on Windows regardless of who spawned us.
    _hide_own_console_on_windows()

    # BLOCKER-1: cross-process exclusive lock. Two spawners that both pass
    # _check_existing_daemon() at the same instant would race and end up
    # with two model-load processes. The TS spawn lock covers the hook
    # path; this covers non-TS spawners (Task Scheduler, direct CLI).
    # We keep the fd alive for the daemon's lifetime — closing it (via
    # atexit) releases the OS-level lock automatically.
    _lock_fd = _acquire_exclusive_lock()
    if _lock_fd is None:
        print(
            "[embedding] daemon: another daemon holds the startup lock — exiting",
            file=sys.stderr,
            flush=True,
        )
        return 0

    # Defense-in-depth: if another daemon is already running (and healthy),
    # exit before paying the 30s model-load cost.
    if _check_existing_daemon():
        return 0

    # Pre-load the model BEFORE binding the port AND BEFORE writing the
    # discovery file. Clients that see the discovery file assume the
    # daemon is hot and ready to serve.
    print("[embedding] daemon: pre-loading model...", file=sys.stderr, flush=True)
    model = load_model()
    # Warm-up encode pass to compile internal caches (kernel autotune etc).
    t_warm = time.perf_counter()
    _ = model.encode("warmup", convert_to_numpy=True)
    print(
        f"[embedding] daemon: warmup encode: "
        f"{(time.perf_counter() - t_warm) * 1000:.1f}ms",
        file=sys.stderr,
        flush=True,
    )

    server = _ThreadingTCPServer(("127.0.0.1", port), _EmbeddingHandler)
    actual_port = server.server_address[1]
    pid = os.getpid()
    _write_daemon_info(pid, actual_port)
    print(
        f"[embedding] daemon: listening on 127.0.0.1:{actual_port} (pid={pid})",
        file=sys.stderr,
        flush=True,
    )
    print(
        f"[embedding] daemon: info file: {DAEMON_INFO_PATH}",
        file=sys.stderr,
        flush=True,
    )

    def _shutdown_handler(signum, _frame):  # noqa: ANN001
        print(
            f"[embedding] daemon: received signal {signum}, shutting down...",
            file=sys.stderr,
            flush=True,
        )
        threading.Thread(target=server.shutdown, daemon=True).start()

    # SIGTERM is the standard shutdown signal. SIGINT (Ctrl+C) likewise.
    # Windows additionally exposes SIGBREAK for Ctrl+Break.
    for sig_name in ("SIGTERM", "SIGINT", "SIGBREAK"):
        sig = getattr(signal, sig_name, None)
        if sig is not None:
            try:
                signal.signal(sig, _shutdown_handler)
            except (ValueError, OSError):
                # Some signals can't be installed on the main thread on
                # Windows (e.g. when running under certain harnesses). Skip.
                pass

    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        try:
            server.server_close()
        finally:
            _delete_daemon_info()
            print(
                "[embedding] daemon: stopped, info file cleaned up",
                file=sys.stderr,
                flush=True,
            )
    return 0


# ---------------------------------------------------------------------------
# Daemon client helpers (used by recall_learnings.py)
# ---------------------------------------------------------------------------

def read_daemon_info() -> dict[str, Any] | None:
    """Read daemon discovery file; return None if missing or invalid."""
    if not DAEMON_INFO_PATH.exists():
        return None
    try:
        return json.loads(DAEMON_INFO_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _pid_alive(pid: int) -> bool:
    """Return True if the given PID is alive (cross-platform).

    Windows note: ``os.kill(pid, 0)`` raises ``OSError [WinError 87]`` on
    Windows for ANY pid -- the kernel rejects signal 0 -- so we can't
    distinguish alive from dead via os.kill there. We use
    ``OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, ...)`` via ctypes
    instead.
    """
    if pid <= 0:
        return False
    if sys.platform == "win32":
        # Windows-native check via OpenProcess.
        try:
            import ctypes  # noqa: PLC0415
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
            handle = kernel32.OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION, False, pid
            )
            if not handle:
                return False
            # Holding a handle is enough -- if the pid is reused by a brand
            # new process we'd false-positive, but for our daemon discovery
            # this is acceptable (worst case: send to dead-pid daemon,
            # connect fails, fall back to in-process embedding).
            kernel32.CloseHandle(handle)
            return True
        except Exception:  # noqa: BLE001
            return False
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # Process exists but we don't own it -- treat as alive.
        return True
    except OSError:
        return False


def daemon_is_alive() -> tuple[bool, dict[str, Any] | None]:
    """Return (alive, info) for the embedding daemon."""
    info = read_daemon_info()
    if not info:
        return False, None
    pid = int(info.get("pid", 0))
    if not _pid_alive(pid):
        return False, info
    return True, info


def embed_via_daemon(
    text: str,
    timeout_s: float = 30.0,
) -> dict[str, Any] | None:
    """Send an embed request to the daemon, return its response.

    Returns ``None`` if the daemon is unreachable / not ready (caller
    should fall back to in-process embedding).
    """
    alive, info = daemon_is_alive()
    if not alive or not info:
        return None
    port = int(info.get("port", 0))
    if port <= 0:
        return None
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout_s) as sock:
            try:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except OSError:
                pass
            sock.settimeout(timeout_s)
            _send_frame(sock, {"cmd": "embed", "text": text})
            return _recv_frame(sock)
    except (OSError, EOFError, json.JSONDecodeError):
        return None


def embed_batch_via_daemon(
    texts: list[str],
    timeout_s: float = 60.0,
) -> dict[str, Any] | None:
    """Send an embed_batch request to the daemon, return its response.

    Returns ``None`` if the daemon is unreachable.
    """
    alive, info = daemon_is_alive()
    if not alive or not info:
        return None
    port = int(info.get("port", 0))
    if port <= 0:
        return None
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout_s) as sock:
            try:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except OSError:
                pass
            sock.settimeout(timeout_s)
            _send_frame(sock, {"cmd": "embed_batch", "texts": texts})
            return _recv_frame(sock)
    except (OSError, EOFError, json.JSONDecodeError):
        return None


def ping_daemon(timeout_s: float = 2.0) -> dict[str, Any] | None:
    """Ping the daemon. Returns the response dict, or None if unreachable.

    Lighter-weight than ``daemon_is_alive`` for liveness probes: it actually
    talks to the daemon so we know the TCP socket is accepting AND the
    model is loaded (``ready=True`` flag).
    """
    alive, info = daemon_is_alive()
    if not alive or not info:
        return None
    port = int(info.get("port", 0))
    if port <= 0:
        return None
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout_s) as sock:
            try:
                sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            except OSError:
                pass
            sock.settimeout(timeout_s)
            _send_frame(sock, {"cmd": "ping"})
            return _recv_frame(sock)
    except (OSError, EOFError, json.JSONDecodeError):
        return None


# ---------------------------------------------------------------------------
# Bench mode (verification gate for the latency budget)
# ---------------------------------------------------------------------------

def _run_bench() -> int:
    """Internal hot-loop bench: 10 single-text embeds.

    Reports cold-load time, warmup time, and p50/p95 of hot embeds. JSON
    to stdout. Percentile method matches rerank.py's bench (true median
    for p50, ceil nearest-rank for p95) -- which is the post-fix version
    from commit 83d1308.
    """
    texts = [
        "Phase 2 of the memory system adds a cross-encoder reranker on top of hybrid RRF.",
        "BGE-large-en-v1.5 produces 1024-dim embeddings that match the archival_memory schema.",
        "Cold model load on Windows CPU is ~30-45s; warm encode is ~30-100ms per query.",
        "A long-lived daemon eliminates the sentence-transformers import tax on every recall.",
        "Length-prefixed JSON frames over TCP loopback mirror the Phase 2 rerank protocol.",
        "Discovery file at $TEMP/ccv3-embedding.json gives clients PID and port after warmup.",
        "Spawn-on-first-hit detached lifecycle: cold start blocks first caller, then warm.",
        "The query embedding must byte-for-byte match LocalEmbeddingProvider for cosine recall.",
        "TCP_NODELAY is set on both daemon and client sockets to minimise small-frame latency.",
        "Threading.Lock around model.encode serialises calls -- model is not thread-safe.",
    ]

    # Cold-load timing
    t_cold = time.perf_counter()
    model = load_model()
    cold_ms = (time.perf_counter() - t_cold) * 1000

    # Single warmup
    t_warm = time.perf_counter()
    _ = model.encode("warmup", convert_to_numpy=True)
    warmup_ms = (time.perf_counter() - t_warm) * 1000

    # 10 hot embeds (single-text)
    times: list[float] = []
    for i in range(10):
        text = texts[i % len(texts)]
        t0 = time.perf_counter()
        embed(text, model=model)
        times.append((time.perf_counter() - t0) * 1000)

    times.sort()
    # Delegate to shared helpers in core.utils so all bench modes stay in sync.
    # (Phase 2 MEDIUM-4: previously duplicated across rerank.py, eval_recall.py,
    # and embedding_daemon.py.)
    from core.utils import percentile as _pct, median as _median  # noqa: PLC0415
    p50_ms = _median(times)
    p95_ms = _pct(times, 95)
    out = {
        "cold_ms": cold_ms,
        "warmup_ms": warmup_ms,
        "p50_ms": p50_ms,
        "p95_ms": p95_ms,
        "all_ms": times,
        "iterations": len(times),
        "model": MODEL_NAME,
        "dim": EMBEDDING_DIM,
    }
    print(json.dumps(out, indent=2))
    return 0


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    """Build the argparse CLI."""
    p = argparse.ArgumentParser(
        prog="embedding_daemon.py",
        description="Persistent BGE-large embedding daemon for memory recall.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--daemon",
        action="store_true",
        help="Run as a long-lived TCP daemon on 127.0.0.1.",
    )
    p.add_argument(
        "--port",
        type=int,
        default=0,
        help="TCP port for daemon mode (0 = pick free port).",
    )
    p.add_argument(
        "--bench",
        action="store_true",
        help="Run internal hot-loop bench (10x embed of dummy texts).",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint."""
    args = _build_parser().parse_args(argv)
    if args.daemon:
        return _run_daemon(args.port)
    if args.bench:
        return _run_bench()
    # Default: one-shot mode -- read stdin, embed, print vector.
    return _run_oneshot()


if __name__ == "__main__":
    sys.exit(main())
