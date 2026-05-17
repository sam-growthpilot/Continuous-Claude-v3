#!/usr/bin/env python3
"""Backfill canonical learning types in archival_memory metadata.

Phase 1.1 / Task #4 of memory-hardening-2026-05-16.

Problem:
    449 of 453 rows in archival_memory have ``metadata->>'type' =
    'session_learning'`` -- the hardcoded format flag from
    ``store_learning_v2``. Only 4 rows use the canonical 7-type taxonomy.
    Recall, scoring, and downstream filters all rely on the canonical types,
    so the dead taxonomy hurts retrieval quality.

Solution:
    For each affected row, apply the auto-type heuristic from
    ``.claude/skills/memory/SKILL.md`` (mirrored in
    ``incremental_extract.infer_learning_type``) and update
    ``metadata['type']`` accordingly. Preserve every other metadata key.

    Heuristic order (more specific first):
        - OPEN_THREAD:           TODO | incomplete | next session | to do later
        - USER_PREFERENCE:       prefer | user wants | user prefers
        - FAILED_APPROACH:       failed | didn't work | don't do
        - ERROR_FIX:             error | exception | fix | bug
        - ARCHITECTURAL_DECISION: decided | chose | architecture | trade-off | rationale | "Decisions:" header
        - CODEBASE_PATTERN:      pattern | always | convention | recurring
        - WORKING_SOLUTION:      default

Modes:
    --dry-run  (DEFAULT)  print the distribution table of inferred types and
                          a sample preview, write nothing.
    --apply               run the UPDATE inside a single transaction. Prints
                          before/after counts.

    --json                emit machine-readable JSON (mode-agnostic).
    --limit N             only consider the most recent N candidate rows
                          (useful for the 5-row sanity sample).
    --sample N            also dump N representative rows per inferred type
                          to stderr so the user can eyeball the classifier.

Idempotency:
    --apply is safe to re-run: rows already in a canonical type are filtered
    out of the candidate set in SQL.

Usage:
    cd $CLAUDE_OPC_DIR
    PYTHONPATH=. uv run python scripts/core/backfill_types.py --dry-run
    PYTHONPATH=. uv run python scripts/core/backfill_types.py --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

try:
    from dotenv import load_dotenv
    # Load env (matches the pattern used by neighbouring scripts).
    global_env = Path.home() / ".claude" / ".env"
    if global_env.exists():
        load_dotenv(global_env)
    load_dotenv()
except ImportError:
    # python-dotenv not available; rely on env vars already set in environment.
    pass

# scripts/ on sys.path so `from db.postgres_pool import ...` resolves the same
# way it does in backfill_scope.py.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.incremental_extract import infer_learning_type  # noqa: E402

CANONICAL_TYPES = {
    "FAILED_APPROACH",
    "WORKING_SOLUTION",
    "USER_PREFERENCE",
    "CODEBASE_PATTERN",
    "ARCHITECTURAL_DECISION",
    "ERROR_FIX",
    "OPEN_THREAD",
}


async def backfill_types(
    dry_run: bool = True,
    limit: int | None = None,
    sample_per_type: int = 0,
) -> dict:
    """Backfill metadata['type'] for archival_memory rows with the dead default.

    Args:
        dry_run: If True, no UPDATE issued. Just compute and report.
        limit: If set, restrict candidate set to ``LIMIT N`` (most recent).
        sample_per_type: If >0, capture this many sample rows per inferred type
            into the result dict for human review.

    Returns:
        ``{"success": bool, "dry_run": bool, "stats": {...}, "samples": {...}}``
    """
    try:
        from db.postgres_pool import get_transaction
    except ImportError as e:
        return {"success": False, "error": f"Database not available: {e}"}

    inferred_counter: Counter[str] = Counter()
    samples: dict[str, list[dict]] = defaultdict(list)
    before_counter: Counter[str] = Counter()
    updates_applied = 0
    rows_examined = 0
    parse_errors = 0

    # Candidate set: rows where metadata.type is the dead literal OR missing.
    # NULL metadata.type is included so we never leave an unclassified row.
    base_sql = """
        SELECT id, content, metadata
        FROM archival_memory
        WHERE metadata->>'type' = 'session_learning'
           OR metadata->>'type' IS NULL
        ORDER BY created_at DESC
    """
    if limit is not None:
        base_sql = base_sql.rstrip() + f"\n        LIMIT {int(limit)}"

    async with get_transaction() as conn:
        rows = await conn.fetch(base_sql)

        for row in rows:
            rows_examined += 1
            content = row["content"] or ""
            metadata = row["metadata"]

            # asyncpg returns jsonb as a str by default; some configurations
            # decode to dict via the json codec. Handle both shapes so this
            # script works in either deployment.
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except json.JSONDecodeError:
                    parse_errors += 1
                    metadata = {}
            elif metadata is None:
                metadata = {}

            current_type = metadata.get("type")
            before_counter[current_type or "<NULL>"] += 1

            inferred = infer_learning_type(content)
            inferred_counter[inferred] += 1

            if sample_per_type and len(samples[inferred]) < sample_per_type:
                samples[inferred].append({
                    "id": str(row["id"]),
                    "preview": content[:120].replace("\n", " "),
                    "current_type": current_type,
                    "current_learning_type": metadata.get("learning_type"),
                })

            if not dry_run:
                # Build new metadata: preserve every existing key, override
                # only ``type``. Use jsonb_set so we never accidentally drop a
                # sibling key (defensive even though we already have the full
                # dict in Python -- belt-and-suspenders).
                new_metadata = dict(metadata)
                new_metadata["type"] = inferred
                await conn.execute(
                    "UPDATE archival_memory SET metadata = $1::jsonb WHERE id = $2",
                    json.dumps(new_metadata),
                    row["id"],
                )
                updates_applied += 1

    stats = {
        "rows_examined": rows_examined,
        "parse_errors": parse_errors,
        "before_distribution": dict(before_counter),
        "inferred_distribution": dict(inferred_counter),
        "updates_applied": updates_applied,
    }

    # Confirm every inferred value is canonical -- sanity check.
    unknown = [t for t in inferred_counter if t not in CANONICAL_TYPES]
    if unknown:
        stats["WARNING_unknown_types"] = unknown

    return {
        "success": True,
        "dry_run": dry_run,
        "stats": stats,
        "samples": {k: v for k, v in samples.items()},
    }


def _format_distribution_table(stats: dict) -> str:
    """Render the inferred-type distribution as a Markdown table."""
    dist = stats.get("inferred_distribution", {})
    if not dist:
        return "_no candidate rows -- nothing to backfill._"

    total = sum(dist.values())
    lines = [
        "| Inferred Type | Count | Share |",
        "|---|---:|---:|",
    ]
    # Sort descending by count for review readability.
    for t, c in sorted(dist.items(), key=lambda kv: -kv[1]):
        share = (c / total * 100) if total else 0.0
        lines.append(f"| {t} | {c} | {share:.1f}% |")
    lines.append(f"| **TOTAL** | **{total}** | **100.0%** |")
    return "\n".join(lines)


async def main():
    parser = argparse.ArgumentParser(
        description="Backfill canonical learning types in archival_memory metadata",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually run the UPDATE. Default behaviour is --dry-run.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="(Default) Compute and report, write nothing.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Only consider the N most recent candidate rows (useful for sanity sampling).",
    )
    parser.add_argument(
        "--sample",
        type=int,
        default=3,
        help="How many sample rows per inferred type to print for review (default 3).",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of prose.")
    args = parser.parse_args()

    # Default to dry-run unless --apply was explicitly requested.
    dry_run = True
    if args.apply and args.dry_run:
        print("Both --apply and --dry-run passed. --dry-run wins.", file=sys.stderr)
        dry_run = True
    elif args.apply:
        dry_run = False

    result = await backfill_types(
        dry_run=dry_run,
        limit=args.limit,
        sample_per_type=args.sample,
    )

    if args.json:
        print(json.dumps(result, indent=2, default=str))
        if not result.get("success"):
            sys.exit(1)
        return

    if not result["success"]:
        print(f"Failed: {result.get('error', 'unknown')}", file=sys.stderr)
        sys.exit(1)

    stats = result["stats"]
    mode = "DRY RUN" if result["dry_run"] else "APPLIED"

    print(f"\n[{mode}] Type backfill summary")
    print(f"  Rows examined: {stats['rows_examined']}")
    print(f"  Parse errors:  {stats['parse_errors']}")
    if not result["dry_run"]:
        print(f"  Updates applied: {stats['updates_applied']}")
    if stats.get("WARNING_unknown_types"):
        print(f"  WARNING: unknown inferred types: {stats['WARNING_unknown_types']}")

    print("\n## Inferred Type Distribution\n")
    print(_format_distribution_table(stats))

    print("\n## Before Distribution (what metadata.type is *now*)\n")
    before = stats.get("before_distribution", {})
    if before:
        for t, c in sorted(before.items(), key=lambda kv: -kv[1]):
            print(f"  {t}: {c}")
    else:
        print("  (none)")

    samples = result.get("samples") or {}
    if samples:
        print("\n## Sample rows per inferred type\n")
        for t in sorted(samples):
            print(f"\n### {t}")
            for s in samples[t]:
                print(f"  id={s['id']}")
                print(f"    current_type:          {s['current_type']}")
                print(f"    current_learning_type: {s['current_learning_type']}")
                print(f"    preview: {s['preview']}")

    if result["dry_run"]:
        print(
            "\nDry run only -- no rows were modified.\n"
            "Re-run with --apply to write the changes.\n"
        )


if __name__ == "__main__":
    asyncio.run(main())
