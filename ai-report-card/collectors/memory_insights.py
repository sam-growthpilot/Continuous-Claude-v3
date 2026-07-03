"""Query PostgreSQL memory system for weekly insights."""

import os
from datetime import datetime, timedelta


def get_db_connection(database_url: str = None):
    """Get a PostgreSQL connection."""
    try:
        import psycopg2
    except ImportError:
        return None

    url = database_url or os.environ.get(
        "DATABASE_URL",
        "postgresql://claude:claude_dev@localhost:5432/continuous_claude"
    )

    try:
        return psycopg2.connect(url)
    except Exception:
        return None


def query_recent_learnings(conn, days: int = 7, limit: int = 20) -> list[dict]:
    """Get learnings stored in the last N days.

    Schema: archival_memory has columns: id, content, metadata (jsonb),
    embedding, created_at, scope, project_id, session_id, agent_id.
    Fields like type, context, confidence, tags are inside metadata jsonb.
    """
    since = (datetime.now() - timedelta(days=days)).isoformat()
    query = """
        SELECT content,
               metadata->>'type' as learning_type,
               metadata->>'context' as context,
               metadata->>'confidence' as confidence,
               metadata->'tags' as tags,
               created_at
        FROM archival_memory
        WHERE created_at >= %s
        ORDER BY created_at DESC
        LIMIT %s
    """
    try:
        with conn.cursor() as cur:
            cur.execute(query, (since, limit))
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
    except Exception:
        return []


def query_by_type(conn, learning_type: str, days: int = 7) -> list[dict]:
    """Get learnings of a specific type from the last N days."""
    since = (datetime.now() - timedelta(days=days)).isoformat()
    query = """
        SELECT content,
               metadata->>'context' as context,
               metadata->>'confidence' as confidence,
               created_at
        FROM archival_memory
        WHERE metadata->>'type' = %s AND created_at >= %s
        ORDER BY created_at DESC
        LIMIT 10
    """
    try:
        with conn.cursor() as cur:
            cur.execute(query, (learning_type, since))
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
    except Exception:
        return []


def get_total_learnings(conn) -> int:
    """Get total count of stored learnings."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM archival_memory")
            return cur.fetchone()[0]
    except Exception:
        return 0


def collect_all(config: dict) -> dict:
    """Collect memory insights for the weekly report."""
    memory_config = config.get("memory", {})
    database_url = memory_config.get("database_url")

    conn = get_db_connection(database_url)
    if not conn:
        return {
            "available": False,
            "error": "Could not connect to PostgreSQL memory database",
            "total_learnings": 0,
            "recent_count": 0,
            "recent_learnings": [],
            "achievements": [],
            "decisions": [],
            "error_fixes": [],
            "collected_at": datetime.now().isoformat(),
        }

    try:
        recent = query_recent_learnings(conn, days=7)
        achievements = query_by_type(conn, "WORKING_SOLUTION", days=7)
        decisions = query_by_type(conn, "ARCHITECTURAL_DECISION", days=7)
        error_fixes = query_by_type(conn, "ERROR_FIX", days=7)
        total = get_total_learnings(conn)

        # Serialize datetimes
        def serialize(items):
            for item in items:
                for k, v in item.items():
                    if isinstance(v, datetime):
                        item[k] = v.isoformat()
            return items

        return {
            "available": True,
            "total_learnings": total,
            "recent_count": len(recent),
            "recent_learnings": serialize(recent),
            "achievements": serialize(achievements),
            "decisions": serialize(decisions),
            "error_fixes": serialize(error_fixes),
            "collected_at": datetime.now().isoformat(),
        }
    finally:
        conn.close()


if __name__ == "__main__":
    import json
    import yaml
    from pathlib import Path

    config_path = Path(__file__).parent.parent / "config.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    data = collect_all(config)
    print(json.dumps(data, indent=2, default=str))
