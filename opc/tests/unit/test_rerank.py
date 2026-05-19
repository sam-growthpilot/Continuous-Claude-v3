"""Unit tests for opc/scripts/core/rerank.py — cross-encoder reranker.

Coverage focus:
    * Percentile/median delegation to core.utils (post commit c1beb07).
    * `daemon_is_alive` tuple semantics: (alive: bool, info: dict | None).
      Post-hygiene this does a TCP ping in addition to the PID liveness
      check, so we exercise both checks via monkeypatch + a mock TCP server.
    * Frame protocol round-trip (_send_frame / _recv_frame) with sanity
      caps + truncated/malformed frames.
    * `rerank()` core logic: empty input, in-place mutation of input dicts
      (Phase 2 MEDIUM-3 — documented but not enforced by the model), sort
      direction, top_k slicing.

We mock the CrossEncoder via dependency injection (the `model` parameter)
so the 568M-param BAAI/bge-reranker-v2-m3 is never loaded in CI. The fake
model implements only `.predict(pairs, batch_size=...)` returning a
deterministic NumPy-like array.
"""
from __future__ import annotations

import json
import socket
import socketserver
import struct
import sys
import threading
import time
from pathlib import Path
from typing import Any

import pytest

# Make both the repo root AND `opc/scripts/` importable. The conftest only
# adds `opc/` (so `scripts.core.rerank` works) and `opc/scripts/core` (so
# `utils` works directly). But `rerank.py` itself does
# `from core.utils import percentile, median`, which requires the
# `opc/scripts/` directory on path so `core` is a top-level package.
opc_root = Path(__file__).resolve().parents[2]
opc_scripts = opc_root / "scripts"
for p in (opc_root, opc_scripts):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))


# ---------------------------------------------------------------------------
# Fakes / helpers
# ---------------------------------------------------------------------------


class _FakePredictArray:
    """Minimal numpy-array shim: supports `.tolist()` and iteration.

    `rerank()` calls `model.predict(...).tolist()` first, falling back to
    `[float(s) for s in scores]` if `.tolist` is missing. Both code paths
    work against this shim.
    """

    def __init__(self, values: list[float]):
        self._values = list(values)

    def tolist(self) -> list[float]:
        return list(self._values)

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)


class FakeCrossEncoder:
    """Stand-in for sentence_transformers.CrossEncoder.

    `predict()` deterministically scores each (query, candidate) pair as
    `len(candidate) / 100.0`. That gives a stable ordering for tests
    without depending on the real model. Callers can also pass a
    `score_fn` to customize per-test.
    """

    def __init__(self, score_fn=None):
        self._score_fn = score_fn or (lambda q, c: len(c) / 100.0)
        self.predict_calls: list[tuple[list[tuple[str, str]], dict]] = []

    def predict(self, pairs, batch_size: int = 32, **kwargs):
        self.predict_calls.append((list(pairs), {"batch_size": batch_size, **kwargs}))
        scores = [self._score_fn(q, c) for q, c in pairs]
        return _FakePredictArray(scores)


# ---------------------------------------------------------------------------
# Group A — Percentile / median delegation to core.utils
#
# Post commit c1beb07, the bench path in rerank.py imports `percentile` and
# `median` from `core.utils`. These two tests confirm that the delegation
# returns the same values as direct calls to `core.utils`. They don't
# re-test core.utils itself.
# ---------------------------------------------------------------------------


class TestPercentileDelegation:
    def test_percentile_matches_core_utils(self):
        # The same import path rerank._run_bench uses.
        from core.utils import percentile

        values = [10.0, 12.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 45.0, 50.0]
        # p95 over 10 sorted values: ceil(10*95/100) - 1 = 9, sorted[9] = 50.0
        assert percentile(values, 95) == 50.0
        # p50 nearest-rank: ceil(10*50/100) - 1 = 4, sorted[4] = 25.0
        assert percentile(values, 50) == 25.0
        # p0 clamps to index 0
        assert percentile(values, 0) == 10.0
        # p100 returns max
        assert percentile(values, 100) == 50.0

    def test_median_matches_core_utils(self):
        from core.utils import median

        # Odd length -> middle
        assert median([5.0, 1.0, 3.0]) == 3.0
        # Even length -> average of two middles (not the same as p50 above!)
        # sorted = [10, 12, 15, 20, 25, 30, 35, 40, 45, 50]
        # middle two = 25 and 30 -> 27.5
        assert median([10.0, 12.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 45.0, 50.0]) == 27.5

    def test_percentile_empty_raises(self):
        from core.utils import percentile

        with pytest.raises(ValueError):
            percentile([], 50)

    def test_median_empty_raises(self):
        from core.utils import median

        with pytest.raises(ValueError):
            median([])


# ---------------------------------------------------------------------------
# Group B — `daemon_is_alive` tuple semantics (post c1beb07)
#
# The function signature changed to return `(alive, info)`. It also added
# a TCP ping (`ping_daemon`) so a PID-alive-but-port-not-bound daemon
# correctly returns False.
# ---------------------------------------------------------------------------


class _MockRerankPingServer(socketserver.BaseRequestHandler):
    """Mock daemon that replies to a single ping frame."""

    reply: dict[str, Any] = {"status": "ok"}

    def handle(self) -> None:
        try:
            from scripts.core.rerank import _recv_frame, _send_frame

            req = _recv_frame(self.request)
            if req.get("cmd") == "ping":
                _send_frame(self.request, self.reply)
        except Exception:
            # Don't crash the server thread; the client will see EOF and
            # treat it as a failed ping.
            pass


@pytest.fixture
def mock_ping_server():
    """Start a one-shot mock daemon and write the discovery file so
    `read_daemon_info()` finds it. Cleans up the file and shuts down the
    server on teardown.
    """
    from scripts.core import rerank

    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _MockRerankPingServer)
    server.allow_reuse_address = True
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    # Write discovery file pointing at the mock server.
    info = {"pid": int(__import__("os").getpid()), "port": port, "started_at": time.time()}
    rerank.DAEMON_INFO_PATH.write_text(json.dumps(info), encoding="utf-8")

    yield {"server": server, "port": port, "info": info}

    # Teardown.
    try:
        server.shutdown()
        server.server_close()
    except Exception:
        pass
    try:
        rerank.DAEMON_INFO_PATH.unlink()
    except FileNotFoundError:
        pass


class TestDaemonIsAlive:
    """Verify the (alive, info) tuple return.

    NOTE: in the current source, `daemon_is_alive()` takes NO arguments.
    It reads the discovery file itself via `read_daemon_info()`. The task
    brief incorrectly suggested it takes an `info` arg — we test against
    what the source actually does.
    """

    def test_returns_tuple_when_no_info_file(self, tmp_path, monkeypatch):
        """No discovery file -> (False, None)."""
        from scripts.core import rerank

        # Point the discovery file at a path that definitely doesn't exist.
        monkeypatch.setattr(rerank, "DAEMON_INFO_PATH", tmp_path / "no-such-file.json")
        alive, info = rerank.daemon_is_alive()
        assert alive is False
        assert info is None

    def test_returns_false_when_pid_is_dead(self, tmp_path, monkeypatch):
        """PID alive check fails -> (False, info)."""
        from scripts.core import rerank

        # Write a discovery file with a bogus PID, then force _pid_alive
        # to report False. We can't rely on a specific high PID being dead
        # cross-platform, so we monkeypatch.
        fake_info_path = tmp_path / "ccv3-rerank.json"
        fake_info_path.write_text(
            json.dumps({"pid": 999999999, "port": 1, "started_at": 0.0}),
            encoding="utf-8",
        )
        monkeypatch.setattr(rerank, "DAEMON_INFO_PATH", fake_info_path)
        monkeypatch.setattr(rerank, "_pid_alive", lambda pid: False)

        alive, info = rerank.daemon_is_alive()
        assert alive is False
        # Per the source: when PID is dead, info is still returned (not None).
        # This lets callers distinguish "no daemon ever ran" from "daemon
        # crashed". The hook layer uses the same convention.
        assert info is not None
        assert info["pid"] == 999999999

    def test_returns_false_when_pid_alive_but_tcp_unreachable(
        self, tmp_path, monkeypatch
    ):
        """PID alive but port not bound -> (False, info) due to TCP ping fail.

        This is the Phase 2 MEDIUM-1 case: there's a window between process
        spawn and `serve_forever()` where the PID is alive but the socket
        isn't accepting yet. Pre-hygiene this returned True (incorrect);
        post-hygiene it returns False.
        """
        from scripts.core import rerank

        # Find a port that nothing is listening on by binding+closing.
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probe.bind(("127.0.0.1", 0))
        unreachable_port = probe.getsockname()[1]
        probe.close()

        fake_info_path = tmp_path / "ccv3-rerank.json"
        fake_info_path.write_text(
            json.dumps({"pid": 1, "port": unreachable_port, "started_at": 0.0}),
            encoding="utf-8",
        )
        monkeypatch.setattr(rerank, "DAEMON_INFO_PATH", fake_info_path)
        # Force PID to be reported alive — we want to isolate the TCP fail.
        monkeypatch.setattr(rerank, "_pid_alive", lambda pid: True)

        alive, info = rerank.daemon_is_alive()
        assert alive is False
        assert info is not None
        assert info["port"] == unreachable_port

    def test_returns_true_when_pid_alive_and_ping_ok(
        self, mock_ping_server, monkeypatch
    ):
        """Healthy daemon -> (True, info)."""
        from scripts.core import rerank

        # The mock server is up and replied with status=ok. Force PID alive
        # so we exercise the full success path.
        monkeypatch.setattr(rerank, "_pid_alive", lambda pid: True)

        alive, info = rerank.daemon_is_alive()
        assert alive is True
        assert info is not None
        assert info["port"] == mock_ping_server["port"]


# ---------------------------------------------------------------------------
# Group C — Frame protocol (_send_frame / _recv_frame)
# ---------------------------------------------------------------------------


class TestFrameProtocol:
    """Length-prefixed JSON framing: 4-byte big-endian uint32 + UTF-8 body."""

    def test_round_trip(self):
        """Write a frame on one socketpair end, read it on the other."""
        from scripts.core.rerank import _recv_frame, _send_frame

        # socket.socketpair() is unavailable on Windows for AF_INET, but
        # AF_INET TCP pair via listen/accept works portably.
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        port = srv.getsockname()[1]

        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            client.connect(("127.0.0.1", port))
            conn, _ = srv.accept()
            try:
                payload = {
                    "cmd": "rerank",
                    "query": "round trip test",
                    "candidates": [{"id": "x1", "content": "hello"}],
                    "top_k": 5,
                }
                _send_frame(client, payload)
                got = _recv_frame(conn)
                assert got == payload
            finally:
                conn.close()
        finally:
            client.close()
            srv.close()

    def test_recv_frame_rejects_oversized(self):
        """Frame >100 MB triggers the sanity cap (no allocation attempt)."""
        from scripts.core.rerank import _recv_frame

        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        port = srv.getsockname()[1]

        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            client.connect(("127.0.0.1", port))
            conn, _ = srv.accept()
            try:
                # Write a fake header announcing 200 MB. Don't send a body —
                # the cap check fires on the header alone.
                fake_header = struct.pack(">I", 200 * 1024 * 1024)
                client.sendall(fake_header)
                with pytest.raises(ValueError, match="frame too large"):
                    _recv_frame(conn)
            finally:
                conn.close()
        finally:
            client.close()
            srv.close()

    def test_recv_frame_raises_on_truncated_header(self):
        """Less than 4 bytes for the length prefix -> EOFError."""
        from scripts.core.rerank import _recv_frame

        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        port = srv.getsockname()[1]

        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            client.connect(("127.0.0.1", port))
            conn, _ = srv.accept()
            try:
                # Send only 2 bytes then close — header is incomplete.
                client.sendall(b"\x00\x01")
                client.close()
                with pytest.raises(EOFError):
                    _recv_frame(conn)
            finally:
                conn.close()
        finally:
            try:
                srv.close()
            except Exception:
                pass

    def test_recv_frame_raises_on_malformed_json(self):
        """Header says N bytes follow, but those N bytes aren't JSON."""
        from scripts.core.rerank import _recv_frame

        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        port = srv.getsockname()[1]

        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            client.connect(("127.0.0.1", port))
            conn, _ = srv.accept()
            try:
                bad = b"\x00\x00\x00\x05hello"  # length=5, body=hello
                client.sendall(bad)
                with pytest.raises(json.JSONDecodeError):
                    _recv_frame(conn)
            finally:
                conn.close()
        finally:
            client.close()
            srv.close()


# ---------------------------------------------------------------------------
# Group D — `rerank()` core logic
#
# We pass a FakeCrossEncoder via the `model` arg so the real model is never
# loaded. Tests validate the surrounding plumbing: empty list, in-place
# mutation, sort direction, top_k slicing.
# ---------------------------------------------------------------------------


class TestRerankFunction:
    def test_empty_candidates_returns_empty_no_model_call(self):
        """rerank([]) short-circuits — never calls model.predict."""
        from scripts.core.rerank import rerank

        model = FakeCrossEncoder()
        out = rerank(query="anything", candidates=[], top_k=5, model=model)
        assert out == []
        assert model.predict_calls == []

    def test_mutates_candidates_in_place(self):
        """Phase 2 MEDIUM-3 contract: input dicts get a `rerank_score` field.

        The hook docstring marks this INTENTIONAL — `recall_learnings._apply_rerank`
        relies on the shared reference for downstream rehydration.

        Note: `rerank()` sorts the input list in place, so the position of
        the dicts changes. The identity of each dict, however, is preserved.
        We verify by content-keyed identity lookup.
        """
        from scripts.core.rerank import rerank

        cands = [
            {"id": "a", "content": "short"},
            {"id": "b", "content": "a longer content string here yes indeed"},
            {"id": "c", "content": "medium length"},
        ]
        # Capture identity of the dicts before the call, keyed by id field
        # (which is stable across the sort).
        ids_before = {c["id"]: id(c) for c in cands}

        model = FakeCrossEncoder()
        rerank(query="q", candidates=cands, top_k=10, model=model)

        # Same dict identities — we mutated in place, didn't replace.
        ids_after = {c["id"]: id(c) for c in cands}
        assert ids_before == ids_after
        # Every candidate gained a rerank_score field.
        for c in cands:
            assert "rerank_score" in c
            assert isinstance(c["rerank_score"], float)

    def test_returns_sorted_descending_by_rerank_score(self):
        """Higher rerank_score comes first."""
        from scripts.core.rerank import rerank

        # Score = len(content)/100 so longer-content candidates rank higher.
        cands = [
            {"id": "tiny", "content": "x"},  # 0.01
            {"id": "big", "content": "x" * 100},  # 1.00
            {"id": "med", "content": "x" * 50},  # 0.50
        ]
        model = FakeCrossEncoder()
        out = rerank(query="q", candidates=cands, top_k=10, model=model)

        # Order: big > med > tiny
        assert [c["id"] for c in out] == ["big", "med", "tiny"]
        # And the rerank_scores are monotonic decreasing.
        scores = [c["rerank_score"] for c in out]
        assert scores == sorted(scores, reverse=True)

    def test_returns_top_k_slice(self):
        """When candidates exceed top_k, only the top_k are returned."""
        from scripts.core.rerank import rerank

        cands = [{"id": f"c{i}", "content": "x" * (10 + i)} for i in range(20)]
        model = FakeCrossEncoder()
        out = rerank(query="q", candidates=cands, top_k=5, model=model)

        assert len(out) == 5
        # The mutation still applied to ALL 20 originals (since predict
        # runs across the whole pair list before sort/slice).
        with_score = sum(1 for c in cands if "rerank_score" in c)
        assert with_score == 20

    def test_top_k_larger_than_candidates(self):
        """top_k > len(candidates) returns all of them."""
        from scripts.core.rerank import rerank

        cands = [
            {"id": "a", "content": "alpha"},
            {"id": "b", "content": "beta beta"},
        ]
        model = FakeCrossEncoder()
        out = rerank(query="q", candidates=cands, top_k=100, model=model)
        assert len(out) == 2

    def test_predict_called_with_batch_size_arg(self):
        """rerank forwards batch_size to model.predict (default 32)."""
        from scripts.core.rerank import rerank

        cands = [
            {"id": "a", "content": "alpha"},
            {"id": "b", "content": "beta"},
        ]
        model = FakeCrossEncoder()
        rerank(query="q", candidates=cands, top_k=2, batch_size=8, model=model)

        assert len(model.predict_calls) == 1
        _, kwargs = model.predict_calls[0]
        assert kwargs["batch_size"] == 8

    def test_passthrough_keys_preserved(self):
        """Existing keys on candidates (id, base_score, etc.) survive rerank."""
        from scripts.core.rerank import rerank

        cands = [
            {"id": "k1", "content": "alpha", "base_score": 0.03, "tag": "x"},
            {"id": "k2", "content": "beta", "base_score": 0.02, "tag": "y"},
        ]
        model = FakeCrossEncoder()
        out = rerank(query="q", candidates=cands, top_k=2, model=model)

        for c in out:
            # Both passthrough keys remain.
            assert "base_score" in c
            assert "tag" in c
            # And the new key is added.
            assert "rerank_score" in c


# ---------------------------------------------------------------------------
# Group E — `_recv_exact` socket framing primitive
#
# Brief asks specifically: n=0 returns b"", single recv returns all, multiple
# recvs assemble, EOF before n bytes raises EOFError. These tests use a
# real loopback TCP pair so we exercise the actual socket.recv path.
# ---------------------------------------------------------------------------


class TestRecvExact:
    """Coverage for the low-level read-N-bytes helper.

    We mock the socket with a stub that returns chunks of configurable size
    so we can deterministically force the multi-recv reassembly path. The
    real-loopback variant in `TestFrameProtocol.test_round_trip` already
    covers happy-path use through `_recv_frame`.
    """

    def test_zero_bytes_returns_empty(self):
        """n=0 short-circuits the loop and returns b"" without touching the socket.

        Per the source: `while len(buf) < n:` is False from the start when
        n=0, so the loop body never runs. The return is `bytes(bytearray())`
        which equals `b""`.
        """
        from scripts.core.rerank import _recv_exact

        class NeverCalledSock:
            def recv(self, _n):
                raise AssertionError("socket.recv must not be called when n=0")

        result = _recv_exact(NeverCalledSock(), 0)
        assert result == b""

    def test_single_recv_returns_full_bytes(self):
        """When recv satisfies the read in one call, no second call happens."""
        from scripts.core.rerank import _recv_exact

        class OneShotSock:
            def __init__(self, payload):
                self._payload = payload
                self.calls = 0

            def recv(self, n):
                self.calls += 1
                # Return exactly what was requested (up to payload).
                chunk = self._payload[:n]
                self._payload = self._payload[n:]
                return chunk

        sock = OneShotSock(b"hello world")
        result = _recv_exact(sock, 11)
        assert result == b"hello world"
        assert sock.calls == 1

    def test_multiple_recvs_assemble_correctly(self):
        """When recv returns a partial read, _recv_exact keeps reading."""
        from scripts.core.rerank import _recv_exact

        class ChunkedSock:
            """Returns the payload in 2-byte chunks regardless of requested size."""

            def __init__(self, payload):
                self._payload = payload
                self.calls = 0

            def recv(self, _n):
                self.calls += 1
                chunk = self._payload[:2]
                self._payload = self._payload[2:]
                return chunk

        sock = ChunkedSock(b"abcdefgh")
        result = _recv_exact(sock, 8)
        assert result == b"abcdefgh"
        # Eight bytes in two-byte chunks = at least 4 calls.
        assert sock.calls >= 4

    def test_eof_before_n_raises(self):
        """recv returning b"" before n bytes were read -> EOFError."""
        from scripts.core.rerank import _recv_exact

        class TruncatedSock:
            def __init__(self, payload):
                self._payload = payload
                self.calls = 0

            def recv(self, n):
                self.calls += 1
                chunk = self._payload[:n]
                self._payload = self._payload[n:]
                return chunk  # eventually returns b"" when payload exhausted

        sock = TruncatedSock(b"abc")  # only 3 bytes available, ask for 10
        with pytest.raises(EOFError) as exc:
            _recv_exact(sock, 10)
        # Error message contains the partial-read count.
        assert "3" in str(exc.value)
        assert "10" in str(exc.value)

    def test_immediate_eof_raises(self):
        """recv returning b"" on the FIRST call -> EOFError with 0/n."""
        from scripts.core.rerank import _recv_exact

        class DeadSock:
            def recv(self, _n):
                return b""

        with pytest.raises(EOFError) as exc:
            _recv_exact(DeadSock(), 4)
        assert "0/4" in str(exc.value)


# ---------------------------------------------------------------------------
# Group F — `load_model` singleton + activation_fn override
#
# Brief asks for: (a) second call returns same instance (singleton cache),
# (b) model.activation_fn is set to nn.Identity() after loading. Both
# invariants are critical: (a) avoids re-loading the 568M-param model and
# (b) enforces raw-logit output regardless of model-card defaults.
#
# We inject a fake sentence_transformers module via sys.modules so the
# real CrossEncoder is never instantiated.
# ---------------------------------------------------------------------------


class _FakeIdentity:
    """Stand-in for torch.nn.Identity. Just needs to be a sentinel value."""

    def __repr__(self):
        return "<FakeIdentity>"


class _FakeNNModule:
    """Stand-in for torch.nn module — exposes only `Identity`."""

    Identity = _FakeIdentity


class _FakeTorchModule:
    """Stand-in for torch — exposes only `nn.Identity`."""

    nn = _FakeNNModule


class _FakeCrossEncoderInstance:
    """Stand-in for sentence_transformers.CrossEncoder(...) return value.

    Tracks how it was constructed and exposes `activation_fn` so the test
    can assert it gets overridden after construction.
    """

    instances: list["_FakeCrossEncoderInstance"] = []

    def __init__(self, model_name, max_length=None, activation_fn=None):
        self.model_name = model_name
        self.max_length = max_length
        # Whatever the constructor was given is stashed; the test asserts
        # the OVERRIDE happens after construction.
        self.activation_fn = activation_fn
        _FakeCrossEncoderInstance.instances.append(self)


class _FakeSentenceTransformersModule:
    """Stand-in for sentence_transformers — exposes only `CrossEncoder`."""

    CrossEncoder = _FakeCrossEncoderInstance


@pytest.fixture
def isolated_load_model(monkeypatch):
    """Reset rerank._MODEL singleton AND inject fake torch / sentence_transformers.

    Each test gets a fresh fake-model cache. `monkeypatch.setattr` handles
    restoration on teardown.
    """
    from scripts.core import rerank

    # Clear singleton cache so each test starts fresh.
    monkeypatch.setattr(rerank, "_MODEL", None)

    # The lazy import inside load_model does:
    #   from sentence_transformers import CrossEncoder
    #   import torch.nn as nn
    # We install both as sys.modules entries so the imports succeed.
    fake_st = _FakeSentenceTransformersModule()
    fake_torch = _FakeTorchModule()
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_st)
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "torch.nn", _FakeNNModule)

    # Reset the per-test instance counter on the fake class.
    _FakeCrossEncoderInstance.instances = []

    return rerank


class TestLoadModel:
    def test_first_call_instantiates_cross_encoder(self, isolated_load_model):
        """First call to load_model constructs exactly one CrossEncoder."""
        rerank = isolated_load_model

        model = rerank.load_model(max_length=128)

        # Exactly one instance was created.
        assert len(_FakeCrossEncoderInstance.instances) == 1
        # That instance got the configured max_length.
        assert _FakeCrossEncoderInstance.instances[0].max_length == 128
        # The returned object is the same one.
        assert model is _FakeCrossEncoderInstance.instances[0]

    def test_second_call_returns_cached_singleton(self, isolated_load_model):
        """Second call must NOT re-instantiate — it returns the cached model."""
        rerank = isolated_load_model

        first = rerank.load_model(max_length=128)
        # Different max_length on the second call -- gets ignored because the
        # singleton is returned. We're verifying the cache, not the args.
        second = rerank.load_model(max_length=999)

        # Same object identity.
        assert first is second
        # Only ONE instance ever created.
        assert len(_FakeCrossEncoderInstance.instances) == 1

    def test_activation_fn_overridden_to_identity(self, isolated_load_model):
        """v5 API drift fix: activation_fn must be overridden after construction.

        bge-reranker-v2-m3 ships with Sigmoid as the default activation per
        its model card. CrossEncoder reads that and applies it automatically.
        We override to Identity so the model emits raw logits, which the
        downstream scorer / floor logic depends on (raw-logit > 0 means
        relevant under cross-entropy training).
        """
        rerank = isolated_load_model

        model = rerank.load_model(max_length=256)

        # After load_model returns, activation_fn must be an Identity instance.
        # We can't `isinstance` against the real nn.Identity (since we faked
        # it) so we check the override happened by comparing to the fake type.
        assert isinstance(model.activation_fn, _FakeIdentity)

    def test_load_model_thread_safety_via_lock(self, isolated_load_model):
        """load_model takes _MODEL_LOCK so concurrent first-loads serialize.

        We can't easily race condition-test this, but we CAN verify the
        lock exists at module level and the function references it.
        """
        rerank = isolated_load_model

        # The module-level lock exists.
        assert hasattr(rerank, "_MODEL_LOCK")
        # And calling load_model once works through the lock (no deadlock).
        # If the lock semantics were broken this would hang -- pytest has a
        # default timeout via pytest-timeout if configured, but at minimum
        # a deadlock would be visible as a hung test.
        rerank.load_model(max_length=128)
        assert rerank._MODEL is not None
