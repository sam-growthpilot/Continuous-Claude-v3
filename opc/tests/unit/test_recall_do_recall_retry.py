"""Unit tests for do_recall's H3 stale-connection retry hardening (A2).

The retry already recovers from a single stale pooled connection (asyncpg
discards a broken conn on release). A2 adds _recycle_pool_best_effort() before
the single retry so a FULL Postgres restart (every pooled conn dead at once)
recovers immediately rather than gradually. These tests pin:
  - a retryable DB error triggers exactly ONE retry,
  - the pool is recycled between the two attempts,
  - a non-retryable error is NOT retried / not swallowed.
Runs offline: the search function + the pool-recycle helper are patched.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import asyncpg

sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # opc root

from scripts.core import recall_learnings as rl


def test_retries_once_and_recycles_pool_on_stale_conn():
    calls = {"n": 0}

    async def flaky(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            raise asyncpg.exceptions.InterfaceError("connection is closed")
        return []  # second attempt succeeds (empty but completed)

    recycle = AsyncMock()
    with patch.object(rl, "search_learnings_hybrid_rrf", flaky), \
         patch.object(rl, "_recycle_pool_best_effort", recycle):
        out = asyncio.run(
            rl.do_recall(
                query_vector=[0.1] * 1024, query_text="hi", k=3, mode="hybrid",
                project_id="P", scope_mode="project",
            )
        )

    assert calls["n"] == 2                      # retried exactly once
    recycle.assert_awaited_once()               # pool recycled before the retry
    assert out["_meta"]["db_error"].startswith("retry_after:InterfaceError")
    assert out["results"] == []


def test_success_first_try_does_not_recycle():
    async def ok(*args, **kwargs):
        return []

    recycle = AsyncMock()
    with patch.object(rl, "search_learnings_hybrid_rrf", ok), \
         patch.object(rl, "_recycle_pool_best_effort", recycle):
        out = asyncio.run(
            rl.do_recall(
                query_vector=[0.1] * 1024, query_text="hi", k=3, mode="hybrid",
                project_id="P", scope_mode="project",
            )
        )

    recycle.assert_not_awaited()                 # no failure -> no recycle
    assert "db_error" not in out["_meta"]


def test_non_retryable_error_propagates_without_recycle():
    async def boom(*args, **kwargs):
        raise ValueError("not a connection error")

    recycle = AsyncMock()
    with patch.object(rl, "search_learnings_hybrid_rrf", boom), \
         patch.object(rl, "_recycle_pool_best_effort", recycle):
        try:
            asyncio.run(
                rl.do_recall(
                    query_vector=[0.1] * 1024, query_text="hi", k=3, mode="hybrid",
                    project_id="P", scope_mode="project",
                )
            )
            raised = False
        except ValueError:
            raised = True

    assert raised is True                        # H1: error propagates (-> ok:false)
    recycle.assert_not_awaited()
