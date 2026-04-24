#!/usr/bin/env python3
"""Synthesize patterns from the archival_memory corpus via RLM.

Complements recall_learnings.py (point-lookup via vector similarity) with a
full-corpus synthesis mode. Loads the full archival_memory table (optionally
filtered by tag/type) as a JSON list into the RLM REPL, where the model can
write `json.loads(context)` and Python `for`/`Counter` logic instead of regex
on prose -- a much better fit for structured memory data.

USAGE:
    cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/analyze_learnings.py \\
        --question "How have I approached hook development over time?" \\
        --tags hooks \\
        --types ERROR_FIX WORKING_SOLUTION

    # JSON-structured output (for programmatic callers)
    ... --output-json

Architecture notes:
- DB access is async via the existing asyncpg pool (scripts.core.db.postgres_pool)
- Filters use JSONB operators: `metadata->'tags' ?| ARRAY[...]` for tags,
  `metadata->>'type' = ANY(...)` for entry types. The archival_memory schema
  stores tags/type inside `metadata` JSONB, not as separate columns.
- Returned rows are JSON-serializable (created_at -> ISO string, metadata
  decoded from string to dict if asyncpg returned it as a string).
- The context passed to RLM is a JSON *string* (not a Python object) so
  the REPL model runs `json.loads(context)` to work with it.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Load .env (opc/.env is authoritative for DATABASE_URL + ANTHROPIC_API_KEY)
_script_dir = Path(__file__).resolve().parent
_opc_dir = _script_dir.parent.parent  # opc/scripts/core -> opc/
_opc_env = _opc_dir / ".env"
if _opc_env.exists():
    load_dotenv(_opc_env, override=True)
_global_env = Path.home() / ".claude" / ".env"
if _global_env.exists():
    load_dotenv(_global_env)
load_dotenv()

# Path setup so the module can be imported both via pytest (where
# conftest puts opc/ and opc/scripts/core/ on sys.path) and via a bare
# `uv run python scripts/core/analyze_learnings.py ...` invocation.
#   - opc/scripts/core/  -> lets `from db.postgres_pool import get_pool` resolve
#   - opc/              -> lets `from scripts.core.rlm_client import ...` resolve
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, str(_opc_dir))

from db.postgres_pool import get_pool  # noqa: E402  (after path tweak)

from scripts.core.rlm_client import RLMPolicy, rlm_complete  # noqa: E402


# ---------------------------------------------------------------------------
# Corpus fetching
# ---------------------------------------------------------------------------


async def _fetch_corpus_async(
    tag_filter: list[str] | None = None,
    type_filter: list[str] | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Fetch archival_memory rows as JSON-serializable dicts.

    Pre-filtering in SQL is cheaper than filtering in the REPL and keeps us
    below the RLM budget on big corpora. Small corpora (<300K chars when
    serialized) will transparently skip RLM via the client's threshold guard.

    Args:
        tag_filter: If provided, keep only rows whose metadata.tags intersects.
        type_filter: If provided, keep only rows whose metadata.type is one of.
        limit: Optional row cap (usually omit -- we want the whole corpus).

    Returns:
        List of dicts with keys: id, session_id, content, metadata (dict),
        created_at (ISO-8601 string), entry_type (pulled up from metadata
        for convenience), tags (pulled up), confidence (pulled up), context
        (pulled up).
    """
    where: list[str] = []
    params: list[Any] = []

    if tag_filter:
        params.append(list(tag_filter))
        where.append(f"metadata->'tags' ?| ${len(params)}::text[]")
    if type_filter:
        params.append(list(type_filter))
        where.append(f"metadata->>'type' = ANY(${len(params)}::text[])")

    sql = (
        "SELECT id, session_id, content, metadata, created_at "
        "FROM archival_memory"
    )
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC"
    if limit is not None:
        # int() guards against SQL injection via --limit
        sql += f" LIMIT {int(limit)}"

    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)

    out: list[dict[str, Any]] = []
    for row in rows:
        metadata = row["metadata"]
        # asyncpg returns JSONB as either dict or str depending on codec setup.
        # Normalize to dict.
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except json.JSONDecodeError:
                metadata = {}
        elif metadata is None:
            metadata = {}

        created_at = row["created_at"]
        if isinstance(created_at, datetime):
            created_at_str = created_at.isoformat()
        else:
            created_at_str = str(created_at) if created_at is not None else ""

        out.append({
            "id": str(row["id"]),
            "session_id": row["session_id"],
            "content": row["content"],
            "metadata": metadata,
            "created_at": created_at_str,
            # Lift commonly referenced fields so the REPL model can grab them
            # without remembering they live under metadata.
            "entry_type": metadata.get("type"),
            "tags": metadata.get("tags", []),
            "context": metadata.get("context"),
            "confidence": metadata.get("confidence"),
        })

    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _short_ts() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _build_prompt(user_question: str) -> str:
    """Wrap the user's question with JSON-context instructions for the RLM model."""
    return (
        f"{user_question}\n\n"
        "The `context` variable is a JSON string of archival_memory rows. "
        "Each row has: id, session_id, content, metadata (dict), created_at (ISO string), "
        "entry_type, tags (list), context, confidence. "
        "Use `json.loads(context)` to work with them as a list of dicts. "
        "Filter with comprehensions (`[e for e in data if 'hooks' in e['tags']]`), "
        "aggregate with collections.Counter, and group by entry_type or tag as needed. "
        "Cite specific entry IDs in your answer so claims are traceable."
    )


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Synthesize patterns across the archival_memory corpus via RLM.",
    )
    ap.add_argument(
        "--question", required=True,
        help="analysis question, e.g. 'how have I approached hooks?'",
    )
    ap.add_argument(
        "--tags", nargs="*", default=None,
        help="filter by tag(s) -- rows whose metadata.tags intersects this set",
    )
    ap.add_argument(
        "--types", nargs="*", default=None,
        help="filter by metadata.type (ERROR_FIX, WORKING_SOLUTION, etc.)",
    )
    ap.add_argument(
        "--limit", type=int, default=None,
        help="cap rows returned (usually omit to get full corpus)",
    )
    ap.add_argument(
        "--budget-usd", type=float, default=2.00,
        help="hard cost cap for the RLM run (default 2.00 USD)",
    )
    ap.add_argument(
        "--output-json", action="store_true",
        help="emit {answer, path, usage, trajectory_dir} as JSON",
    )
    args = ap.parse_args()

    # Fetch corpus (async -> sync at CLI boundary)
    corpus = asyncio.run(_fetch_corpus_async(
        tag_filter=args.tags,
        type_filter=args.types,
        limit=args.limit,
    ))

    if not corpus:
        print("analyze_learnings: no entries matched", file=sys.stderr)
        return 2

    corpus_json = json.dumps(corpus, ensure_ascii=False, indent=2)
    print(
        f"analyze_learnings: {len(corpus)} entries, {len(corpus_json):,} chars",
        file=sys.stderr,
    )

    traj_dir = Path(".claude/cache/rlm-logs/memory") / _short_ts()
    traj_dir.mkdir(parents=True, exist_ok=True)

    question = _build_prompt(args.question)

    result = rlm_complete(
        question=question,
        context=corpus_json,
        policy=RLMPolicy(max_budget_usd=args.budget_usd),
        trajectory_dir=traj_dir,
    )

    if args.output_json:
        payload = {
            "answer": result.answer,
            "path": result.path,
            "usage": getattr(result, "usage", {}) or {},
            "trajectory_dir": str(traj_dir),
        }
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(result.answer)
        print(
            f"\n--- path: {result.path} | trajectory: {traj_dir} ---",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
