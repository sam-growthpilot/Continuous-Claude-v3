"""Tests for recall isolation: PROJECT-scoped recall must filter by project_id.

This test documents a known gap: ``recall_learnings.py`` queries
``archival_memory`` without filtering on ``project_id``/``scope``. The dedup
side (Phase 4C) is project-scoped, but the read side is global. A new project
running ``/recall`` sees every learning from every past project.

Status today: this test is EXPECTED TO FAIL. After a future remediation
that adds a ``project_id`` filter on PROJECT-scoped recall, it will pass.

Two integration tests:
  1. ``test_recall_filters_by_project_scope`` -- seed two PROJECT rows in
     different ``project_id``s, recall from a third ``project_id``, assert
     zero seeded rows returned. Today: BOTH leak through.
  2. ``test_recall_text_only_filters_by_project_scope`` -- same canary, but
     via the ``--text-only`` codepath, which is what the stress harness
     uses in ``probe1_recall_leak``.

Both rely on a live PostgreSQL backend (``DATABASE_URL`` set, pgvector,
BGE singleton or fallback embedder). Skipped automatically when the env
is not configured.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest

# Ensure scripts/core is importable as a package
_CORE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_CORE_DIR))

import recall_learnings  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures (mirrors test_dedup_project_scope.py for consistency)
# ---------------------------------------------------------------------------


@pytest.fixture
def canary_prefix():
    return f"recall-scope-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def reset_postgres_pool():
    """Drop the global asyncpg pool before/after each test.

    Each pytest function creates a new event loop via asyncio.run(), so a
    pool from a prior loop becomes unusable.
    """
    sys.path.insert(0, str(_CORE_DIR))
    try:
        from db.postgres_pool import reset_pool
        reset_pool()
    except Exception:
        pass
    yield
    try:
        from db.postgres_pool import reset_pool
        reset_pool()
    except Exception:
        pass


@pytest.fixture
def cleanup_db(canary_prefix):
    """Remove rows tagged with this run's canary content after the test."""
    yield
    try:
        import asyncpg  # type: ignore

        url = os.environ.get("DATABASE_URL")
        if not url:
            return

        async def _delete():
            conn = await asyncpg.connect(url)
            try:
                # Delete by content prefix (canary string is unique)
                await conn.execute(
                    "DELETE FROM archival_memory WHERE content LIKE $1",
                    f"%{canary_prefix}%",
                )
            finally:
                await conn.close()

        asyncio.run(_delete())
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Helper: seed two PROJECT-scoped rows under different project_ids
# ---------------------------------------------------------------------------


async def _seed_two_projects(canary_prefix: str) -> tuple[str, str]:
    """Insert two seeded archival_memory rows under different project_ids.

    Returns (project_id_aaa, project_id_bbb). Content for each row contains
    the canary_prefix so cleanup_db can sweep it on teardown.
    """
    import asyncpg  # type: ignore

    url = os.environ["DATABASE_URL"]
    project_id_aaa = "aaa1111111111111"
    project_id_bbb = "bbb2222222222222"

    content_a = (
        f"{canary_prefix} canary content A -- this learning belongs to project AAA "
        f"and must NOT be visible to recall queries from any other project. The "
        f"recall scope filter on project_id is the contract under test here."
    )
    content_b = (
        f"{canary_prefix} canary content B -- this learning belongs to project BBB "
        f"and must NOT bleed into project AAA, project CCC, or anywhere else. "
        f"Project boundaries on the read side are the gap this test documents."
    )

    conn = await asyncpg.connect(url)
    try:
        await conn.execute(
            """
            INSERT INTO archival_memory
                (session_id, project_id, scope, content, metadata)
            VALUES
                ($1, $2, 'PROJECT', $3, '{"type": "WORKING_SOLUTION"}'::jsonb),
                ($1, $4, 'PROJECT', $5, '{"type": "WORKING_SOLUTION"}'::jsonb)
            """,
            f"{canary_prefix}-seed",
            project_id_aaa,
            content_a,
            project_id_bbb,
            content_b,
        )
    finally:
        await conn.close()

    return project_id_aaa, project_id_bbb


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; skipping recall isolation integration test",
)
def test_recall_filters_by_project_scope(
    canary_prefix, cleanup_db, reset_postgres_pool
):
    """PROJECT-scoped recall must NOT return rows from other project_ids.

    Today this fails: recall_learnings.py performs no project_id filter,
    so seeded rows in projects AAA and BBB both surface when recalling
    from project CCC.

    After a future fix that scopes recall by project_id (or restricts
    PROJECT-scope rows to the active project), this test passes.
    """
    project_id_ccc = "ccc3333333333333"  # The "third project" perspective

    async def _run():
        await _seed_two_projects(canary_prefix)

        # Force the recall codepath. The current public function does not
        # accept project_id; we set the env so any future filter that reads
        # CLAUDE_PROJECT_ID picks up the third project.
        os.environ["CLAUDE_PROJECT_ID"] = project_id_ccc
        try:
            results = await recall_learnings.search_learnings_hybrid_rrf(
                query=canary_prefix,
                k=10,
                provider="local",
                similarity_threshold=0.0,
            )
        finally:
            os.environ.pop("CLAUDE_PROJECT_ID", None)

        # Filter results to canary content only (other history is fine)
        canary_hits = [r for r in results if canary_prefix in r["content"]]

        assert len(canary_hits) == 0, (
            f"Recall isolation contract violated: querying from project "
            f"{project_id_ccc} returned {len(canary_hits)} rows seeded under "
            f"projects AAA/BBB. PROJECT-scoped rows must not bleed across "
            f"projects on the read side. Hits: "
            f"{[r['content'][:80] for r in canary_hits]}"
        )

    asyncio.run(_run())


@pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; skipping recall isolation integration test",
)
def test_recall_text_only_filters_by_project_scope(
    canary_prefix, cleanup_db, reset_postgres_pool
):
    """The --text-only codepath used by the stress harness must also filter.

    ``search_learnings_text_only_postgres`` is the function the stress
    harness calls in probe1_recall_leak. It currently has no project_id
    clause, so it leaks just like the hybrid RRF path.
    """
    project_id_ccc = "ccc3333333333333"

    async def _run():
        await _seed_two_projects(canary_prefix)

        os.environ["CLAUDE_PROJECT_ID"] = project_id_ccc
        try:
            results = await recall_learnings.search_learnings_text_only_postgres(
                query=canary_prefix,
                k=10,
            )
        finally:
            os.environ.pop("CLAUDE_PROJECT_ID", None)

        canary_hits = [r for r in results if canary_prefix in r["content"]]

        assert len(canary_hits) == 0, (
            f"--text-only recall isolation contract violated: querying from "
            f"project {project_id_ccc} returned {len(canary_hits)} rows seeded "
            f"under projects AAA/BBB via the text-only path. "
            f"Hits: {[r['content'][:80] for r in canary_hits]}"
        )

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# Source-level assertion (cheap signal, no DB required)
# ---------------------------------------------------------------------------


def test_recall_text_only_source_has_project_id_clause():
    """The text-only recall SQL should reference project_id once a fix lands.

    This is a static check against the source -- expected to fail today
    because the SQL has no ``project_id`` clause anywhere in
    ``search_learnings_text_only_postgres``.
    """
    src = (_CORE_DIR / "recall_learnings.py").read_text(encoding="utf-8")

    # Locate the function body
    marker = "async def search_learnings_text_only_postgres"
    idx = src.find(marker)
    assert idx >= 0, "search_learnings_text_only_postgres not found"

    # Look for project_id reference within ~3000 chars after the def
    body = src[idx : idx + 3000]
    assert "project_id" in body, (
        "search_learnings_text_only_postgres should filter by project_id "
        "once recall isolation is implemented. Current source has no such "
        "clause -- documents the gap."
    )
