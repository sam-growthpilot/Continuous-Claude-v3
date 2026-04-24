"""Tests for analyze_learnings.py memory-corpus synthesis via RLM.

Covers:
- _fetch_corpus_async: SQL building with tag/type filters, JSON-serializable rows
- main: RLM invocation with JSON context, output paths
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from scripts.core.analyze_learnings import _fetch_corpus_async, main


class _ConnCaptureSQL:
    """Minimal asyncpg Connection double that records the SQL + params.

    The rows it returns carry `metadata` as a JSON string (matching how
    asyncpg returns JSONB when no codec is registered) so we can exercise
    the decoding path too.
    """

    def __init__(self, rows: list[dict]):
        self._rows = rows
        self.last_sql: str | None = None
        self.last_args: tuple = ()

    async def fetch(self, sql: str, *args):
        self.last_sql = sql
        self.last_args = args
        return self._rows


class _PoolCaptureSQL:
    """Minimal asyncpg Pool double that yields _ConnCaptureSQL via acquire()."""

    def __init__(self, conn: _ConnCaptureSQL):
        self._conn = conn

    def acquire(self):
        pool = self

        class _Acq:
            async def __aenter__(self_inner):
                return pool._conn

            async def __aexit__(self_inner, exc_type, exc, tb):
                return None

        return _Acq()


def _fake_row(
    *,
    id_="row-1",
    session_id="sess-1",
    content="hooks require npm install",
    metadata=None,
    created_at=None,
) -> dict:
    """Return a row dict matching archival_memory schema.

    metadata is returned as a JSON *string* (asyncpg default for JSONB),
    not a dict, so the implementation must json.loads it.
    """
    md = metadata or {
        "type": "ERROR_FIX",
        "tags": ["hooks", "typescript"],
        "context": "hook development",
        "confidence": "high",
    }
    return {
        "id": id_,
        "session_id": session_id,
        "content": content,
        "metadata": json.dumps(md),
        "created_at": created_at or datetime(2026, 4, 1, 12, 0, tzinfo=timezone.utc),
    }


# ---------------------------------------------------------------------------
# _fetch_corpus_async SQL-building tests
# ---------------------------------------------------------------------------


async def test_fetch_corpus_builds_sql_with_tag_filter():
    """tags filter should generate a metadata->'tags' ?| ARRAY[...] clause."""
    conn = _ConnCaptureSQL([_fake_row()])
    pool = _PoolCaptureSQL(conn)

    with patch("scripts.core.analyze_learnings.get_pool", new=AsyncMock(return_value=pool)):
        rows = await _fetch_corpus_async(tag_filter=["hooks", "typescript"])

    assert conn.last_sql is not None, "fetch() should have been called"
    # Tag filter must use JSONB ?| operator against metadata->'tags'
    assert "metadata->'tags'" in conn.last_sql
    assert "?|" in conn.last_sql
    # Parameters must include the tag list
    assert ["hooks", "typescript"] in conn.last_args
    # Row shape preserved
    assert rows[0]["id"] == "row-1"


async def test_fetch_corpus_builds_sql_with_type_filter():
    """types filter should generate metadata->>'type' = ANY(...) clause."""
    conn = _ConnCaptureSQL([_fake_row()])
    pool = _PoolCaptureSQL(conn)

    with patch("scripts.core.analyze_learnings.get_pool", new=AsyncMock(return_value=pool)):
        await _fetch_corpus_async(type_filter=["ERROR_FIX", "WORKING_SOLUTION"])

    assert conn.last_sql is not None
    assert "metadata->>'type'" in conn.last_sql
    assert "ANY" in conn.last_sql
    assert ["ERROR_FIX", "WORKING_SOLUTION"] in conn.last_args


async def test_fetch_corpus_returns_jsonserializable_rows():
    """created_at (datetime) must be converted to ISO string in returned dicts.

    Also asserts metadata is unpacked from JSON string into a dict so callers
    can serialize the whole corpus with json.dumps() without errors.
    """
    ts = datetime(2026, 1, 15, 9, 30, 45, tzinfo=timezone.utc)
    conn = _ConnCaptureSQL([_fake_row(created_at=ts)])
    pool = _PoolCaptureSQL(conn)

    with patch("scripts.core.analyze_learnings.get_pool", new=AsyncMock(return_value=pool)):
        rows = await _fetch_corpus_async()

    assert len(rows) == 1
    row = rows[0]

    # created_at must be a string, not datetime
    assert isinstance(row["created_at"], str)
    assert row["created_at"].startswith("2026-01-15T09:30:45")

    # metadata should be a dict (decoded from JSON string)
    assert isinstance(row["metadata"], dict)
    assert row["metadata"]["type"] == "ERROR_FIX"

    # Whole corpus must serialize cleanly
    serialized = json.dumps(rows)
    assert "2026-01-15T09:30:45" in serialized


async def test_fetch_corpus_limit_appended():
    """A numeric --limit must translate to SQL LIMIT clause (int-safe)."""
    conn = _ConnCaptureSQL([])
    pool = _PoolCaptureSQL(conn)

    with patch("scripts.core.analyze_learnings.get_pool", new=AsyncMock(return_value=pool)):
        await _fetch_corpus_async(limit=50)

    assert conn.last_sql is not None
    assert "LIMIT" in conn.last_sql.upper()
    # int(50) must end up in the SQL text; not as a param (to keep the
    # asyncpg param numbering simple).  We just need it present.
    assert "50" in conn.last_sql


# ---------------------------------------------------------------------------
# main() CLI tests
# ---------------------------------------------------------------------------


def test_main_invokes_rlm_complete_with_json_context(monkeypatch, tmp_path, capsys):
    """main() must serialize fetched rows to a JSON string and pass it as context.

    Verify the context argument:
      - Is a str
      - Parses as a JSON list
      - Contains the row we seeded
    Also verify the question string tells the model the context is JSON.
    """
    monkeypatch.setattr("sys.argv", [
        "analyze_learnings.py",
        "--question", "What patterns emerge?",
        "--tags", "hooks",
        "--budget-usd", "1.00",
    ])
    # Keep trajectory dir isolated
    monkeypatch.chdir(tmp_path)

    fake_rows = [
        {
            "id": "abc",
            "session_id": "s1",
            "content": "hook fix",
            "metadata": {"type": "ERROR_FIX", "tags": ["hooks"]},
            "created_at": "2026-04-01T12:00:00+00:00",
        }
    ]

    captured_kwargs: dict = {}

    def fake_rlm_complete(question, context, *, policy=None, trajectory_dir=None, **kw):
        captured_kwargs["question"] = question
        captured_kwargs["context"] = context
        captured_kwargs["policy"] = policy
        captured_kwargs["trajectory_dir"] = trajectory_dir
        return SimpleNamespace(
            answer="synthesis here",
            path="rlm",
            usage={"input_tokens": 1000, "output_tokens": 200},
        )

    with patch("scripts.core.analyze_learnings._fetch_corpus_async",
               new=AsyncMock(return_value=fake_rows)), \
         patch("scripts.core.analyze_learnings.rlm_complete",
               side_effect=fake_rlm_complete):
        rc = main()

    assert rc == 0, "main() should return 0 on success"

    # Context must be a JSON string of a list
    ctx = captured_kwargs["context"]
    assert isinstance(ctx, str)
    assert ctx.lstrip().startswith("["), f"context must start with '[' (got: {ctx[:40]!r})"
    parsed = json.loads(ctx)
    assert isinstance(parsed, list)
    assert parsed[0]["id"] == "abc"

    # Question must explain the JSON shape to the model
    q = captured_kwargs["question"]
    assert "json.loads" in q.lower() or "json" in q.lower()
    assert "What patterns emerge?" in q

    # Policy must apply the custom budget
    assert captured_kwargs["policy"] is not None
    assert captured_kwargs["policy"].max_budget_usd == 1.00

    # Answer printed to stdout
    out = capsys.readouterr()
    assert "synthesis here" in out.out


def test_main_output_json_emits_structured(monkeypatch, tmp_path, capsys):
    """--output-json flag must emit {answer, path, usage, trajectory_dir} JSON."""
    monkeypatch.setattr("sys.argv", [
        "analyze_learnings.py",
        "--question", "q?",
        "--output-json",
    ])
    monkeypatch.chdir(tmp_path)

    fake_rows = [{
        "id": "abc",
        "session_id": "s1",
        "content": "c",
        "metadata": {"type": "ERROR_FIX", "tags": ["x"]},
        "created_at": "2026-04-01T12:00:00+00:00",
    }]

    def fake_rlm_complete(question, context, *, policy=None, trajectory_dir=None, **kw):
        return SimpleNamespace(
            answer="ans",
            path="vanilla-threshold",
            usage={"input_tokens": 10, "output_tokens": 2},
        )

    with patch("scripts.core.analyze_learnings._fetch_corpus_async",
               new=AsyncMock(return_value=fake_rows)), \
         patch("scripts.core.analyze_learnings.rlm_complete",
               side_effect=fake_rlm_complete):
        rc = main()

    assert rc == 0
    out = capsys.readouterr().out.strip()
    payload = json.loads(out)
    assert payload["answer"] == "ans"
    assert payload["path"] == "vanilla-threshold"
    assert payload["usage"] == {"input_tokens": 10, "output_tokens": 2}
    assert "trajectory_dir" in payload


def test_main_empty_corpus_returns_2(monkeypatch, tmp_path, capsys):
    """If the DB returns zero rows, main() should exit with code 2 and not call RLM."""
    monkeypatch.setattr("sys.argv", [
        "analyze_learnings.py",
        "--question", "q?",
    ])
    monkeypatch.chdir(tmp_path)

    rlm_mock = MagicMock()
    with patch("scripts.core.analyze_learnings._fetch_corpus_async",
               new=AsyncMock(return_value=[])), \
         patch("scripts.core.analyze_learnings.rlm_complete", new=rlm_mock):
        rc = main()

    assert rc == 2
    rlm_mock.assert_not_called()
