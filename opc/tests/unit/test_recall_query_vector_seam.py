"""Unit tests for the ST-05 query_vector seam + do_recall in recall_learnings.py.

These cover the PYTHON layer of the resident recall daemon (ST-05-DESIGN.md,
v2 H1/H3/H4/H6). All tests run offline: the DB pool and embedder are mocked.

Covered:
- search_learnings_hybrid_rrf(query_vector=...) SKIPS the embed and uses the
  provided vector for the pgvector leg, while STILL passing the query text to
  the FTS leg ($1) (H4 — hybrid must not silently degrade to vector-only).
- The CLI path (query_vector=None) is unchanged: it still embeds.
- stats_out captures vector_count / fts_count / threshold_drops (H1 _meta).
- do_recall returns the SAME dict shape the --json serializer builds, with
  the recall _meta block, and validates inputs (H4 + zero-vector rejection).
- _serialize_results_json parity: do_recall result entries are byte-identical
  to the CLI --json serializer for the same result rows.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from tests.conftest import MockEmbeddingService, MockRecord, make_learning


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_pool():
    """Mock asyncpg pool with async-context-manager acquire()."""
    pool = MagicMock()
    conn = AsyncMock()
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=conn)
    cm.__aexit__ = AsyncMock(return_value=None)
    pool.acquire.return_value = cm
    return pool, conn


def _rrf_row(learning: dict, rrf_score: float, fts_rank, vec_rank) -> MockRecord:
    return MockRecord({
        "id": learning["id"],
        "session_id": learning["session_id"],
        "content": learning["content"],
        "metadata": json.dumps(learning["metadata"]),
        "created_at": learning["created_at"],
        "rrf_score": rrf_score,
        "fts_rank": fts_rank,
        "vec_rank": vec_rank,
    })


# ---------------------------------------------------------------------------
# search_learnings_hybrid_rrf query_vector seam
# ---------------------------------------------------------------------------

class TestHybridRrfQueryVectorSeam:
    @pytest.mark.asyncio
    async def test_provided_vector_skips_embed(self, sample_learnings):
        """When query_vector is given, _embed_query_with_daemon is NOT called."""
        pool, conn = _mock_pool()
        conn.fetch = AsyncMock(return_value=[_rrf_row(sample_learnings[0], 0.03, 1, 2)])

        async def mock_get_pool():
            return pool

        async def mock_init_pgvector(_conn):
            pass

        qv = [0.5] * 1024
        with patch("db.postgres_pool.get_pool", mock_get_pool), \
             patch("db.postgres_pool.init_pgvector", mock_init_pgvector), \
             patch("scripts.core.recall_learnings._embed_query_with_daemon",
                   new_callable=AsyncMock) as mock_embed:
            from scripts.core.recall_learnings import search_learnings_hybrid_rrf
            results = await search_learnings_hybrid_rrf(
                "typescript hooks", k=5, decay_lambda=0, query_vector=qv,
            )

        mock_embed.assert_not_called()
        assert len(results) == 1
        assert results[0]["base_score"] == 0.03

    @pytest.mark.asyncio
    async def test_provided_vector_used_for_pgvector_leg_and_text_for_fts(
        self, sample_learnings
    ):
        """The provided vector is the $2 embedding arg; query text is $1 (FTS)."""
        pool, conn = _mock_pool()
        conn.fetch = AsyncMock(return_value=[_rrf_row(sample_learnings[0], 0.03, 1, 2)])

        async def mock_get_pool():
            return pool

        async def mock_init_pgvector(_conn):
            pass

        qv = [0.25] * 1024
        with patch("db.postgres_pool.get_pool", mock_get_pool), \
             patch("db.postgres_pool.init_pgvector", mock_init_pgvector):
            from scripts.core.recall_learnings import search_learnings_hybrid_rrf
            await search_learnings_hybrid_rrf(
                "my query text", k=5, decay_lambda=0, query_vector=qv,
            )

        # conn.fetch(sql, query_text, str(query_embedding), rrf_k, k*2, ...)
        args = conn.fetch.call_args.args
        assert args[1] == "my query text"          # $1 -> FTS leg (H4)
        assert args[2] == str(qv)                    # $2 -> pgvector leg

    @pytest.mark.asyncio
    async def test_none_vector_still_embeds(self, sample_learnings):
        """CLI path (query_vector=None) is unchanged: embed is invoked."""
        pool, conn = _mock_pool()
        conn.fetch = AsyncMock(return_value=[_rrf_row(sample_learnings[0], 0.03, 1, 2)])

        async def mock_get_pool():
            return pool

        async def mock_init_pgvector(_conn):
            pass

        with patch("db.postgres_pool.get_pool", mock_get_pool), \
             patch("db.postgres_pool.init_pgvector", mock_init_pgvector), \
             patch("scripts.core.recall_learnings._embed_query_with_daemon",
                   new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [0.1] * 1024
            from scripts.core.recall_learnings import search_learnings_hybrid_rrf
            await search_learnings_hybrid_rrf("typescript", k=5, query_vector=None)

        mock_embed.assert_called_once()

    @pytest.mark.asyncio
    async def test_stats_out_populated(self, sample_learnings):
        """stats_out captures vector_count, fts_count, threshold_drops."""
        pool, conn = _mock_pool()
        rows = [
            _rrf_row(sample_learnings[0], 0.03, 1, 1),      # kept, both arms
            _rrf_row(sample_learnings[1], 0.001, 10, None),  # dropped by threshold, fts only
        ]
        conn.fetch = AsyncMock(return_value=rows)

        async def mock_get_pool():
            return pool

        async def mock_init_pgvector(_conn):
            pass

        stats: dict = {}
        with patch("db.postgres_pool.get_pool", mock_get_pool), \
             patch("db.postgres_pool.init_pgvector", mock_init_pgvector):
            from scripts.core.recall_learnings import search_learnings_hybrid_rrf
            await search_learnings_hybrid_rrf(
                "typescript", k=5, similarity_threshold=0.01,
                query_vector=[0.5] * 1024, stats_out=stats,
            )

        assert stats["vector_count"] == 1      # only row0 had vec_rank
        assert stats["fts_count"] == 2         # both had fts_rank
        assert stats["threshold_drops"] == 1   # row1 dropped


# ---------------------------------------------------------------------------
# do_recall result-shape parity + validation
# ---------------------------------------------------------------------------

class TestDoRecall:
    @pytest.mark.asyncio
    async def test_returns_results_and_meta_shape(self, sample_learnings):
        """do_recall returns {results:[...], _meta:{vector_count,fts_count,threshold_drops}}."""
        pool, conn = _mock_pool()
        conn.fetch = AsyncMock(return_value=[_rrf_row(sample_learnings[0], 0.03, 1, 2)])

        async def mock_get_pool():
            return pool

        async def mock_init_pgvector(_conn):
            pass

        with patch("db.postgres_pool.get_pool", mock_get_pool), \
             patch("db.postgres_pool.init_pgvector", mock_init_pgvector), \
             patch("scripts.core.recall_learnings.resolve_recall_scope",
                   return_value=(None, "all")):
            from scripts.core.recall_learnings import do_recall
            out = await do_recall([0.5] * 1024, "typescript hooks", k=5, mode="hybrid")

        assert set(out.keys()) == {"results", "_meta"}
        assert isinstance(out["results"], list) and len(out["results"]) == 1
        entry = out["results"][0]
        # Exact --json entry shape (no extra/missing required keys).
        for key in ("id", "score", "base_score", "decay_weight", "final_score",
                    "age_days", "session_id", "content", "created_at"):
            assert key in entry
        assert set(out["_meta"].keys()) >= {"vector_count", "fts_count", "threshold_drops"}

    @pytest.mark.asyncio
    async def test_serializer_parity_with_cli(self):
        """do_recall serializes via the SAME _serialize_results_json the CLI uses.

        Deterministic: the search function is mocked to return a fixed row, so
        we assert do_recall's serialized output is byte-identical to running the
        shared serializer over that exact row (no decay/time drift between runs).
        """
        from scripts.core import recall_learnings as rl

        fixed = [{
            "id": "abc",
            "similarity": 0.0123,
            "base_score": 0.03,
            "decay_weight": 0.41,
            "final_score": 0.0123,
            "age_days": 5,
            "session_id": "sess-1",
            "content": "hello world",
            "created_at": datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
            "valid_from": datetime(2026, 1, 1, tzinfo=timezone.utc),
            "valid_until": None,
        }]

        async def fixed_search(*args, **kwargs):
            stats = kwargs.get("stats_out")
            if stats is not None:
                stats["vector_count"] = 1
                stats["fts_count"] = 1
                stats["threshold_drops"] = 0
            # Return a copy so the serializer can't mutate the fixture.
            return [dict(fixed[0])]

        with patch.object(rl, "search_learnings_hybrid_rrf", fixed_search), \
             patch("scripts.core.recall_learnings.resolve_recall_scope",
                   return_value=(None, "all")):
            out = await rl.do_recall([0.5] * 1024, "hello world", k=5, mode="hybrid")

        assert out["results"] == rl._serialize_results_json(fixed)
        assert out["_meta"]["vector_count"] == 1

    @pytest.mark.asyncio
    async def test_zero_vector_rejected(self):
        """All-zero vector is rejected (H4 / zero-vector fixture) -> raises."""
        from scripts.core.recall_learnings import do_recall
        with pytest.raises(ValueError):
            await do_recall([0.0] * 1024, "typescript", k=5, mode="hybrid")

    @pytest.mark.asyncio
    async def test_empty_text_rejected_for_hybrid(self):
        """Empty query_text rejected for hybrid (H4: FTS leg requires text)."""
        from scripts.core.recall_learnings import do_recall
        with pytest.raises(ValueError):
            await do_recall([0.5] * 1024, "   ", k=5, mode="hybrid")

    @pytest.mark.asyncio
    async def test_retry_once_on_stale_connection(self, sample_learnings):
        """H3: a retryable connection error triggers exactly one retry, then succeeds."""
        import asyncpg
        from scripts.core import recall_learnings as rl

        calls = {"n": 0}

        async def flaky_search(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise asyncpg.exceptions.ConnectionDoesNotExistError("stale")
            return []

        with patch.object(rl, "search_learnings_hybrid_rrf", flaky_search), \
             patch("scripts.core.recall_learnings.resolve_recall_scope",
                   return_value=(None, "all")):
            out = await rl.do_recall([0.5] * 1024, "typescript", k=5, mode="hybrid")

        assert calls["n"] == 2                       # original + one retry
        assert out["results"] == []
        assert "db_error" in out["_meta"]            # recovered-after-retry noted

    @pytest.mark.asyncio
    async def test_retry_exhausted_propagates(self):
        """H3: a second failure propagates (daemon handler maps it to ok:false)."""
        import asyncpg
        from scripts.core import recall_learnings as rl

        async def always_fail(*args, **kwargs):
            raise asyncpg.exceptions.InterfaceError("dead")

        with patch.object(rl, "search_learnings_hybrid_rrf", always_fail), \
             patch("scripts.core.recall_learnings.resolve_recall_scope",
                   return_value=(None, "all")):
            with pytest.raises(asyncpg.exceptions.InterfaceError):
                await rl.do_recall([0.5] * 1024, "typescript", k=5, mode="hybrid")


class TestDoRecallScope:
    """Cross-project scope parity (ST-05 review fix).

    The resident daemon's CWD is its launch dir, NOT where the uv fallback runs.
    do_recall must therefore (a) honor a caller-forwarded scope verbatim, and
    (b) by default resolve scope from the OPC dir — matching the uv path's
    cwd=<opc> — rather than the ambient CWD.
    """

    @pytest.mark.asyncio
    async def test_explicit_scope_used_verbatim(self):
        """When project_id+scope_mode are forwarded, resolve_recall_scope is NOT called."""
        from scripts.core import recall_learnings as rl

        captured = {}

        async def capture_search(*args, **kwargs):
            captured["project_id"] = kwargs.get("project_id")
            captured["scope_mode"] = kwargs.get("scope_mode")
            return []

        with patch.object(rl, "search_learnings_hybrid_rrf", capture_search), \
             patch.object(rl, "resolve_recall_scope") as mock_resolve:
            out = await rl.do_recall(
                [0.5] * 1024, "typescript", k=5, mode="hybrid",
                project_id="CALLER_PID", scope_mode="project",
            )

        mock_resolve.assert_not_called()                       # forwarded -> no re-resolve
        assert captured["project_id"] == "CALLER_PID"
        assert captured["scope_mode"] == "project"
        assert out["_meta"]["project_id"] == "CALLER_PID"
        assert out["_meta"]["scope_mode"] == "project"

    @pytest.mark.asyncio
    async def test_default_scope_resolves_from_opc_dir_not_cwd(self):
        """Default scope resolves from the OPC dir (parents[2]), NOT ambient CWD."""
        from pathlib import Path
        from scripts.core import recall_learnings as rl

        opc_dir = str(Path(rl.__file__).resolve().parents[2])

        async def empty_search(*args, **kwargs):
            return []

        with patch.object(rl, "search_learnings_hybrid_rrf", empty_search), \
             patch.object(rl, "resolve_recall_scope",
                          return_value=("OPC_PID", "project")) as mock_resolve:
            await rl.do_recall([0.5] * 1024, "typescript", k=5, mode="hybrid")

        mock_resolve.assert_called_once_with(project_dir=opc_dir)
