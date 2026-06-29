"""Unit tests for the ST-05 `recall` op in embedding_daemon.py.

Run entirely offline: the resident BGE model is NEVER loaded (we patch the
module-level `embed`), and the asyncpg pool is never created (we drive a real
lightweight background asyncio loop and patch `do_recall`). This isolates the
daemon-side recall plumbing (H1/H2/H6 + additive ping) from the model + DB.

Covered:
- ping is backward-compatible: keeps ok/ready/model/dim and ADDS recall_ready
  + loop_ok.
- recall handler returns ok:false when recall is not ready (R2 fallback).
- recall handler success returns ok:true + results + _meta(model,dim) + elapsed_ms
  and embeds the query in-process with the resident model (H6).
- H1: any internal exception (do_recall raises) -> ok:false, never ok:true []
- H2: a dead/closed loop -> run_coroutine_threadsafe RuntimeError at submit ->
  ok:false AND recall_ready is cleared.
- H2: a slow coroutine that exceeds the timeout -> ok:false (no hang).
"""
from __future__ import annotations

import asyncio
import sys
import threading
import time
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from scripts.core import embedding_daemon as ed


# ---------------------------------------------------------------------------
# Helpers: a real background asyncio loop (no DB), and module-state reset.
# ---------------------------------------------------------------------------

def _start_bg_loop():
    loop = asyncio.new_event_loop()
    t = threading.Thread(target=loop.run_forever, daemon=True)
    t.start()
    # Wait until the loop is actually running.
    for _ in range(100):
        if loop.is_running():
            break
        time.sleep(0.01)
    return loop, t


def _stop_bg_loop(loop):
    # Cancel any still-pending tasks (e.g. the timeout test's abandoned slow()
    # coroutine) BEFORE stopping/closing, so none is "destroyed while pending".
    async def _cancel_pending():
        me = asyncio.current_task()
        pending = [t for t in asyncio.all_tasks() if t is not me and not t.done()]
        for t in pending:
            t.cancel()
        for t in pending:
            try:
                await t
            except BaseException:
                pass  # CancelledError or the coro's own error — both fine here

    if loop.is_running():
        try:
            fut = asyncio.run_coroutine_threadsafe(_cancel_pending(), loop)
            fut.result(timeout=2.0)
        except Exception:
            pass

    loop.call_soon_threadsafe(loop.stop)
    for _ in range(100):
        if not loop.is_running():
            break
        time.sleep(0.01)
    loop.close()


@pytest.fixture(autouse=True)
def _reset_recall_state():
    """Snapshot + restore the module-level recall runtime globals per test."""
    saved = (ed._RECALL_LOOP, ed._RECALL_THREAD, ed._RECALL_READY)
    ed._RECALL_LOOP = None
    ed._RECALL_THREAD = None
    ed._RECALL_READY = False
    yield
    ed._RECALL_LOOP, ed._RECALL_THREAD, ed._RECALL_READY = saved


# ---------------------------------------------------------------------------
# ping backward-compatibility
# ---------------------------------------------------------------------------

class TestPingRecallFields:
    def test_ping_payload_has_legacy_and_new_fields(self):
        payload = ed._build_ping_response()
        # Legacy fields unchanged.
        assert payload["ok"] is True
        assert "ready" in payload
        assert payload["model"] == ed.MODEL_NAME
        assert payload["dim"] == ed.EMBEDDING_DIM
        # New additive fields.
        assert "recall_ready" in payload
        assert "loop_ok" in payload

    def test_ping_recall_ready_reflects_flag(self):
        ed._RECALL_READY = False
        assert ed._build_ping_response()["recall_ready"] is False
        ed._RECALL_READY = True
        assert ed._build_ping_response()["recall_ready"] is True


# ---------------------------------------------------------------------------
# recall handler
# ---------------------------------------------------------------------------

class TestRecallHandler:
    def test_not_ready_returns_ok_false(self):
        ed._RECALL_READY = False
        resp = ed._handle_recall_request({"cmd": "recall", "query": "x", "k": 3})
        assert resp["ok"] is False
        assert "error" in resp

    def test_empty_query_returns_ok_false(self):
        ed._RECALL_READY = True
        resp = ed._handle_recall_request({"cmd": "recall", "query": "   ", "k": 3})
        assert resp["ok"] is False

    def test_success_shape_and_inprocess_embed(self):
        loop, t = _start_bg_loop()
        try:
            ed._RECALL_LOOP = loop
            ed._RECALL_READY = True

            async def fake_do_recall(query_vector, query_text, k, mode, **kwargs):
                # Echo so we can assert the embed vector + text flowed through.
                # **kwargs absorbs the forwarded project_id / scope_mode.
                return {
                    "results": [{"id": "abc", "score": 0.03, "content": query_text}],
                    "_meta": {"vector_count": 1, "fts_count": 1, "threshold_drops": 0},
                }

            sentinel_vec = [0.7] * ed.EMBEDDING_DIM
            with patch.object(ed, "embed", return_value=sentinel_vec) as mock_embed, \
                 patch.object(ed, "_get_do_recall", lambda: fake_do_recall):
                resp = ed._handle_recall_request(
                    {"cmd": "recall", "query": "hello world", "k": 3, "mode": "hybrid"}
                )

            mock_embed.assert_called_once()
            assert resp["ok"] is True
            assert resp["results"] == [{"id": "abc", "score": 0.03, "content": "hello world"}]
            # H6: _meta carries model + dim (resident model identity).
            assert resp["_meta"]["model"] == ed.MODEL_NAME
            assert resp["_meta"]["dim"] == ed.EMBEDDING_DIM
            assert resp["_meta"]["vector_count"] == 1
            assert "elapsed_ms" in resp
        finally:
            _stop_bg_loop(loop)

    def test_forwards_request_scope_to_do_recall(self):
        """ST-05 cross-project parity: req project_id/scope_mode reach do_recall."""
        loop, t = _start_bg_loop()
        try:
            ed._RECALL_LOOP = loop
            ed._RECALL_READY = True
            captured = {}

            async def capture(query_vector, query_text, k, mode, **kwargs):
                captured.update(kwargs)
                return {"results": [], "_meta": {}}

            with patch.object(ed, "embed", return_value=[0.7] * ed.EMBEDDING_DIM), \
                 patch.object(ed, "_get_do_recall", lambda: capture):
                resp = ed._handle_recall_request({
                    "cmd": "recall", "query": "hi", "k": 3, "mode": "hybrid",
                    "project_id": "CALLER_PID", "scope_mode": "project",
                })

            assert resp["ok"] is True
            assert captured.get("project_id") == "CALLER_PID"
            assert captured.get("scope_mode") == "project"
        finally:
            _stop_bg_loop(loop)

    def test_h1_do_recall_exception_returns_ok_false(self):
        """H1: an internal error must NOT masquerade as empty results."""
        loop, t = _start_bg_loop()
        try:
            ed._RECALL_LOOP = loop
            ed._RECALL_READY = True

            async def boom(query_vector, query_text, k, mode, **kwargs):
                raise RuntimeError("db blew up")

            with patch.object(ed, "embed", return_value=[0.7] * ed.EMBEDDING_DIM), \
                 patch.object(ed, "_get_do_recall", lambda: boom):
                resp = ed._handle_recall_request(
                    {"cmd": "recall", "query": "hello", "k": 3}
                )

            assert resp["ok"] is False
            assert "results" not in resp or resp.get("results") == []
            assert "error" in resp
        finally:
            _stop_bg_loop(loop)

    def test_h2_dead_loop_clears_recall_ready(self):
        """H2: submitting to a closed loop raises RuntimeError synchronously."""
        loop, t = _start_bg_loop()
        _stop_bg_loop(loop)  # loop is now closed/dead
        ed._RECALL_LOOP = loop
        ed._RECALL_READY = True

        with patch.object(ed, "embed", return_value=[0.7] * ed.EMBEDDING_DIM):
            resp = ed._handle_recall_request({"cmd": "recall", "query": "hello", "k": 3})

        assert resp["ok"] is False
        assert ed._RECALL_READY is False   # watchdog cleared the flag

    def test_h2_timeout_returns_ok_false(self):
        """H2: a coroutine slower than the timeout -> ok:false (no hang)."""
        loop, t = _start_bg_loop()
        try:
            ed._RECALL_LOOP = loop
            ed._RECALL_READY = True

            async def slow(query_vector, query_text, k, mode, **kwargs):
                await asyncio.sleep(5.0)
                return {"results": [], "_meta": {}}

            with patch.object(ed, "embed", return_value=[0.7] * ed.EMBEDDING_DIM), \
                 patch.object(ed, "_get_do_recall", lambda: slow), \
                 patch.object(ed, "RECALL_TIMEOUT_S", 0.2):
                t0 = time.perf_counter()
                resp = ed._handle_recall_request({"cmd": "recall", "query": "hi", "k": 3})
                elapsed = time.perf_counter() - t0

            assert resp["ok"] is False
            assert elapsed < 2.0   # bounded by the timeout, not the 5s sleep
        finally:
            _stop_bg_loop(loop)
