"""Regression tests for scripts/dedup_archival_memory.py:_fetch_pairs.

Phase A3 (C3) of CodeRabbit remediation: the dedup script's `_fetch_pairs`
clusters every recent embedded row regardless of `scope` / `project_id`.
Under `--apply`, two near-identical PROJECT memories from different projects
could be paired and one deleted -- cross-project data destruction.

The fix scopes pairing so:
  * GLOBAL <-> GLOBAL pairs are eligible.
  * PROJECT <-> PROJECT pairs are eligible only when project_id matches.
  * Cross-scope (GLOBAL vs PROJECT) and cross-project pairs are excluded.

These tests exercise the SQL query directly with a stub asyncpg connection
that records the parameters and returns canned rows. We don't need a live
database -- the assertion is on the WHERE clause shape and that the query
filters correctly.

Layered with two integration-style tests gated on DATABASE_URL that seed
real archival_memory rows and verify the live query never returns a
cross-project pair.
"""

from __future__ import annotations

import asyncio
import importlib.util
import os
import re
import sys
import uuid
from pathlib import Path
from unittest import mock

import pytest


# ---------------------------------------------------------------------------
# Module loading: scripts/dedup_archival_memory.py is not a package -- import
# it directly via importlib so we can call its private helpers.
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEDUP_PATH = _REPO_ROOT / "scripts" / "dedup_archival_memory.py"

assert _DEDUP_PATH.exists(), f"Cannot locate dedup script at {_DEDUP_PATH}"


def _load_dedup_module():
    spec = importlib.util.spec_from_file_location(
        "dedup_archival_memory_under_test", _DEDUP_PATH
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def dedup_mod():
    return _load_dedup_module()


# ---------------------------------------------------------------------------
# Unit tests: the SQL must include scope/project_id constraints
# ---------------------------------------------------------------------------


def test_fetch_pairs_sql_includes_scope_and_project_constraint(dedup_mod):
    """The query must restrict pairing to same-scope rows + matching project_id.

    We capture the SQL by stubbing asyncpg.connect, then assert the WHERE
    clause covers the two legitimate cases (GLOBAL/GLOBAL and PROJECT/PROJECT
    with matching project_id).
    """
    captured = {"sql": None, "params": None}

    class _StubConn:
        async def fetch(self, sql, *params):
            captured["sql"] = sql
            captured["params"] = params
            return []

        async def close(self):
            pass

    async def _fake_connect(dsn, timeout=None):
        return _StubConn()

    async def _run():
        with mock.patch.object(dedup_mod, "_get_dsn", return_value="postgresql://stub"):
            with mock.patch("asyncpg.connect", new=_fake_connect):
                await dedup_mod._fetch_pairs(threshold=0.95, limit=500)

    asyncio.run(_run())

    sql = captured["sql"]
    assert sql is not None, "_fetch_pairs did not issue a SQL query"

    # The SQL must reference both 'scope' and 'project_id' columns -- the
    # pre-fix version did not. Using a permissive regex so future formatting
    # changes don't break the test.
    sql_lower = sql.lower()
    assert "scope" in sql_lower, (
        "Phase A3: _fetch_pairs SQL must filter by scope to prevent "
        "cross-scope clustering. Found: " + sql_lower[:400]
    )
    assert "project_id" in sql_lower, (
        "Phase A3: _fetch_pairs SQL must filter by project_id to prevent "
        "cross-project clustering. Found: " + sql_lower[:400]
    )

    # Both halves of the join must use the same scope. We look for the
    # GLOBAL/GLOBAL and PROJECT/PROJECT clauses (case-insensitive).
    has_global_global = re.search(
        r"a\.scope\s*=\s*'GLOBAL'.*b\.scope\s*=\s*'GLOBAL'",
        sql,
        re.IGNORECASE | re.DOTALL,
    )
    has_project_project = re.search(
        r"a\.scope\s*=\s*'PROJECT'.*b\.scope\s*=\s*'PROJECT'",
        sql,
        re.IGNORECASE | re.DOTALL,
    )
    assert has_global_global, (
        "Expected a clause restricting GLOBAL pairs to GLOBAL/GLOBAL. "
        f"SQL was:\n{sql}"
    )
    assert has_project_project, (
        "Expected a clause restricting PROJECT pairs to PROJECT/PROJECT "
        f"with matching project_id. SQL was:\n{sql}"
    )

    # And the project_id equality must appear (a.project_id = b.project_id).
    project_eq = re.search(
        r"a\.project_id\s*=\s*b\.project_id", sql, re.IGNORECASE
    )
    assert project_eq, (
        "Phase A3: _fetch_pairs SQL must enforce a.project_id = b.project_id. "
        f"SQL was:\n{sql}"
    )


# ---------------------------------------------------------------------------
# Integration tests: live DB required
# ---------------------------------------------------------------------------


def _zero_vec(dim=1024):
    """Build a near-identical synthetic embedding for two rows.

    We seed identical embeddings so the cosine-similarity filter in the
    dedup query treats them as a pair candidate -- the only thing that
    should keep them apart is the scope/project_id constraint.
    """
    return [0.001] * dim


@pytest.fixture
def canary_prefix():
    return f"phase-a3-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def cleanup_db(canary_prefix):
    """Remove rows tagged with this run's canary content after the test."""
    yield
    try:
        import asyncpg  # type: ignore

        url = (
            os.environ.get("OPC_POSTGRES_URL")
            or os.environ.get("DATABASE_URL")
        )
        if not url:
            return

        async def _delete():
            conn = await asyncpg.connect(url)
            try:
                await conn.execute(
                    "DELETE FROM archival_memory WHERE content LIKE $1",
                    f"%{canary_prefix}%",
                )
            finally:
                await conn.close()

        asyncio.run(_delete())
    except ModuleNotFoundError:
        # asyncpg not available in this environment -- the test itself
        # would have skipped, so there is nothing to clean up.
        pass
    except Exception as exc:  # pragma: no cover -- surfaced via warnings
        # A bare `pass` here can hide real teardown regressions and leave
        # canary rows behind that pollute future runs of this same test.
        # Surface it via warnings.warn so pytest reports it without the
        # fixture itself failing (which would mask the underlying test
        # outcome the user actually cares about).
        import warnings
        warnings.warn(
            f"cleanup_db: failed to delete canary rows for "
            f"{canary_prefix!r}: {exc!r}",
            stacklevel=1,
        )


@pytest.mark.skipif(
    not (
        os.environ.get("OPC_POSTGRES_URL") or os.environ.get("DATABASE_URL")
    ),
    reason="DATABASE_URL not set; skipping integration test",
)
def test_fetch_pairs_does_not_cluster_cross_project_rows(
    dedup_mod, canary_prefix, cleanup_db
):
    """Two near-identical PROJECT rows under different project_ids must NOT pair.

    Pre-fix, the dedup script would treat them as a cluster and delete one
    under --apply -- cross-project data destruction.
    """
    import asyncpg  # type: ignore

    # Use the same DSN resolution order as dedup_mod._fetch_pairs() so
    # seeding and the assertion target the same database. Hand-rolling the
    # lookup here drifted out of sync with the module (which also accepts
    # AGENTICA_POSTGRES_URL between OPC and DATABASE), and the diverging
    # answers can vacuously satisfy the assertion when env vars differ.
    url = dedup_mod._get_dsn()
    if not url:
        pytest.skip("no Postgres DSN env var (OPC_POSTGRES_URL/DATABASE_URL/AGENTICA_POSTGRES_URL)")

    project_a = "phase-a3-project-A-" + uuid.uuid4().hex[:8]
    project_b = "phase-a3-project-B-" + uuid.uuid4().hex[:8]
    content = (
        f"Phase A3 canary {canary_prefix}: identical content across two "
        f"projects -- the dedup query MUST NOT pair them."
    )
    embedding = _zero_vec()

    async def _seed_and_check():
        conn = await asyncpg.connect(url)
        try:
            # Register pgvector type
            try:
                from db.postgres_pool import init_pgvector  # type: ignore
                await init_pgvector(conn)
            except Exception:
                # If pgvector type registration is unavailable, abort -- the
                # subsequent INSERT requires a vector-aware connection.
                pytest.skip("pgvector type registration unavailable")

            for project_id in (project_a, project_b):
                await conn.execute(
                    """
                    INSERT INTO archival_memory
                        (id, session_id, content, metadata,
                         embedding, scope, project_id, created_at)
                    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, NOW())
                    """,
                    uuid.uuid4(),
                    f"{canary_prefix}-{project_id}",
                    content,
                    "{}",
                    embedding,
                    "PROJECT",
                    project_id,
                )
        finally:
            await conn.close()

        # Run the dedup _fetch_pairs at a permissive threshold + a tight
        # window covering only our two seeds.
        # limit=500 (not 10) because _fetch_pairs scans by created_at desc;
        # if other recent rows exist between our seeds and the head of the
        # window, a tight limit can drop the canary pair entirely and make
        # the assertion vacuous (negative test passes for the wrong reason).
        pairs = await dedup_mod._fetch_pairs(threshold=0.5, limit=500)
        # Filter to pairs that involve our canary rows (by content lookup)
        # so unrelated DB churn doesn't make this flaky.
        conn = await asyncpg.connect(url)
        try:
            rows = await conn.fetch(
                "SELECT id, project_id, scope FROM archival_memory "
                "WHERE content LIKE $1",
                f"%{canary_prefix}%",
            )
            our_ids = {r["id"] for r in rows}
        finally:
            await conn.close()

        # No pair returned by _fetch_pairs may include both of our rows.
        # (A pair with one of our rows + an unrelated row is fine -- it just
        # means another similar memory exists; the cross-project assertion
        # is specifically that *both* of our PROJECT rows are not clustered.)
        cross_project_pairs = [
            (a, b, sim)
            for (a, b, sim) in pairs
            if a in our_ids and b in our_ids
        ]
        assert not cross_project_pairs, (
            f"Phase A3 leak: cross-project rows clustered. "
            f"Pairs: {cross_project_pairs}. Project IDs were "
            f"{project_a!r} and {project_b!r}."
        )
        return rows

    rows = asyncio.run(_seed_and_check())
    assert len(rows) == 2, (
        f"Expected exactly two seeded rows for {canary_prefix}, found {len(rows)}"
    )


@pytest.mark.skipif(
    not (
        os.environ.get("OPC_POSTGRES_URL") or os.environ.get("DATABASE_URL")
    ),
    reason="DATABASE_URL not set; skipping integration test",
)
def test_fetch_pairs_does_cluster_same_project_rows(
    dedup_mod, canary_prefix, cleanup_db
):
    """Two near-identical PROJECT rows in the SAME project_id MUST still pair.

    Positive control: confirms the new WHERE clause didn't over-filter and
    suppress legitimate pair detection.
    """
    import asyncpg  # type: ignore

    url = (
        os.environ.get("OPC_POSTGRES_URL")
        or os.environ.get("DATABASE_URL")
    )

    project = "phase-a3-shared-project-" + uuid.uuid4().hex[:8]
    content = f"Phase A3 canary {canary_prefix}: same project, near-identical content"
    embedding = _zero_vec()

    async def _seed_and_check():
        conn = await asyncpg.connect(url)
        try:
            try:
                from db.postgres_pool import init_pgvector  # type: ignore
                await init_pgvector(conn)
            except Exception:
                pytest.skip("pgvector type registration unavailable")

            for i in range(2):
                await conn.execute(
                    """
                    INSERT INTO archival_memory
                        (id, session_id, content, metadata,
                         embedding, scope, project_id, created_at)
                    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, NOW())
                    """,
                    uuid.uuid4(),
                    f"{canary_prefix}-session-{i}",
                    content,
                    "{}",
                    embedding,
                    "PROJECT",
                    project,
                )
        finally:
            await conn.close()

        # limit=500 (not 10) because _fetch_pairs scans by created_at desc;
        # if other recent rows exist between our seeds and the head of the
        # window, a tight limit can drop the canary pair entirely and make
        # the assertion vacuous (negative test passes for the wrong reason).
        pairs = await dedup_mod._fetch_pairs(threshold=0.5, limit=500)

        conn = await asyncpg.connect(url)
        try:
            rows = await conn.fetch(
                "SELECT id FROM archival_memory WHERE content LIKE $1",
                f"%{canary_prefix}%",
            )
            our_ids = {r["id"] for r in rows}
        finally:
            await conn.close()

        same_project_pairs = [
            (a, b, sim)
            for (a, b, sim) in pairs
            if a in our_ids and b in our_ids
        ]
        # Two seeded same-project rows -> at least one pair detected.
        assert same_project_pairs, (
            f"Phase A3 false negative: same-project rows must still cluster. "
            f"Returned pairs: {pairs[:5]}"
        )

    asyncio.run(_seed_and_check())
