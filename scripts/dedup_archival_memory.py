#!/usr/bin/env python3
"""One-time backfill: deduplicate near-identical entries in archival_memory.

The memory-duplicate-scan health check finds pairs at >= 0.95 cosine
similarity that survived the 0.85 dedup threshold used at write-time.
This script clusters those pairs transitively, picks a single keeper per
cluster (newest -> highest confidence -> lowest id), and either prints a
plan (default) or deletes the rest (--apply).

USAGE
-----
    python scripts/dedup_archival_memory.py                 # dry-run
    python scripts/dedup_archival_memory.py --apply         # delete + log
    python scripts/dedup_archival_memory.py --threshold 0.95
    python scripts/dedup_archival_memory.py --limit 100     # cap entries scanned

Default threshold: 0.95
Default limit: 500 (matches the health-check window)

LOGGING
-------
On --apply, every deletion appends one JSON object to
.claude/cache/memory-dedup-log.jsonl with fields:
    ts, deleted_id, kept_id, similarity, confidence, content_preview

ENVIRONMENT
-----------
    DATABASE_URL  PostgreSQL connection string (loaded from opc/.env)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

# ---------------------------------------------------------------------------
# Environment loading -- mirror the pattern in opc/scripts/health_check.py so
# DATABASE_URL is picked up from opc/.env when run from the repo root.
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv

    _SCRIPT_DIR = Path(__file__).resolve().parent
    _REPO_ROOT = _SCRIPT_DIR.parent
    _OPC_ENV = _REPO_ROOT / "opc" / ".env"
    if _OPC_ENV.exists():
        load_dotenv(_OPC_ENV, override=True)
    _GLOBAL_ENV = Path.home() / ".claude" / ".env"
    if _GLOBAL_ENV.exists():
        load_dotenv(_GLOBAL_ENV)
    load_dotenv()
except Exception:  # pragma: no cover - dotenv optional
    pass


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).resolve().parent.parent
LOG_PATH: Path = _REPO_ROOT / ".claude" / "cache" / "memory-dedup-log.jsonl"

DEFAULT_THRESHOLD: float = 0.95
DEFAULT_LIMIT: int = 500

# Confidence ranking: HIGH > MEDIUM > LOW > unknown
_CONFIDENCE_RANK = {"high": 3, "medium": 2, "low": 1}

# Keep content preview short in the log
_PREVIEW_LEN = 100


# ---------------------------------------------------------------------------
# Pure helpers (the core logic that gets unit-tested)
# ---------------------------------------------------------------------------


def cluster_duplicates(pairs: Iterable[tuple[Any, Any, float]]) -> list[list[Any]]:
    """Group similarity pairs into transitive duplicate clusters.

    Uses a union-find structure so that {(A, B), (B, C)} collapses into
    a single {A, B, C} cluster.

    Args:
        pairs: iterable of (id_a, id_b, similarity) tuples.

    Returns:
        A list of clusters; each cluster is a list of ids. Empty input -> [].
        IDs within each cluster are sorted (when comparable) for determinism;
        clusters themselves are sorted by their minimum id.
    """
    parent: dict[Any, Any] = {}

    def find(x):
        # Iterative path-compression to avoid recursion limits on long chains
        root = x
        while parent[root] != root:
            root = parent[root]
        # Compress
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a, b):
        if a not in parent:
            parent[a] = a
        if b not in parent:
            parent[b] = b
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for a, b, _sim in pairs:
        union(a, b)

    groups: dict[Any, list[Any]] = {}
    for node in parent:
        root = find(node)
        groups.setdefault(root, []).append(node)

    out: list[list[Any]] = []
    for members in groups.values():
        try:
            members_sorted = sorted(members)
        except TypeError:
            members_sorted = list(members)
        out.append(members_sorted)

    # Stable order for clusters themselves
    try:
        out.sort(key=lambda c: c[0])
    except TypeError:
        pass
    return out


def _confidence_rank(conf: str | None) -> int:
    if conf is None:
        return 0
    return _CONFIDENCE_RANK.get(str(conf).lower(), 0)


def pick_keeper(rows: list[dict]) -> dict:
    """Pick the row to keep from a duplicate cluster.

    Tiebreak order:
        1. newest created_at
        2. highest confidence (HIGH > MEDIUM > LOW > unknown)
        3. lowest id

    Args:
        rows: list of dicts with keys {id, created_at, confidence}.

    Returns:
        The chosen keeper row.
    """
    if not rows:
        raise ValueError("pick_keeper requires at least one row")

    def sort_key(r: dict):
        # Larger is better; we'll use max() so flip id with negation when comparable
        # but id may be UUID, so do tiebreak via separate min() pass.
        return (
            r["created_at"],
            _confidence_rank(r.get("confidence")),
        )

    # Find best (created_at, confidence)
    best = max(rows, key=sort_key)
    best_key = sort_key(best)

    # Filter to all rows tied on (created_at, confidence) and pick lowest id
    tied = [r for r in rows if sort_key(r) == best_key]
    if len(tied) == 1:
        return tied[0]
    try:
        return min(tied, key=lambda r: r["id"])
    except TypeError:
        # Mixed/incomparable id types -> stable: first tied wins
        return tied[0]


def _format_id(id_: Any) -> str:
    s = str(id_)
    if len(s) > 36:
        return s[:8] + "..."
    return s


def format_plan(
    clusters: list[list[Any]],
    *,
    rows_by_id: dict[Any, dict],
    max_sims: dict[tuple[Any, Any], float],
) -> str:
    """Render a deterministic, human-readable plan.

    Args:
        clusters: list of clusters (id lists) from cluster_duplicates.
        rows_by_id: id -> row dict (must include created_at, confidence).
        max_sims: ((id_a, id_b) sorted) -> max similarity seen, for display.

    Returns:
        Multi-line string suitable for stdout.
    """
    total_remove = sum(max(0, len(c) - 1) for c in clusters)
    lines: list[str] = []
    lines.append(f"Found {len(clusters)} duplicate cluster"
                 f"{'s' if len(clusters) != 1 else ''} "
                 f"({total_remove} removable entries)")

    # Sort clusters for determinism (by smallest id when comparable)
    def cluster_sort_key(c):
        try:
            return (0, sorted(c)[0])
        except TypeError:
            return (1, str(c[0]))

    sorted_clusters = sorted(clusters, key=cluster_sort_key)

    for idx, cluster in enumerate(sorted_clusters, start=1):
        cluster_rows = [rows_by_id[i] for i in cluster if i in rows_by_id]
        if not cluster_rows:
            continue
        keeper = pick_keeper(cluster_rows)
        # Compute max similarity within this cluster
        max_sim = 0.0
        cluster_set = set(cluster)
        for (a, b), s in max_sims.items():
            if a in cluster_set and b in cluster_set and s > max_sim:
                max_sim = s
        lines.append(
            f"Cluster {idx} (size={len(cluster_rows)}, max_sim={max_sim:.3f}):"
        )
        # Sort members deterministically: keeper first, then removals by id
        non_keepers = [r for r in cluster_rows if r["id"] != keeper["id"]]
        try:
            non_keepers.sort(key=lambda r: r["id"])
        except TypeError:
            pass

        keeper_conf = (keeper.get("confidence") or "").upper() or "UNKNOWN"
        keeper_date = _fmt_date(keeper["created_at"])
        lines.append(
            f"  KEEP id={_format_id(keeper['id'])} "
            f"({keeper_conf}, {keeper_date})"
        )
        for r in non_keepers:
            conf = (r.get("confidence") or "").upper() or "UNKNOWN"
            date = _fmt_date(r["created_at"])
            lines.append(
                f"  REMOVE id={_format_id(r['id'])} "
                f"({conf}, {date}) "
                f"[duplicate of id={_format_id(keeper['id'])}]"
            )

    lines.append(f"Total: {total_remove} entries would be removed.")
    return "\n".join(lines)


def _fmt_date(dt: datetime | None) -> str:
    if dt is None:
        return "unknown"
    if isinstance(dt, datetime):
        return dt.date().isoformat()
    return str(dt)


# ---------------------------------------------------------------------------
# DB layer (separated so tests can monkeypatch without a live Postgres)
# ---------------------------------------------------------------------------


def _get_dsn() -> str | None:
    return (
        os.environ.get("OPC_POSTGRES_URL")
        or os.environ.get("AGENTICA_POSTGRES_URL")
        or os.environ.get("DATABASE_URL")
    )


async def _fetch_pairs(threshold: float, limit: int) -> list[tuple[Any, Any, float]]:
    """Fetch all pairs >= threshold within the most recent `limit` entries."""
    import asyncpg  # type: ignore

    dsn = _get_dsn()
    if not dsn:
        raise RuntimeError(
            "DATABASE_URL not set. Configure opc/.env or your shell env."
        )
    conn = await asyncpg.connect(dsn, timeout=30)
    try:
        rows = await conn.fetch(
            """
            WITH recent AS (
              SELECT id, embedding FROM archival_memory
              WHERE embedding IS NOT NULL
              ORDER BY created_at DESC
              LIMIT $1
            )
            SELECT a.id AS id_a, b.id AS id_b,
                   1 - (a.embedding <=> b.embedding) AS sim
            FROM recent a
            JOIN recent b ON a.id < b.id
            WHERE 1 - (a.embedding <=> b.embedding) >= $2
            ORDER BY sim DESC
            """,
            limit,
            threshold,
        )
        return [(r["id_a"], r["id_b"], float(r["sim"])) for r in rows]
    finally:
        await conn.close()


async def _fetch_rows(ids: list[Any]) -> list[dict]:
    """Fetch row metadata for a list of ids."""
    import asyncpg  # type: ignore

    dsn = _get_dsn()
    if not dsn:
        raise RuntimeError("DATABASE_URL not set.")
    if not ids:
        return []
    conn = await asyncpg.connect(dsn, timeout=30)
    try:
        rows = await conn.fetch(
            """
            SELECT id,
                   content,
                   created_at,
                   COALESCE(metadata->>'confidence', '') AS confidence
            FROM archival_memory
            WHERE id = ANY($1::uuid[])
            """,
            ids,
        )
        return [
            {
                "id": r["id"],
                "content": r["content"],
                "created_at": r["created_at"],
                "confidence": r["confidence"],
            }
            for r in rows
        ]
    finally:
        await conn.close()


async def _delete_rows(ids: list[Any]) -> int:
    """Delete rows by id. Returns count deleted."""
    import asyncpg  # type: ignore

    dsn = _get_dsn()
    if not dsn:
        raise RuntimeError("DATABASE_URL not set.")
    if not ids:
        return 0
    conn = await asyncpg.connect(dsn, timeout=30)
    try:
        result = await conn.execute(
            "DELETE FROM archival_memory WHERE id = ANY($1::uuid[])",
            ids,
        )
        # asyncpg returns "DELETE N"
        try:
            return int(result.split()[-1])
        except (ValueError, IndexError):
            return len(ids)
    finally:
        await conn.close()


# ---------------------------------------------------------------------------
# Log writer
# ---------------------------------------------------------------------------


def _write_log_entries(entries: list[dict]) -> None:
    """Append JSONL log entries. Creates parent dirs as needed."""
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e, default=str) + "\n")


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def _build_max_sims(pairs: Iterable[tuple[Any, Any, float]]) -> dict:
    out: dict[tuple[Any, Any], float] = {}
    for a, b, sim in pairs:
        # Normalise key ordering when ids are comparable
        try:
            key = (a, b) if a < b else (b, a)
        except TypeError:
            key = (a, b)
        if sim > out.get(key, -1.0):
            out[key] = sim
    return out


def _best_sim_to_keeper(
    cluster_ids: list[Any],
    keeper_id: Any,
    max_sims: dict,
) -> float:
    """Return max similarity between a non-keeper and the keeper."""
    best = 0.0
    for other in cluster_ids:
        if other == keeper_id:
            continue
        try:
            key = (other, keeper_id) if other < keeper_id else (keeper_id, other)
        except TypeError:
            key = (other, keeper_id) if (other, keeper_id) in max_sims else (keeper_id, other)
        sim = max_sims.get(key, 0.0)
        if sim > best:
            best = sim
    return best


def run(
    *,
    threshold: float = DEFAULT_THRESHOLD,
    limit: int = DEFAULT_LIMIT,
    apply: bool = False,
) -> int:
    """Top-level orchestrator. Synchronous wrapper around async DB calls.

    Returns:
        Exit code (0 on success).
    """
    pairs = asyncio.run(_fetch_pairs(threshold, limit))

    if not pairs:
        print(format_plan([], rows_by_id={}, max_sims={}))
        if not apply:
            print("\n(DRY-RUN -- no changes made. Pass --apply to actually delete.)")
        else:
            print("\nNothing to delete.")
        return 0

    clusters = cluster_duplicates(pairs)
    all_ids: list[Any] = []
    for c in clusters:
        all_ids.extend(c)

    rows = asyncio.run(_fetch_rows(all_ids))
    rows_by_id = {r["id"]: r for r in rows}
    max_sims = _build_max_sims(pairs)

    print(format_plan(clusters, rows_by_id=rows_by_id, max_sims=max_sims))

    if not apply:
        print("\n(DRY-RUN -- no changes made. Pass --apply to actually delete.)")
        return 0

    # --apply: collect IDs to delete + build log entries first, then commit
    to_delete: list[Any] = []
    log_entries: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()
    for cluster in clusters:
        cluster_rows = [rows_by_id[i] for i in cluster if i in rows_by_id]
        if len(cluster_rows) < 2:
            continue
        keeper = pick_keeper(cluster_rows)
        for r in cluster_rows:
            if r["id"] == keeper["id"]:
                continue
            sim = _best_sim_to_keeper(cluster, keeper["id"], max_sims)
            preview = (r.get("content") or "")[:_PREVIEW_LEN]
            log_entries.append({
                "ts": now_iso,
                "deleted_id": r["id"],
                "kept_id": keeper["id"],
                "similarity": round(sim, 4),
                "confidence": (r.get("confidence") or "").upper() or "UNKNOWN",
                "content_preview": preview,
            })
            to_delete.append(r["id"])

    if not to_delete:
        print("\nNothing to delete (no clusters of size >= 2 after row fetch).")
        return 0

    asyncio.run(_delete_rows(to_delete))
    _write_log_entries(log_entries)
    print(f"\nDeleted {len(to_delete)} entries. "
          f"Log: {LOG_PATH}")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="One-time dedup backfill for archival_memory.",
    )
    p.add_argument("--apply", action="store_true",
                   help="Actually delete duplicates (default: dry-run)")
    p.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                   help=f"Cosine similarity threshold (default {DEFAULT_THRESHOLD})")
    p.add_argument("--limit", type=int, default=DEFAULT_LIMIT,
                   help=f"Max entries scanned (default {DEFAULT_LIMIT})")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    return run(threshold=args.threshold, limit=args.limit, apply=args.apply)


if __name__ == "__main__":
    sys.exit(main())
