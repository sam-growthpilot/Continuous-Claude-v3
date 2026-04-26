"""Tests for scripts/dedup_archival_memory.py.

Covers:
- cluster_duplicates(pairs): transitive grouping of similarity pairs
- pick_keeper(rows): newest > confidence > id tiebreak
- format_plan(clusters, kept_ids): deterministic output
- Dry-run safety: no DB writes, no log file writes
- --apply: deletes via DB and appends JSONL log entries
"""
from __future__ import annotations

import io
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

# scripts/ is at repo root (not under opc/), so add it to sys.path
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_SCRIPTS_DIR = _REPO_ROOT / "scripts"
sys.path.insert(0, str(_SCRIPTS_DIR))

import dedup_archival_memory as dedup  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _row(
    id_,
    *,
    confidence: str = "medium",
    days_ago: int = 0,
    content: str = "test content",
):
    """Create a row dict matching the DB layout."""
    base = datetime(2026, 4, 1, 12, 0, 0, tzinfo=timezone.utc)
    created = base - timedelta(days=days_ago)
    return {
        "id": id_,
        "content": content,
        "confidence": confidence,
        "created_at": created,
    }


# ---------------------------------------------------------------------------
# cluster_duplicates
# ---------------------------------------------------------------------------


def test_cluster_duplicates_empty_pairs():
    assert dedup.cluster_duplicates([]) == []


def test_cluster_duplicates_single_pair():
    pairs = [(1, 2, 0.96)]
    clusters = dedup.cluster_duplicates(pairs)
    assert len(clusters) == 1
    assert set(clusters[0]) == {1, 2}


def test_cluster_duplicates_disjoint_pairs():
    """Two unrelated pairs become two separate clusters."""
    pairs = [(1, 2, 0.96), (5, 6, 0.97)]
    clusters = dedup.cluster_duplicates(pairs)
    sets = sorted([set(c) for c in clusters], key=lambda s: min(s))
    assert sets == [{1, 2}, {5, 6}]


def test_cluster_duplicates_transitive_closure():
    """A~B and B~C must merge into a single {A,B,C} cluster."""
    pairs = [(1, 2, 0.96), (2, 3, 0.97)]
    clusters = dedup.cluster_duplicates(pairs)
    assert len(clusters) == 1
    assert set(clusters[0]) == {1, 2, 3}


def test_cluster_duplicates_long_chain():
    """A~B, B~C, C~D, D~E -> single cluster of 5."""
    pairs = [(1, 2, 0.96), (2, 3, 0.96), (3, 4, 0.96), (4, 5, 0.96)]
    clusters = dedup.cluster_duplicates(pairs)
    assert len(clusters) == 1
    assert set(clusters[0]) == {1, 2, 3, 4, 5}


def test_cluster_duplicates_uuid_ids():
    """UUID IDs (real archival_memory schema) work, not just ints."""
    a, b, c = uuid4(), uuid4(), uuid4()
    pairs = [(a, b, 0.99), (b, c, 0.98)]
    clusters = dedup.cluster_duplicates(pairs)
    assert len(clusters) == 1
    assert set(clusters[0]) == {a, b, c}


# ---------------------------------------------------------------------------
# pick_keeper
# ---------------------------------------------------------------------------


def test_pick_keeper_newest_wins():
    rows = [
        _row(1, confidence="medium", days_ago=10),
        _row(2, confidence="medium", days_ago=1),
        _row(3, confidence="medium", days_ago=5),
    ]
    keeper = dedup.pick_keeper(rows)
    assert keeper["id"] == 2


def test_pick_keeper_confidence_tiebreak():
    """Same created_at -> highest confidence wins (HIGH > MEDIUM > LOW)."""
    rows = [
        _row(1, confidence="low", days_ago=5),
        _row(2, confidence="high", days_ago=5),
        _row(3, confidence="medium", days_ago=5),
    ]
    keeper = dedup.pick_keeper(rows)
    assert keeper["id"] == 2  # high beats medium beats low


def test_pick_keeper_id_tiebreak():
    """Same time, same confidence -> lowest id wins."""
    rows = [
        _row(7, confidence="medium", days_ago=5),
        _row(3, confidence="medium", days_ago=5),
        _row(11, confidence="medium", days_ago=5),
    ]
    keeper = dedup.pick_keeper(rows)
    assert keeper["id"] == 3


def test_pick_keeper_uppercase_confidence_ok():
    """Confidence stored uppercase still ranks correctly."""
    rows = [
        _row(1, confidence="LOW", days_ago=1),
        _row(2, confidence="HIGH", days_ago=1),
    ]
    keeper = dedup.pick_keeper(rows)
    assert keeper["id"] == 2


def test_pick_keeper_unknown_confidence_treated_as_low():
    """Garbage confidence sorts below known levels."""
    rows = [
        _row(1, confidence="weird", days_ago=1),
        _row(2, confidence="low", days_ago=1),
    ]
    keeper = dedup.pick_keeper(rows)
    assert keeper["id"] == 2  # low beats unknown


def test_pick_keeper_single_row_returns_self():
    rows = [_row(42, confidence="medium", days_ago=3)]
    keeper = dedup.pick_keeper(rows)
    assert keeper["id"] == 42


# ---------------------------------------------------------------------------
# format_plan
# ---------------------------------------------------------------------------


def test_format_plan_empty():
    out = dedup.format_plan([], rows_by_id={}, max_sims={})
    assert "Found 0 duplicate clusters" in out
    assert "Total: 0 entries" in out


def test_format_plan_single_cluster():
    rows_by_id = {
        10: _row(10, confidence="high", days_ago=1),
        11: _row(11, confidence="medium", days_ago=10),
    }
    clusters = [[10, 11]]
    max_sims = {(10, 11): 0.996}
    out = dedup.format_plan(clusters, rows_by_id=rows_by_id, max_sims=max_sims)
    assert "Found 1 duplicate cluster" in out
    assert "size=2" in out
    assert "0.996" in out
    assert "KEEP id=10" in out
    assert "REMOVE id=11" in out
    assert "Total: 1 entries would be removed" in out


def test_format_plan_multi_cluster_deterministic():
    rows_by_id = {
        1: _row(1, confidence="high", days_ago=1),
        2: _row(2, confidence="medium", days_ago=10),
        100: _row(100, confidence="high", days_ago=2),
        101: _row(101, confidence="low", days_ago=20),
    }
    clusters = [[2, 1], [101, 100]]  # unordered input
    max_sims = {(1, 2): 0.99, (100, 101): 0.97}
    out1 = dedup.format_plan(clusters, rows_by_id=rows_by_id, max_sims=max_sims)
    # Re-shuffle input -- output must be the same
    out2 = dedup.format_plan(
        [[100, 101], [1, 2]], rows_by_id=rows_by_id, max_sims=max_sims
    )
    assert out1 == out2
    assert "Found 2 duplicate clusters" in out1
    assert "Total: 2 entries would be removed" in out1


def test_format_plan_shows_uppercase_confidence():
    rows_by_id = {
        10: _row(10, confidence="high", days_ago=1),
        11: _row(11, confidence="medium", days_ago=10),
    }
    out = dedup.format_plan([[10, 11]], rows_by_id=rows_by_id, max_sims={(10, 11): 0.99})
    # Confidence should be uppercased in the human plan output
    assert "HIGH" in out
    assert "MEDIUM" in out


# ---------------------------------------------------------------------------
# Dry-run safety
# ---------------------------------------------------------------------------


def _stub_pairs_and_rows(monkeypatch, pairs, rows):
    """Patch dedup module so the run loop sees deterministic data without DB."""

    async def fake_fetch_pairs(threshold, limit):
        return pairs

    async def fake_fetch_rows(ids):
        return [r for r in rows if r["id"] in set(ids)]

    async def fake_delete(ids):
        # Should never be called in dry-run
        fake_delete.called = True
        fake_delete.deleted = list(ids)
        return len(ids)

    fake_delete.called = False
    fake_delete.deleted = []

    monkeypatch.setattr(dedup, "_fetch_pairs", fake_fetch_pairs)
    monkeypatch.setattr(dedup, "_fetch_rows", fake_fetch_rows)
    monkeypatch.setattr(dedup, "_delete_rows", fake_delete)
    return fake_delete


def test_dry_run_no_db_writes_no_log(tmp_path, monkeypatch, capsys):
    """run(apply=False) must not call _delete_rows and must not write the log."""
    pairs = [(1, 2, 0.97)]
    rows = [
        _row(1, confidence="medium", days_ago=1),
        _row(2, confidence="medium", days_ago=10),
    ]
    fake_delete = _stub_pairs_and_rows(monkeypatch, pairs, rows)
    log_path = tmp_path / "memory-dedup-log.jsonl"
    monkeypatch.setattr(dedup, "LOG_PATH", log_path)

    rc = dedup.run(threshold=0.95, limit=500, apply=False)

    assert rc == 0
    assert not fake_delete.called, "delete must NOT be called in dry-run"
    assert not log_path.exists(), "log file must NOT be created in dry-run"
    out = capsys.readouterr().out
    assert "would be removed" in out
    assert "DRY-RUN" in out or "dry-run" in out.lower()


def test_dry_run_zero_clusters_exits_clean(tmp_path, monkeypatch, capsys):
    fake_delete = _stub_pairs_and_rows(monkeypatch, [], [])
    log_path = tmp_path / "memory-dedup-log.jsonl"
    monkeypatch.setattr(dedup, "LOG_PATH", log_path)

    rc = dedup.run(threshold=0.95, limit=500, apply=False)

    assert rc == 0
    assert not log_path.exists()
    assert not fake_delete.called
    out = capsys.readouterr().out
    assert "Found 0 duplicate clusters" in out


# ---------------------------------------------------------------------------
# --apply path
# ---------------------------------------------------------------------------


def test_apply_writes_log_entries_with_required_fields(tmp_path, monkeypatch, capsys):
    pairs = [(1, 2, 0.996)]
    rows = [
        _row(1, confidence="high", days_ago=1, content="A" * 200),  # newer keeper
        _row(2, confidence="medium", days_ago=10, content="B" * 200),
    ]
    fake_delete = _stub_pairs_and_rows(monkeypatch, pairs, rows)
    log_path = tmp_path / "memory-dedup-log.jsonl"
    monkeypatch.setattr(dedup, "LOG_PATH", log_path)

    rc = dedup.run(threshold=0.95, limit=500, apply=True)

    assert rc == 0
    assert fake_delete.called, "delete must be called in --apply"
    assert fake_delete.deleted == [2]

    assert log_path.exists()
    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    # Required fields per spec:
    assert "ts" in entry
    assert entry["deleted_id"] == 2
    assert entry["kept_id"] == 1
    assert entry["similarity"] == 0.996
    # confidence stored as uppercase in log for consistency with plan
    assert entry["confidence"].upper() in {"HIGH", "MEDIUM", "LOW"}
    # content_preview truncated to 100 chars
    assert "content_preview" in entry
    assert len(entry["content_preview"]) <= 100


def test_apply_appends_to_existing_log(tmp_path, monkeypatch):
    """Re-running should append, not truncate."""
    log_path = tmp_path / "memory-dedup-log.jsonl"
    log_path.write_text(
        json.dumps({"ts": "old", "deleted_id": 999, "kept_id": 1,
                    "similarity": 0.99, "confidence": "LOW",
                    "content_preview": "old"}) + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(dedup, "LOG_PATH", log_path)

    pairs = [(1, 2, 0.97)]
    rows = [
        _row(1, confidence="medium", days_ago=1),
        _row(2, confidence="medium", days_ago=10),
    ]
    _stub_pairs_and_rows(monkeypatch, pairs, rows)

    rc = dedup.run(threshold=0.95, limit=500, apply=True)
    assert rc == 0

    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2  # 1 old + 1 new
    old = json.loads(lines[0])
    new = json.loads(lines[1])
    assert old["deleted_id"] == 999
    assert new["deleted_id"] == 2


def test_apply_multi_cluster_deletes_all_non_keepers(tmp_path, monkeypatch):
    """Cluster of 3: 1 keeper, 2 deletions; second cluster of 2: 1 keeper, 1 deletion."""
    pairs = [(1, 2, 0.96), (2, 3, 0.97), (10, 11, 0.99)]  # cluster {1,2,3} + {10,11}
    rows = [
        _row(1, confidence="high", days_ago=1),  # cluster A keeper (newest)
        _row(2, confidence="medium", days_ago=5),
        _row(3, confidence="medium", days_ago=10),
        _row(10, confidence="high", days_ago=2),  # cluster B keeper
        _row(11, confidence="low", days_ago=8),
    ]
    fake_delete = _stub_pairs_and_rows(monkeypatch, pairs, rows)
    log_path = tmp_path / "memory-dedup-log.jsonl"
    monkeypatch.setattr(dedup, "LOG_PATH", log_path)

    rc = dedup.run(threshold=0.95, limit=500, apply=True)

    assert rc == 0
    assert sorted(fake_delete.deleted) == [2, 3, 11]
    lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 3


def test_apply_creates_log_dir_if_missing(tmp_path, monkeypatch):
    """Log path's parent dir is created on first write."""
    log_path = tmp_path / "nested" / "subdir" / "memory-dedup-log.jsonl"
    monkeypatch.setattr(dedup, "LOG_PATH", log_path)

    pairs = [(1, 2, 0.96)]
    rows = [
        _row(1, confidence="medium", days_ago=1),
        _row(2, confidence="medium", days_ago=10),
    ]
    _stub_pairs_and_rows(monkeypatch, pairs, rows)

    rc = dedup.run(threshold=0.95, limit=500, apply=True)
    assert rc == 0
    assert log_path.exists()
