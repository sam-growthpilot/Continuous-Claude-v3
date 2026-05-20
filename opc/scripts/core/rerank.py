#!/usr/bin/env python3
"""Stage-2 cross-encoder reranker for memory recall (Phase 2).

Wraps BAAI/bge-reranker-v2-m3 via sentence-transformers CrossEncoder. Used as a
Stage-2 pass over the top-50 candidates returned by hybrid RRF recall in
``recall_learnings.py``. Returns top-K candidates re-ordered by cross-encoder
relevance.

Two execution modes:

* **One-shot** (stdin/stdout, JSONL frame-per-candidate). Spawned as a
  subprocess from ``recall_learnings.py``. Loads the model once per call.
  Cold latency is dominated by model load (~50s on this machine).

* **Daemon** (long-lived process, TCP loopback, length-prefixed JSON frames).
  Pre-warms the model at startup, then services rerank requests with hot-path
  latency. PID/port written to ``$TEMP/ccv3-rerank.json`` so clients can find
  the daemon. Mirrors the TLDR daemon protocol on Windows (TCP, ``TCP_NODELAY``).

Locked decisions (Task 0.1 + user, 2026-05-17):
* Model: ``BAAI/bge-reranker-v2-m3``
* Wrapper: ``sentence_transformers.CrossEncoder`` (v5.x — note that v5 ships
  with ``Sigmoid()`` activation by default; we override to ``nn.Identity()``
  to honour the "raw logits, no sigmoid" decision).
* ``max_length=256`` truncation, ``batch_size=32`` default
* Keep top-50 RRF candidates -> return top-K (default 5)
* ``use_fp16=False`` (CPU only)

Usage::

    # One-shot (subprocess pattern used by recall_learnings.py)
    echo '{"id":"a","content":"...","base_score":0.03}' | \\
        uv run --project opc python opc/scripts/core/rerank.py \\
            --query "memory hardening" --candidates-from-stdin --top-k 5

    # Daemon
    uv run --project opc python opc/scripts/core/rerank.py --daemon --port 0
    # ... writes {pid, port} to $TEMP/ccv3-rerank.json

    # Bench (verification gate for the latency budget)
    uv run --project opc python opc/scripts/core/rerank.py --bench
"""

from __future__ import annotations

import argparse
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

# Module-level state. The model is loaded LAZILY via load_model() — do NOT
# import torch / sentence_transformers at module import time so that callers
# who only need the constants / metadata path can import cheaply.
_MODEL: Any | None = None
_MODEL_LOCK = threading.Lock()

MODEL_NAME = "BAAI/bge-reranker-v2-m3"
DEFAULT_MAX_LENGTH = 256
DEFAULT_BATCH_SIZE = 32
DEFAULT_TOP_K = 5

# Daemon discovery file. Cross-platform via tempfile.gettempdir().
DAEMON_INFO_PATH = Path(tempfile.gettempdir()) / "ccv3-rerank.json"


def load_model(max_length: int = DEFAULT_MAX_LENGTH) -> Any:
    """Load the cross-encoder model (cached at module level).

    Lazy import of sentence_transformers + torch so the module is cheap to
    import. Subsequent calls return the cached instance.

    Args:
        max_length: Token truncation length. Applied to the (query, candidate)
            pair concatenation. 256 is the Task 0.1 decision -- balances
            recall accuracy vs latency.

    Returns:
        Loaded ``CrossEncoder`` instance with raw-logit output (Identity
        activation).
    """
    global _MODEL
    with _MODEL_LOCK:
        if _MODEL is not None:
            return _MODEL
        t0 = time.perf_counter()
        # Lazy imports so the module is cheap when only metadata is needed.
        from sentence_transformers import CrossEncoder  # noqa: PLC0415
        import torch.nn as nn  # noqa: PLC0415

        model = CrossEncoder(
            MODEL_NAME,
            max_length=max_length,
            # Pass activation_fn=None to constructor -- but bge-reranker-v2-m3
            # ships with Sigmoid as the model's default activation, which
            # CrossEncoder reads from the model config. We override to
            # Identity to honour the "raw logits, no sigmoid" decision.
            activation_fn=None,
        )
        # Force raw logits regardless of model card default.
        model.activation_fn = nn.Identity()
        elapsed = time.perf_counter() - t0
        print(
            f"[rerank] loaded {MODEL_NAME} max_length={max_length} in {elapsed:.2f}s",
            file=sys.stderr,
            flush=True,
        )
        _MODEL = model
        return model


def rerank(
    query: str,
    candidates: list[dict[str, Any]],
    top_k: int = DEFAULT_TOP_K,
    max_length: int = DEFAULT_MAX_LENGTH,
    batch_size: int = DEFAULT_BATCH_SIZE,
    model: Any | None = None,
) -> list[dict[str, Any]]:
    """Re-rank a candidate list using the cross-encoder.

    The candidates are expected to be the top-N RRF results -- typically 50.
    We score each ``(query, candidate["content"])`` pair, attach a
    ``rerank_score`` field, sort descending, and slice the top-K.

    Args:
        query: User query string.
        candidates: List of dicts with at least an ``"id"`` and ``"content"``
            field. Other fields are passed through unchanged.
        top_k: Number of results to return after reranking.
        max_length: Token truncation length for the cross-encoder. Used only
            when a fresh model is loaded; ignored when ``model`` is provided.
        batch_size: Batch size for ``model.predict``. 32 is the locked default.
        model: Optional preloaded ``CrossEncoder``. When None, calls
            ``load_model(max_length)``. Used by the daemon to share the
            pre-warmed instance.

    Returns:
        Top-K candidates with an added ``rerank_score`` field, sorted by
        that field descending. Each candidate retains its original keys
        (including ``base_score`` etc.).
    """
    if not candidates:
        return []
    if model is None:
        model = load_model(max_length=max_length)

    pairs = [(query, c.get("content", "")) for c in candidates]
    scores = model.predict(pairs, batch_size=batch_size)
    # CrossEncoder.predict returns np.ndarray by default. Convert to floats
    # so the candidates are JSON-serialisable.
    score_list: list[float]
    try:
        score_list = [float(s) for s in scores.tolist()]
    except AttributeError:
        # Already a list / tensor without .tolist()
        score_list = [float(s) for s in scores]

    for cand, score in zip(candidates, score_list):
        # INTENTIONAL: mutates the input candidate dicts in place. The by_id
        # map in recall_learnings._apply_rerank relies on this so the
        # rehydration step can read rerank_score from the original dict via
        # the shared reference. Safe under single-threaded use; if this code
        # is ever called concurrently on shared candidate lists, audit.
        # (Phase 2 MEDIUM-3)
        cand["rerank_score"] = score

    candidates.sort(key=lambda c: c.get("rerank_score", float("-inf")), reverse=True)
    return candidates[:top_k]


# ---------------------------------------------------------------------------
# One-shot CLI mode
# ---------------------------------------------------------------------------

def _read_jsonl_stdin() -> list[dict[str, Any]]:
    """Read newline-delimited JSON candidates from stdin until EOF."""
    out: list[dict[str, Any]] = []
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError as exc:
            print(f"[rerank] bad JSONL line: {exc}", file=sys.stderr)
    return out


def _write_jsonl_stdout(rows: list[dict[str, Any]]) -> None:
    """Write JSONL rows to stdout (one row per line)."""
    for row in rows:
        sys.stdout.write(json.dumps(row, default=str) + "\n")
    sys.stdout.flush()


def _run_oneshot(args: argparse.Namespace) -> int:
    """One-shot mode: read JSONL from stdin, rerank, write JSONL to stdout."""
    candidates = _read_jsonl_stdin()
    if not candidates:
        print("[rerank] no candidates on stdin", file=sys.stderr)
        return 0
    t0 = time.perf_counter()
    top = rerank(
        query=args.query,
        candidates=candidates,
        top_k=args.top_k,
        max_length=args.max_length,
        batch_size=args.batch_size,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000
    print(f"[rerank] oneshot rerank: {elapsed_ms:.1f}ms ({len(candidates)} -> {len(top)})",
          file=sys.stderr, flush=True)
    _write_jsonl_stdout(top)
    return 0


# ---------------------------------------------------------------------------
# Daemon mode (TCP loopback, length-prefixed JSON frames)
# ---------------------------------------------------------------------------

# Length-prefix framing: 4-byte big-endian uint32 payload length, then
# `length` UTF-8 bytes of JSON. Mirrors a common pattern (similar to
# struct-framed JSON-RPC), keeps the reader simple, and avoids
# newline-delimited ambiguity when payloads embed `\n`.

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


class _RerankHandler(socketserver.BaseRequestHandler):
    """Handle one rerank request per connection."""

    def handle(self) -> None:  # noqa: D401 (socketserver API)
        try:
            self.request.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass
        try:
            req = _recv_frame(self.request)
            cmd = req.get("cmd", "rerank")
            if cmd == "ping":
                _send_frame(self.request, {"status": "ok"})
                return
            if cmd == "shutdown":
                _send_frame(self.request, {"status": "ok"})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            query = req.get("query", "")
            candidates = req.get("candidates", [])
            top_k = int(req.get("top_k", DEFAULT_TOP_K))
            batch_size = int(req.get("batch_size", DEFAULT_BATCH_SIZE))
            max_length = int(req.get("max_length", DEFAULT_MAX_LENGTH))
            t0 = time.perf_counter()
            top = rerank(
                query=query,
                candidates=candidates,
                top_k=top_k,
                max_length=max_length,
                batch_size=batch_size,
                # The daemon thread loaded the model on startup; load_model()
                # returns the cached instance here.
                model=None,
            )
            elapsed_ms = (time.perf_counter() - t0) * 1000
            _send_frame(self.request, {"results": top, "elapsed_ms": elapsed_ms})
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
    """Write daemon discovery file with pid, port, and start timestamp."""
    info = {
        "pid": pid,
        "port": port,
        "started_at": time.time(),
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


def _run_daemon(port: int) -> int:
    """Run the rerank daemon on 127.0.0.1:port (port=0 means pick free)."""
    # Pre-load the model BEFORE binding the port so clients don't connect to
    # a daemon that's still warming.
    print("[rerank] daemon: pre-loading model...", file=sys.stderr, flush=True)
    model = load_model(max_length=DEFAULT_MAX_LENGTH)
    # Warm-up predict pass to compile internal caches (kernel autotune etc).
    t0 = time.perf_counter()
    _ = model.predict([("warmup", "warmup pair")], batch_size=1)
    print(f"[rerank] daemon: warmup predict: {(time.perf_counter()-t0)*1000:.1f}ms",
          file=sys.stderr, flush=True)

    server = _ThreadingTCPServer(("127.0.0.1", port), _RerankHandler)
    actual_port = server.server_address[1]
    pid = os.getpid()
    _write_daemon_info(pid, actual_port)
    print(f"[rerank] daemon: listening on 127.0.0.1:{actual_port} (pid={pid})",
          file=sys.stderr, flush=True)
    print(f"[rerank] daemon: info file: {DAEMON_INFO_PATH}",
          file=sys.stderr, flush=True)

    def _shutdown_handler(signum, _frame):  # noqa: ANN001
        print(f"[rerank] daemon: received signal {signum}, shutting down...",
              file=sys.stderr, flush=True)
        threading.Thread(target=server.shutdown, daemon=True).start()

    # SIGTERM is the standard shutdown signal. SIGINT (Ctrl+C) likewise.
    # Windows additionally exposes SIGBREAK for Ctrl+Break.
    for sig_name in ("SIGTERM", "SIGINT", "SIGBREAK"):
        sig = getattr(signal, sig_name, None)
        if sig is not None:
            try:
                signal.signal(sig, _shutdown_handler)
            except (ValueError, OSError):
                # Some signals can't be installed on the main thread on Windows
                # (e.g. when running under certain harnesses). Skip silently.
                pass

    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        try:
            server.server_close()
        finally:
            _delete_daemon_info()
            print("[rerank] daemon: stopped, info file cleaned up",
                  file=sys.stderr, flush=True)
    return 0


# ---------------------------------------------------------------------------
# Daemon client (used by recall_learnings.py via the helper functions below)
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

    Windows note: ``os.kill(pid, 0)`` raises ``OSError [WinError 87]
    (parameter incorrect)`` on Windows for ANY pid -- the kernel rejects
    signal 0 -- so we can't distinguish alive from dead via os.kill there.
    We use OpenProcess (PROCESS_QUERY_LIMITED_INFORMATION) via ctypes
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
            handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
            if not handle:
                return False
            # GetExitCodeProcess returns STILL_ACTIVE (259) for live processes
            # but a process that exited with code 259 would fool that check.
            # Holding a handle is enough -- if the pid is reused by a brand new
            # process we'd false-positive, but for our daemon discovery this
            # is acceptable (worst case: send to dead-pid daemon, connect
            # fails, fall back to subprocess).
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


def ping_daemon(timeout_s: float = 0.2) -> dict[str, Any] | None:
    """TCP ping the rerank daemon. Returns the response dict or None.

    Lighter than a full rerank request; used by ``daemon_is_alive`` to
    confirm the server is accepting connections (not just PID-alive).
    """
    info = read_daemon_info()
    if not info:
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


def daemon_is_alive() -> tuple[bool, dict[str, Any] | None]:
    """Return (alive, info) for the rerank daemon.

    Checks both PID liveness and a TCP ping so callers don't attempt a
    full rerank request against a daemon that is still binding its port.
    There is a window between process spawn and ``serve_forever()`` where
    the PID is alive but the socket is not yet accepting -- a PID-only
    check would return True and the subsequent ``rerank_via_daemon`` call
    would fail and fall back to subprocess. The TCP ping closes this window.
    (Phase 2 MEDIUM-1)
    """
    info = read_daemon_info()
    if not info:
        return False, None
    pid = int(info.get("pid", 0))
    if not _pid_alive(pid):
        return False, info
    # PID is alive; confirm the TCP server is actually accepting connections.
    reply = ping_daemon(timeout_s=1.5)
    if reply and reply.get("status") == "ok":
        return True, info
    # Ping failed -- PID alive but socket not yet ready (or daemon hung).
    return False, info


def rerank_via_daemon(
    query: str,
    candidates: list[dict[str, Any]],
    top_k: int = DEFAULT_TOP_K,
    batch_size: int = DEFAULT_BATCH_SIZE,
    max_length: int = DEFAULT_MAX_LENGTH,
    timeout_s: float = 30.0,
) -> dict[str, Any] | None:
    """Send a rerank request to the daemon, return its response.

    Returns ``None`` if the daemon is unreachable (caller should fall back
    to subprocess one-shot).
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
            _send_frame(sock, {
                "cmd": "rerank",
                "query": query,
                "candidates": candidates,
                "top_k": top_k,
                "batch_size": batch_size,
                "max_length": max_length,
            })
            return _recv_frame(sock)
    except (OSError, EOFError, json.JSONDecodeError):
        return None


# ---------------------------------------------------------------------------
# Bench mode (verification gate for the latency budget)
# ---------------------------------------------------------------------------

def _run_bench(args: argparse.Namespace) -> int:
    """Internal hot-loop bench: 10 reranks of a 50-candidate dummy list."""
    # Build a fixed dummy corpus so the bench is reproducible-ish.
    query = "memory hardening reranker performance"
    base_texts = [
        "Phase 2 of the memory system adds a cross-encoder reranker on top of hybrid RRF.",
        "The reranker uses BAAI/bge-reranker-v2-m3 with max_length 256 and batch size 32.",
        "Cold latency is dominated by model load (~50s on Windows CPU).",
        "Daemon mode pre-warms the model so request hot path stays under a second.",
        "Top-50 RRF candidates are reduced to top-K after rerank, default K=5.",
        "Hooks fire on file edits to keep diagnostics fresh.",
        "Reranker scores are raw logits when activation_fn=Identity is forced.",
        "Sentence-transformers v5 ships Sigmoid by default for this model.",
        "Postgres hybrid recall fuses FTS and pgvector via reciprocal rank fusion.",
        "Memory entries store base_score, decay_weight, age_days, final_score.",
    ]
    # Repeat to get 50 candidates.
    candidates = []
    for i in range(50):
        candidates.append({
            "id": f"dummy-{i}",
            "content": base_texts[i % len(base_texts)] + f" item {i}",
            "base_score": 0.02 - (i * 0.0001),
        })

    # Cold-load timing
    t_cold = time.perf_counter()
    model = load_model(max_length=args.max_length)
    cold_ms = (time.perf_counter() - t_cold) * 1000

    # Single warmup
    t_warm = time.perf_counter()
    _ = model.predict([("warmup", "warmup")], batch_size=1)
    warmup_ms = (time.perf_counter() - t_warm) * 1000

    # 10 hot reranks
    times: list[float] = []
    for _ in range(10):
        # Deepcopy not needed; rerank mutates `rerank_score` but doesn't
        # remove the items, and we don't care about score consistency here.
        cands = [dict(c) for c in candidates]
        t0 = time.perf_counter()
        rerank(
            query=query,
            candidates=cands,
            top_k=args.top_k,
            max_length=args.max_length,
            batch_size=args.batch_size,
            model=model,
        )
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
        "candidates": 50,
        "top_k": args.top_k,
        "batch_size": args.batch_size,
        "max_length": args.max_length,
    }
    print(json.dumps(out, indent=2))
    return 0


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    """Build the argparse CLI."""
    p = argparse.ArgumentParser(
        prog="rerank.py",
        description="Stage-2 cross-encoder reranker for memory recall.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    # Mode selectors -- mutually exclusive in practice but argparse handles
    # them via the dispatch in main().
    p.add_argument("--query", default=None, help="Query string (one-shot mode).")
    p.add_argument(
        "--candidates-from-stdin",
        action="store_true",
        help="Read JSONL candidates from stdin (one-shot mode).",
    )
    p.add_argument("--top-k", type=int, default=DEFAULT_TOP_K,
                   help=f"Number of results to return (default {DEFAULT_TOP_K}).")
    p.add_argument("--max-length", type=int, default=DEFAULT_MAX_LENGTH,
                   help=f"Token truncation length (default {DEFAULT_MAX_LENGTH}).")
    p.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE,
                   help=f"Predict batch size (default {DEFAULT_BATCH_SIZE}).")
    p.add_argument("--daemon", action="store_true",
                   help="Run as a long-lived TCP daemon on 127.0.0.1.")
    p.add_argument("--port", type=int, default=0,
                   help="TCP port for daemon mode (0 = pick free port).")
    p.add_argument("--bench", action="store_true",
                   help="Run internal hot-loop bench (10x rerank of 50 candidates).")
    return p


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint."""
    args = _build_parser().parse_args(argv)
    if args.daemon:
        return _run_daemon(args.port)
    if args.bench:
        return _run_bench(args)
    if args.candidates_from_stdin:
        if not args.query:
            print("[rerank] --query is required with --candidates-from-stdin",
                  file=sys.stderr)
            return 2
        return _run_oneshot(args)
    print(
        "[rerank] no mode selected. Use --daemon, --bench, "
        "or --candidates-from-stdin (with --query).",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
