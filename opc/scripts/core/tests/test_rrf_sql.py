"""Tests for the shared RRF SQL builder (Phase 3B of memory remediation).

Two RRF SQL queries had drifted across the codebase:
  - opc/scripts/core/db/memory_service_pg.py  : per-session/agent search
  - opc/scripts/core/recall_learnings.py      : global learnings recall

Both use the same Reciprocal Rank Fusion CTE pattern but with different
WHERE clauses. Phase 3B unifies the SQL skeleton in memory_service_pg.py.
recall_learnings delegates to it.

These tests exercise the SQL builder shape (string-level) — no live DB needed.
The behavioral parity check is the canary-query verification in the commit
description (top-3 IDs match before vs after on three test queries).
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# Make scripts/core/db importable as a package
_OPC_DIR = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(_OPC_DIR))


def test_build_rrf_sql_is_callable():
    """The shared builder is exported from memory_service_pg."""
    from scripts.core.db.memory_service_pg import build_rrf_sql

    assert callable(build_rrf_sql)


def test_build_rrf_sql_emits_required_ctes():
    """The generated SQL contains both fts_ranked and vector_ranked CTEs."""
    from scripts.core.db.memory_service_pg import build_rrf_sql

    sql = build_rrf_sql(
        where_clause="session_id = $1",
        text_query_param=2,
        embedding_param=3,
        rrf_k_param=4,
        limit_param=5,
    )

    assert "WITH fts_ranked AS" in sql
    assert "vector_ranked AS" in sql
    assert "combined AS" in sql
    assert "FULL OUTER JOIN" in sql
    assert "ORDER BY c.rrf_score DESC" in sql


def test_build_rrf_sql_substitutes_parameter_indices():
    """Parameter indices are substituted into FTS and vector ranking expressions."""
    from scripts.core.db.memory_service_pg import build_rrf_sql

    sql = build_rrf_sql(
        where_clause="session_id = $1 AND agent_id IS NOT DISTINCT FROM $2",
        text_query_param=3,
        embedding_param=4,
        rrf_k_param=5,
        limit_param=6,
    )

    # FTS uses text query parameter
    assert "plainto_tsquery('english', $3)" in sql
    # Vector uses embedding param (twice: in <=> distance for fts and vector CTEs)
    assert "$4::vector" in sql
    # RRF score uses rrf_k_param
    assert "1.0 / ($5 + f.fts_rank)" in sql
    assert "1.0 / ($5 + v.vec_rank)" in sql
    # LIMIT uses limit_param
    assert re.search(r"LIMIT \$6\s*$", sql.strip()) is not None


def test_build_rrf_sql_applies_where_clause_to_both_ctes():
    """The custom WHERE clause appears in BOTH ranking CTEs (FTS and vector)."""
    from scripts.core.db.memory_service_pg import build_rrf_sql

    where = "metadata->>'type' = 'WORKING_SOLUTION'"
    sql = build_rrf_sql(
        where_clause=where,
        text_query_param=1,
        embedding_param=2,
        rrf_k_param=3,
        limit_param=4,
    )

    # The where clause should occur at least twice -- once per CTE.
    occurrences = sql.count(where)
    assert occurrences >= 2, f"WHERE clause appeared {occurrences} times, expected ≥ 2"


def test_build_rrf_sql_select_columns_default():
    """Default SELECT projects id, content, metadata, created_at, rrf_score."""
    from scripts.core.db.memory_service_pg import build_rrf_sql

    sql = build_rrf_sql(
        where_clause="session_id = $1",
        text_query_param=2,
        embedding_param=3,
        rrf_k_param=4,
        limit_param=5,
    )

    # Must select these from the joined archival_memory rows
    for col in ("a.id", "a.content", "a.metadata", "a.created_at", "c.rrf_score"):
        assert col in sql, f"missing column {col} in default SELECT"


def test_build_rrf_sql_extra_select_columns():
    """When extra columns are requested, they appear in the final SELECT."""
    from scripts.core.db.memory_service_pg import build_rrf_sql

    sql = build_rrf_sql(
        where_clause="session_id = $1",
        text_query_param=2,
        embedding_param=3,
        rrf_k_param=4,
        limit_param=5,
        extra_select=["a.session_id", "c.fts_rank", "c.vec_rank"],
    )

    assert "a.session_id" in sql
    assert "c.fts_rank" in sql
    assert "c.vec_rank" in sql


def test_recall_learnings_uses_shared_builder():
    """recall_learnings imports the shared builder rather than inlining SQL."""
    import importlib.util

    rl_path = (
        _OPC_DIR
        / "scripts"
        / "core"
        / "recall_learnings.py"
    )
    src = rl_path.read_text(encoding="utf-8")

    # Module imports the shared builder.
    assert "build_rrf_sql" in src, (
        "recall_learnings.py should import build_rrf_sql from memory_service_pg"
    )

    # The hardcoded RRF CTE is no longer inlined in recall_learnings.
    # Specifically: only ONE place should still contain the literal 'WITH fts_ranked AS'
    # if any -- the shared builder is the only source of truth.
    fts_inline_count = src.count("WITH fts_ranked AS")
    assert fts_inline_count == 0, (
        f"recall_learnings.py still has {fts_inline_count} inlined RRF CTE(s); "
        "should delegate to build_rrf_sql"
    )


def test_memory_service_pg_uses_shared_builder():
    """MemoryServicePG.search_hybrid_rrf delegates to build_rrf_sql too."""
    msvc_path = (
        _OPC_DIR
        / "scripts"
        / "core"
        / "db"
        / "memory_service_pg.py"
    )
    src = msvc_path.read_text(encoding="utf-8")

    # The function exists and uses build_rrf_sql
    assert "def search_hybrid_rrf" in src
    # search_hybrid_rrf should reference the shared builder
    # Find the body of search_hybrid_rrf
    idx = src.find("async def search_hybrid_rrf")
    assert idx != -1
    # Look ahead 4000 chars for the next "async def" or end
    end = src.find("async def ", idx + 1)
    if end == -1:
        end = len(src)
    body = src[idx:end]

    # The body should call build_rrf_sql (not contain raw "WITH fts_ranked AS")
    assert "build_rrf_sql" in body, (
        "search_hybrid_rrf body should call build_rrf_sql"
    )
    assert body.count("WITH fts_ranked AS") == 0, (
        "search_hybrid_rrf should not still inline the CTE"
    )
