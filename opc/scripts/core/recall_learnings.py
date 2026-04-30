#!/usr/bin/env python3
"""Semantic recall of session learnings from archival_memory.

Searches the archival_memory table for session_learning entries
using vector similarity search.

USAGE:
    # Simple search (top 5 results, local embeddings)
    uv run python scripts/recall_learnings.py --query "authentication patterns"

    # More results
    uv run python scripts/recall_learnings.py --query "database schema" --k 10

    # Voyage embeddings (higher quality, requires VOYAGE_API_KEY)
    uv run python scripts/recall_learnings.py --query "errors" --provider voyage

Workflow:
    Query -> Embed (Local/Voyage) -> Vector Search (pgvector) -> Return

Environment:
    VOYAGE_API_KEY - For Voyage embeddings (optional)
    PostgreSQL with pgvector extension
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

# Load .env files - opc/.env is authoritative for DATABASE_URL
# Use override=True so .env takes precedence over shell env vars
script_dir = Path(__file__).resolve().parent
opc_dir = script_dir.parent.parent  # opc/scripts/core -> opc/
opc_env = opc_dir / ".env"
if opc_env.exists():
    load_dotenv(opc_env, override=True)  # opc/.env is authoritative

global_env = Path.home() / ".claude" / ".env"
if global_env.exists():
    load_dotenv(global_env)  # Global env supplements but doesn't override
load_dotenv()  # CWD .env as fallback

# Add scripts to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def format_result_preview(content: str, max_length: int = 200) -> str:
    """Format content for display, truncating if needed.

    Args:
        content: Full content string
        max_length: Maximum characters before truncation

    Returns:
        Content string, truncated with ... if over max_length
    """
    if len(content) <= max_length:
        return content
    return content[:max_length] + "..."


def get_backend() -> str:
    """Determine which backend to use (sqlite or postgres)."""
    # Check explicit env var first
    backend = os.environ.get("AGENTICA_MEMORY_BACKEND", "").lower()
    if backend in ("sqlite", "postgres"):
        return backend

    # Check if DATABASE_URL or CONTINUOUS_CLAUDE_DB_URL is set
    if os.environ.get("DATABASE_URL") or os.environ.get("CONTINUOUS_CLAUDE_DB_URL"):
        return "postgres"

    # Default to sqlite for simplicity
    return "sqlite"


def _resolve_registry_path() -> Path:
    """Locate .claude/project-registry.json relative to the install root.

    Phase B2: previously hardcoded as ``~/continuous-claude/.claude/...`` which
    only worked for the original developer's username and breaks on CI / new
    machines / non-default install paths. We instead derive the install root
    from this file's location: ``opc/scripts/core/recall_learnings.py`` lives
    three parents below the install root, so ``__file__.parents[3]`` is the
    repo root and ``<root>/.claude/project-registry.json`` is the registry.
    """
    install_root = Path(__file__).resolve().parents[3]
    return install_root / ".claude" / "project-registry.json"


def _is_registered_project(abs_path: str) -> bool:
    """Check if abs_path matches an entry in .claude/project-registry.json.

    Used to decide whether to derive a project_id from CWD or fall back to
    GLOBAL-only filtering. We treat unregistered CWDs as ambient/unsafe and
    fail-safe rather than leaking PROJECT-scoped rows.
    """
    try:
        registry_path = _resolve_registry_path()
        if not registry_path.exists():
            return False
        with open(registry_path, encoding="utf-8") as f:
            registry = json.load(f)
        norm = str(Path(abs_path).resolve()).replace("\\", "/").lower()
        for proj in registry.get("projects", []):
            proj_path = str(Path(proj.get("path", "")).resolve()).replace("\\", "/").lower()
            if proj_path and (norm == proj_path or norm.startswith(proj_path + "/")):
                return True
    except Exception:
        return False
    return False


def resolve_recall_scope(
    project_dir: str | None = None,
    all_projects: bool = False,
) -> tuple[str | None, str]:
    """Resolve project_id and recall mode for the current invocation.

    Decision flow:
      1. all_projects=True            -> ('all', 'all')           debug opt-out
      2. CLAUDE_PROJECT_ID env set    -> (env_value, 'project')   explicit override
      3. project_dir provided         -> (sha256(...), 'project') explicit
      4. CWD inside registered project-> (sha256(cwd), 'project') implicit
      5. else                          -> (None, 'global_only')   fail-safe default

    Returns:
        Tuple of (project_id, mode).
        - mode='all'           -> drop the project_id filter entirely
        - mode='project'       -> WHERE (scope='GLOBAL' OR (scope='PROJECT' AND project_id=?))
        - mode='global_only'   -> WHERE scope = 'GLOBAL'
    """
    if all_projects:
        return None, "all"

    # Explicit env-var override (used in tests + hooks that already know project_id)
    env_pid = os.environ.get("CLAUDE_PROJECT_ID")
    if env_pid:
        return env_pid, "project"

    # Explicit CLI flag
    if project_dir:
        from project_memory import get_project_id  # type: ignore
        return get_project_id(project_dir), "project"

    # Implicit: CWD inside a registered project
    cwd = os.getcwd()
    if _is_registered_project(cwd):
        from project_memory import get_project_id  # type: ignore
        return get_project_id(cwd), "project"

    # Fail-safe: GLOBAL-only when context is unclear
    return None, "global_only"


def _build_scope_clause(
    mode: str,
    project_id: str | None,
    starting_param_idx: int,
) -> tuple[str, list[Any], int]:
    """Build SQL WHERE fragment + params for project_id scoping.

    Args:
        mode: One of 'all', 'project', 'global_only'.
        project_id: 16-char project hash (only used when mode == 'project').
        starting_param_idx: Next available 1-based param index.

    Returns:
        (clause, params_to_append, next_param_idx).
        clause is a parenthesized SQL fragment to AND into the WHERE; empty
        string when no constraint is needed (mode='all').
    """
    if mode == "all":
        return "", [], starting_param_idx
    if mode == "global_only":
        return f"scope = ${starting_param_idx}", ["GLOBAL"], starting_param_idx + 1
    # mode == 'project'
    if project_id is None:
        # Defensive: caller should have set project_id when mode=='project'.
        return f"scope = ${starting_param_idx}", ["GLOBAL"], starting_param_idx + 1
    clause = (
        f"(scope = ${starting_param_idx} OR "
        f"(scope = ${starting_param_idx + 1} AND project_id = ${starting_param_idx + 2}))"
    )
    return clause, ["GLOBAL", "PROJECT", project_id], starting_param_idx + 3


async def search_learnings_text_only_postgres(
    query: str,
    k: int = 5,
    project_id: str | None = None,
    scope_mode: str | None = None,
) -> list[dict[str, Any]]:
    """Fast text-only search for PostgreSQL using full-text search.

    Uses tsvector/tsquery with GIN index. Automatic stopword handling.
    Falls back to ILIKE if tsquery fails (e.g., all stopwords).

    Cross-project isolation:
        Filters by project_id so PROJECT-scoped rows from other projects do
        not leak. GLOBAL-scoped rows are always visible. Pass scope_mode='all'
        (or set --all-projects on the CLI) to drop the filter for debug.

        When called without explicit args (the common library/test path), we
        auto-resolve scope from CLAUDE_PROJECT_ID, then CWD vs project
        registry, falling back to 'global_only' as the safe default.
    """
    from db.postgres_pool import get_pool

    # Auto-resolve scope when caller didn't pass it explicitly
    if scope_mode is None:
        project_id, scope_mode = resolve_recall_scope()

    # Build the project_id constraint
    scope_clause, scope_params, _ = _build_scope_clause(scope_mode, project_id, 3)

    pool = await get_pool()

    async with pool.acquire() as conn:
        # Try full-text search using plainto_tsquery (flexible OR semantics)
        # Strip meta-words and normalize for better matching
        meta_words = {'help', 'want', 'need', 'show', 'tell', 'find', 'look', 'please', 'with', 'for'}
        clean_query = query.lower().replace('-', ' ')  # "multi-terminal" -> "multi terminal"
        clean_query = ' '.join(w for w in clean_query.split() if w not in meta_words)
        if not clean_query.strip():
            clean_query = query  # Fallback to original if all stripped

        # Build OR-based query: "session affinity terminal" -> 'session' | 'affinity' | 'terminal'
        # This matches documents containing ANY of the terms, ranked by how many match
        words = [w for w in clean_query.split() if len(w) > 2]
        if not words:
            words = clean_query.split()[:1] or [query.split()[0]]
        or_query = ' | '.join(words)

        scope_sql = f" AND {scope_clause}" if scope_clause else ""
        rows = await conn.fetch(
            f"""
            SELECT
                id,
                session_id,
                content,
                metadata,
                created_at,
                ts_rank(to_tsvector('english', content), to_tsquery('english', $1)) as similarity
            FROM archival_memory
            WHERE (metadata->>'type' IS NULL OR metadata->>'type' IN (
                'session_learning', 'WORKING_SOLUTION', 'ERROR_FIX',
                'ARCHITECTURAL_DECISION', 'CODEBASE_PATTERN', 'FAILED_APPROACH',
                'USER_PREFERENCE', 'OPEN_THREAD'))
                AND to_tsvector('english', content) @@ to_tsquery('english', $1)
                AND LENGTH(content) >= 50
                AND content NOT LIKE 'Agent ''%'' failed when given task:%'
                {scope_sql}
            ORDER BY similarity DESC, created_at DESC
            LIMIT $2
            """,
            or_query,
            k,
            *scope_params,
        )

        # Fallback to ILIKE if no FTS results (query was all stopwords)
        if not rows:
            # Extract first word for simple substring match
            first_word = query.split()[0] if query.split() else query
            rows = await conn.fetch(
                f"""
                SELECT
                    id,
                    session_id,
                    content,
                    metadata,
                    created_at,
                    0.1 as similarity
                FROM archival_memory
                WHERE (metadata->>'type' IS NULL OR metadata->>'type' IN (
                    'session_learning', 'WORKING_SOLUTION', 'ERROR_FIX',
                    'ARCHITECTURAL_DECISION', 'CODEBASE_PATTERN', 'FAILED_APPROACH',
                    'USER_PREFERENCE', 'OPEN_THREAD'))
                    AND content ILIKE '%' || $1 || '%'
                    AND LENGTH(content) >= 50
                    AND content NOT LIKE 'Agent ''%'' failed when given task:%'
                    {scope_sql}
                ORDER BY created_at DESC
                LIMIT $2
                """,
                first_word,
                k,
                *scope_params,
            )

    results = []
    for row in rows:
        metadata = row["metadata"]
        if isinstance(metadata, str):
            metadata = json.loads(metadata)

        results.append({
            "id": str(row["id"]),
            "session_id": row["session_id"],
            "content": row["content"],
            "metadata": metadata,
            "created_at": row["created_at"],
            "similarity": float(row["similarity"]),  # Use actual ts_rank score
        })

    return results


async def search_learnings_sqlite(query: str, k: int = 5) -> list[dict[str, Any]]:
    """Search learnings using SQLite FTS5 (BM25 ranking).

    Cross-session search - finds learnings from ALL sessions.

    Args:
        query: Search query
        k: Number of results to return

    Returns:
        List of matching learnings with BM25 scores
    """
    import sqlite3
    import re

    # Global SQLite path
    db_path = Path.home() / ".claude" / "cache" / "memory.db"

    if not db_path.exists():
        return []

    # Prepare FTS query (OR-join words for broader matching)
    words = re.findall(r"\w+", query.lower())
    fts_query = " OR ".join(words) if words else query

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    try:
        cursor = conn.execute(
            """
            SELECT
                a.id,
                a.session_id,
                a.content,
                a.metadata_json,
                a.created_at,
                bm25(archival_fts) as rank
            FROM archival_memory a
            JOIN archival_fts f ON a.rowid = f.rowid
            WHERE archival_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (fts_query, k),
        )
        rows = cursor.fetchall()

        results = []
        for row in rows:
            # BM25 returns negative scores (lower = better)
            # Normalize to 0.0-1.0 range
            raw_rank = row["rank"] if row["rank"] else 0
            normalized_score = min(1.0, max(0.0, -raw_rank / 25.0))

            metadata = {}
            if row["metadata_json"]:
                try:
                    metadata = json.loads(row["metadata_json"])
                except json.JSONDecodeError:
                    pass

            results.append({
                "id": row["id"] or "",
                "session_id": row["session_id"] or "unknown",
                "content": row["content"] or "",
                "metadata": metadata,
                "created_at": datetime.fromtimestamp(row["created_at"]) if row["created_at"] else None,
                "similarity": normalized_score,
            })

        return results
    finally:
        conn.close()


async def search_learnings_hybrid_rrf(
    query: str,
    k: int = 5,
    provider: str = "local",
    rrf_k: int = 60,
    similarity_threshold: float = 0.0,
    project_id: str | None = None,
    scope_mode: str | None = None,
) -> list[dict[str, Any]]:
    """Hybrid RRF search combining text and vector rankings.

    Uses Reciprocal Rank Fusion:
        score = 1/(k + rank_fts) + 1/(k + rank_vector)

    Args:
        query: Search query
        k: Number of results
        provider: Embedding provider
        rrf_k: RRF constant (default 60)
        similarity_threshold: Minimum RRF score to include
        project_id: Project hash (16-char sha256). Auto-derived when None.
        scope_mode: 'project' | 'global_only' | 'all'. Auto-resolved when None.

    Returns:
        List of learnings with RRF scores

    Cross-project isolation:
        PROJECT-scoped rows from other projects are filtered out by default.
        GLOBAL-scoped rows are always visible. Pass scope_mode='all' to drop
        the filter (debug only).
    """
    from db.embedding_service import EmbeddingService
    from db.memory_service_pg import build_rrf_sql
    from db.postgres_pool import get_pool, init_pgvector

    # Auto-resolve scope when caller didn't pass it explicitly
    if scope_mode is None:
        project_id, scope_mode = resolve_recall_scope()

    pool = await get_pool()

    # Generate query embedding
    embedder = EmbeddingService(provider=provider)
    try:
        query_embedding = await embedder.embed(query)
    finally:
        await embedder.aclose()

    # Filter to learning-typed entries (or untyped legacy rows), with content
    # length and a known agent-failure exclusion. Phase 3B: WHERE-only fragment;
    # the shared builder appends the FTS @@ tsquery and embedding-NOT-NULL clauses
    # to each ranking CTE.
    learnings_where = (
        "(metadata->>'type' IS NULL OR metadata->>'type' IN ("
        "'session_learning', 'WORKING_SOLUTION', 'ERROR_FIX', "
        "'ARCHITECTURAL_DECISION', 'CODEBASE_PATTERN', 'FAILED_APPROACH', "
        "'USER_PREFERENCE', 'OPEN_THREAD'))"
        " AND LENGTH(content) >= 50"
        " AND content NOT LIKE 'Agent ''%'' failed when given task:%'"
    )

    # Phase 1 (cross-project isolation): append project_id constraint to the
    # WHERE clause so it appears in BOTH ranking CTEs (FTS + vector). Param
    # indices for scope start at 5 (after text_query=1, embedding=2,
    # rrf_k=3, limit=4).
    scope_clause, scope_params, _ = _build_scope_clause(scope_mode, project_id, 5)
    if scope_clause:
        learnings_where = f"{learnings_where} AND {scope_clause}"

    async with pool.acquire() as conn:
        await init_pgvector(conn)

        # RRF query across all sessions for learnings, via shared builder.
        sql = build_rrf_sql(
            where_clause=learnings_where,
            text_query_param=1,
            embedding_param=2,
            rrf_k_param=3,
            limit_param=4,
            extra_select=["a.session_id", "c.fts_rank", "c.vec_rank"],
        )
        rows = await conn.fetch(
            sql,
            query,
            str(query_embedding),
            rrf_k,
            k * 2,  # Fetch more to allow filtering
            *scope_params,
        )

    results = []
    for row in rows:
        rrf_score = float(row["rrf_score"])

        if similarity_threshold > 0 and rrf_score < similarity_threshold:
            continue

        metadata = row["metadata"]
        if isinstance(metadata, str):
            metadata = json.loads(metadata)

        results.append({
            "id": str(row["id"]),
            "session_id": row["session_id"],
            "content": row["content"],
            "metadata": metadata,
            "created_at": row["created_at"],
            "similarity": rrf_score,  # Use RRF score as similarity for consistency
            "fts_rank": row["fts_rank"],
            "vec_rank": row["vec_rank"],
        })

        if len(results) >= k:
            break

    return results


async def search_learnings_postgres(
    query: str,
    k: int = 5,
    provider: str = "local",
    text_fallback: bool = True,
    similarity_threshold: float = 0.0,
    recency_weight: float = 0.0,
    project_id: str | None = None,
    scope_mode: str | None = None,
) -> list[dict[str, Any]]:
    """Search learnings using PostgreSQL (vector similarity or text fallback).

    Args:
        query: Search query for semantic matching
        k: Number of results to return
        provider: Embedding provider ("local" or "voyage")
        text_fallback: If True, use text search when no embeddings exist
        similarity_threshold: Minimum similarity score (0.0-1.0) to include results
        recency_weight: Weight for recency boost (0.0-1.0). 0=no boost, 0.3=30% recency
        project_id: Project hash (16-char sha256). Auto-derived when None.
        scope_mode: 'project' | 'global_only' | 'all'. Auto-resolved when None.

    Returns:
        List of matching learnings with similarity scores
    """
    from db.embedding_service import EmbeddingService
    from db.postgres_pool import get_pool

    # Auto-resolve scope when caller didn't pass it explicitly
    if scope_mode is None:
        project_id, scope_mode = resolve_recall_scope()

    pool = await get_pool()

    # First check if any learnings have embeddings *within the resolved scope*.
    # Phase B2: the COUNT must apply the same scope-mode WHERE clause that the
    # downstream SELECTs use; otherwise this branch sees global embeddings,
    # picks the vector path, then the scoped SELECT returns zero rows even
    # when text-fallback would have found matches in the current project.
    # That manifested as "vector triggers, returns nothing, but text path
    # would have hit" right after the Phase 1 scope filter landed.
    scope_clause, scope_params, _ = _build_scope_clause(scope_mode, project_id, 1)
    scope_sql = f" AND {scope_clause}" if scope_clause else ""
    async with pool.acquire() as conn:
        count_row = await conn.fetchrow(
            f"""
            SELECT COUNT(*) as cnt FROM archival_memory
            WHERE (metadata->>'type' IS NULL OR metadata->>'type' IN (
                'session_learning', 'WORKING_SOLUTION', 'ERROR_FIX',
                'ARCHITECTURAL_DECISION', 'CODEBASE_PATTERN', 'FAILED_APPROACH',
                'USER_PREFERENCE', 'OPEN_THREAD'))
                AND embedding IS NOT NULL
                {scope_sql}
            """,
            *scope_params,
        )
        has_embeddings = count_row["cnt"] > 0

    if has_embeddings:
        # Vector similarity search
        embedder = EmbeddingService(provider=provider)
        try:
            query_embedding = await embedder.embed(query)
        finally:
            await embedder.aclose()

        async with pool.acquire() as conn:
            from db.postgres_pool import init_pgvector
            await init_pgvector(conn)

            if recency_weight > 0:
                # Combined score: (1-recency_weight)*similarity + recency_weight*recency
                # Recency is normalized: 1.0 for newest, 0.0 for 30 days old or older
                # Scope params start at $4 (after embedding=$1, k=$2, recency=$3)
                scope_clause, scope_params, _ = _build_scope_clause(scope_mode, project_id, 4)
                scope_sql = f" AND {scope_clause}" if scope_clause else ""
                rows = await conn.fetch(
                    f"""
                    WITH scored AS (
                        SELECT
                            id,
                            session_id,
                            content,
                            metadata,
                            created_at,
                            1 - (embedding <=> $1::vector) as similarity,
                            GREATEST(0, 1.0 - EXTRACT(EPOCH FROM NOW() - created_at) / (30 * 86400)) as recency
                        FROM archival_memory
                        WHERE (metadata->>'type' IS NULL OR metadata->>'type' IN (
                            'session_learning', 'WORKING_SOLUTION', 'ERROR_FIX',
                            'ARCHITECTURAL_DECISION', 'CODEBASE_PATTERN', 'FAILED_APPROACH',
                            'USER_PREFERENCE', 'OPEN_THREAD'))
                            AND embedding IS NOT NULL
                            AND LENGTH(content) >= 50
                            AND content NOT LIKE 'Agent ''%'' failed when given task:%'
                            {scope_sql}
                    )
                    SELECT
                        id, session_id, content, metadata, created_at, similarity, recency,
                        (1.0 - $3::float) * similarity + $3::float * recency as combined_score
                    FROM scored
                    ORDER BY combined_score DESC
                    LIMIT $2
                    """,
                    str(query_embedding),
                    k,
                    recency_weight,
                    *scope_params,
                )
            else:
                # Scope params start at $3 (after embedding=$1, k=$2)
                scope_clause, scope_params, _ = _build_scope_clause(scope_mode, project_id, 3)
                scope_sql = f" AND {scope_clause}" if scope_clause else ""
                rows = await conn.fetch(
                    f"""
                    SELECT
                        id,
                        session_id,
                        content,
                        metadata,
                        created_at,
                        1 - (embedding <=> $1::vector) as similarity
                    FROM archival_memory
                    WHERE (metadata->>'type' IS NULL OR metadata->>'type' IN (
                        'session_learning', 'WORKING_SOLUTION', 'ERROR_FIX',
                        'ARCHITECTURAL_DECISION', 'CODEBASE_PATTERN', 'FAILED_APPROACH',
                        'USER_PREFERENCE', 'OPEN_THREAD'))
                        AND embedding IS NOT NULL
                        AND LENGTH(content) >= 50
                        AND content NOT LIKE 'Agent ''%'' failed when given task:%'
                        {scope_sql}
                    ORDER BY embedding <=> $1::vector
                    LIMIT $2
                    """,
                    str(query_embedding),
                    k,
                    *scope_params,
                )
    elif text_fallback:
        # Fallback to text search (ILIKE) when no embeddings
        # Scope params start at $3 (after query=$1, k=$2)
        scope_clause, scope_params, _ = _build_scope_clause(scope_mode, project_id, 3)
        scope_sql = f" AND {scope_clause}" if scope_clause else ""
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"""
                SELECT
                    id,
                    session_id,
                    content,
                    metadata,
                    created_at,
                    0.5 as similarity
                FROM archival_memory
                WHERE (metadata->>'type' IS NULL OR metadata->>'type' IN (
                    'session_learning', 'WORKING_SOLUTION', 'ERROR_FIX',
                    'ARCHITECTURAL_DECISION', 'CODEBASE_PATTERN', 'FAILED_APPROACH',
                    'USER_PREFERENCE', 'OPEN_THREAD'))
                    AND content ILIKE '%' || $1 || '%'
                    AND LENGTH(content) >= 50
                    AND content NOT LIKE 'Agent ''%'' failed when given task:%'
                    {scope_sql}
                ORDER BY created_at DESC
                LIMIT $2
                """,
                query,
                k,
                *scope_params,
            )
    else:
        return []

    results = []
    for row in rows:
        row_dict = dict(row)  # Convert Record to dict for easier access

        # Use combined_score if available (recency boost), otherwise similarity
        if "combined_score" in row_dict:
            score = float(row_dict["combined_score"]) if row_dict["combined_score"] else 0.0
        else:
            score = float(row_dict["similarity"]) if row_dict["similarity"] else 0.0

        # Skip results below threshold (only for vector search, not text fallback)
        if similarity_threshold > 0 and score < similarity_threshold:
            continue

        metadata = row_dict["metadata"]
        if isinstance(metadata, str):
            metadata = json.loads(metadata)

        result = {
            "id": str(row_dict["id"]),
            "session_id": row_dict["session_id"],
            "content": row_dict["content"],
            "metadata": metadata,
            "created_at": row_dict["created_at"],
            "similarity": score,
        }

        # Include raw similarity and recency if available
        if "recency" in row_dict:
            result["raw_similarity"] = float(row_dict["similarity"]) if row_dict["similarity"] else 0.0
            result["recency"] = float(row_dict["recency"]) if row_dict["recency"] else 0.0

        results.append(result)

    return results


async def search_learnings(
    query: str,
    k: int = 5,
    provider: str = "local",
    text_fallback: bool = True,
    similarity_threshold: float = 0.2,
    recency_weight: float = 0.0,
    project_id: str | None = None,
    scope_mode: str | None = None,
) -> list[dict[str, Any]]:
    """Search archival_memory for session learnings.

    Automatically selects SQLite (BM25) or PostgreSQL (vector) based on environment.

    Args:
        query: Search query for semantic matching
        k: Number of results to return
        provider: Embedding provider ("local" or "voyage") - PostgreSQL only
        text_fallback: If True, use text search when no embeddings exist
        similarity_threshold: Minimum similarity score (default 0.2 filters garbage)
        recency_weight: Weight for recency boost (0.0-1.0). 0=no boost, 0.3=30% recency
        project_id: Project hash (16-char sha256). Auto-derived when None.
        scope_mode: 'project' | 'global_only' | 'all'. Auto-resolved when None.

    Returns:
        List of matching learnings with similarity scores
    """
    if not query.strip():
        return []

    backend = get_backend()

    if backend == "sqlite":
        return await search_learnings_sqlite(query, k)
    else:
        return await search_learnings_postgres(
            query, k, provider, text_fallback,
            similarity_threshold, recency_weight,
            project_id=project_id, scope_mode=scope_mode,
        )


async def search_pageindex(query: str, k: int = 5, project_path: str | None = None) -> list[dict[str, Any]]:
    """Search PageIndex trees using LLM-based reasoning.

    Args:
        query: Search query
        k: Max results per document
        project_path: Optional project path (defaults to cwd)

    Returns:
        List of search results with document context
    """
    try:
        from scripts.pageindex.pageindex_service import PageIndexService
        from scripts.pageindex.tree_search import tree_search, SearchResult
    except ImportError as e:
        print(f"PageIndex not available: {e}", file=sys.stderr)
        return []

    project = project_path or os.getcwd()
    service = PageIndexService()

    try:
        trees = service.list_trees(project_path=project)
        if not trees:
            return []

        all_results = []
        for tree_meta in trees:
            tree_index = service.get_tree(project, tree_meta.doc_path)
            if not tree_index:
                continue

            search_results = tree_search(
                query=query,
                tree_structure=tree_index.tree_structure,
                doc_name=tree_meta.doc_path,
                max_results=k,
                model="sonnet"
            )

            for result in search_results:
                all_results.append({
                    "source": "pageindex",
                    "doc_path": tree_meta.doc_path,
                    "node_id": result.node_id,
                    "title": result.title,
                    "content": result.text,
                    "line_num": result.line_num,
                    "relevance_reason": result.relevance_reason,
                    "similarity": result.confidence,
                    "session_id": f"pageindex:{tree_meta.doc_path}",
                    "created_at": tree_index.updated_at,
                })

        all_results.sort(key=lambda x: x["similarity"], reverse=True)
        return all_results[:k * 2]

    finally:
        service.close()


async def main() -> int:
    """Run semantic recall on session learnings."""
    parser = argparse.ArgumentParser(
        description="Semantic recall of session learnings from archival_memory",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--query",
        "-q",
        required=True,
        help="Search query for semantic matching",
    )
    parser.add_argument(
        "--k",
        type=int,
        default=5,
        help="Number of results to return (default: 5)",
    )
    parser.add_argument(
        "--provider",
        choices=["local", "voyage"],
        default="local",
        help="Embedding provider (default: local)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON (for programmatic use)",
    )
    parser.add_argument(
        "--text-only",
        action="store_true",
        help="Use text search only (faster, no embeddings)",
    )
    parser.add_argument(
        "--threshold",
        "-t",
        type=float,
        default=0.2,
        help="Minimum similarity threshold (default: 0.2, filters low-quality results)",
    )
    parser.add_argument(
        "--vector-only",
        action="store_true",
        help="Use vector-only search (disables hybrid RRF, enables recency)",
    )
    parser.add_argument(
        "--recency",
        "-r",
        type=float,
        default=0.1,
        help="Recency weight for vector-only mode (0.0-1.0, default: 0.1)",
    )
    parser.add_argument(
        "--pageindex",
        action="store_true",
        help="Use PageIndex tree-based search for large documents (ROADMAP, docs)",
    )
    parser.add_argument(
        "--hybrid",
        action="store_true",
        help="Search both vector memory AND PageIndex trees",
    )
    parser.add_argument(
        "--project-dir",
        default=None,
        help=(
            "Project directory to scope recall to. When passed, derive "
            "project_id = sha256(abs_path)[:16] and filter PROJECT-scoped "
            "results to that project. Defaults to CWD when CWD is inside a "
            "registered project; falls back to GLOBAL-only otherwise."
        ),
    )
    parser.add_argument(
        "--all-projects",
        action="store_true",
        help=(
            "DEBUG/AUDIT: drop the project_id filter entirely. By default, "
            "recall is scoped to the current project (or GLOBAL-only when "
            "context is unclear). Use this opt-out only when you need to "
            "see learnings across projects."
        ),
    )

    args = parser.parse_args()

    # Phase 1 (cross-project isolation): resolve scope once, pass to all paths.
    project_id, scope_mode = resolve_recall_scope(
        project_dir=args.project_dir,
        all_projects=args.all_projects,
    )

    # JSON mode: suppress human-readable output
    backend = get_backend()

    if not args.json:
        print(f'Recalling learnings for: "{args.query}"')
        if args.pageindex:
            print("Search mode: PageIndex (tree-based)")
        elif args.hybrid:
            print(f"Search mode: Hybrid (vector + PageIndex)")
            print(f"Backend: {backend}")
        else:
            print(f"Backend: {backend}")
            print(f"Embedding provider: {args.provider}")
        print()

    try:
        # Phase B2: thread --project-dir through to PageIndex so its tree
        # discovery uses the caller's project rather than os.getcwd(). When
        # recall is invoked from inside one project but with --project-dir
        # pointed elsewhere (or from a hook running in a non-project CWD),
        # the previous default silently searched whatever PageIndex trees
        # happened to live next to the working directory.
        # PageIndex-only search
        if args.pageindex:
            results = await search_pageindex(
                args.query, args.k, project_path=args.project_dir
            )
        # Hybrid search: combine vector memory + PageIndex
        elif args.hybrid:
            vector_results = []
            pageindex_results = await search_pageindex(
                args.query, args.k, project_path=args.project_dir
            )

            if backend == "sqlite":
                vector_results = await search_learnings_sqlite(args.query, args.k)
            elif args.text_only:
                vector_results = await search_learnings_text_only_postgres(
                    args.query, args.k,
                    project_id=project_id, scope_mode=scope_mode,
                )
            else:
                vector_results = await search_learnings_hybrid_rrf(
                    query=args.query,
                    k=args.k,
                    provider=args.provider,
                    similarity_threshold=args.threshold * 0.01,
                    project_id=project_id, scope_mode=scope_mode,
                )

            for r in vector_results:
                r["source"] = "vector"
            for r in pageindex_results:
                r["source"] = "pageindex"

            results = vector_results + pageindex_results
            results.sort(key=lambda x: x.get("similarity", 0), reverse=True)
            results = results[:args.k * 2]

        elif backend == "sqlite":
            # SQLite only supports text search (no pgvector)
            if not args.text_only and not args.json:
                print("  (SQLite backend - using text search)")
            results = await search_learnings_sqlite(args.query, args.k)
        elif args.text_only:
            # Fast text-only search (no embeddings)
            results = await search_learnings_text_only_postgres(
                args.query, args.k,
                project_id=project_id, scope_mode=scope_mode,
            )
        elif args.vector_only:
            # Vector-only search with recency boost
            results = await search_learnings(
                query=args.query,
                k=args.k,
                provider=args.provider,
                similarity_threshold=args.threshold,
                recency_weight=args.recency,
                project_id=project_id, scope_mode=scope_mode,
            )
        else:
            # Default: Hybrid RRF search (text + vector combined)
            results = await search_learnings_hybrid_rrf(
                query=args.query,
                k=args.k,
                provider=args.provider,
                similarity_threshold=args.threshold * 0.01,  # RRF scores are ~0.01-0.03 range
                project_id=project_id, scope_mode=scope_mode,
            )
    except Exception as e:
        if args.json:
            print(json.dumps({"error": str(e), "results": []}))
        else:
            print(f"Error: {e}", file=sys.stderr)
        return 1

    # JSON output mode
    if args.json:
        json_results = []
        for result in results:
            created_at = result["created_at"]
            if isinstance(created_at, datetime):
                created_str = created_at.isoformat()
            else:
                created_str = str(created_at)

            json_results.append({
                "score": result["similarity"],
                "session_id": result["session_id"],
                "content": result["content"],
                "created_at": created_str,
            })
        print(json.dumps({"results": json_results}))
        return 0

    # Human-readable output
    if not results:
        print("No matching learnings found.")
        return 0

    print(f"Found {len(results)} matching learnings:")
    print()

    for i, result in enumerate(results, 1):
        similarity = result["similarity"]
        content_preview = format_result_preview(result["content"], max_length=300)
        session_id = result["session_id"]
        created_at = result["created_at"]

        # Format timestamp
        if isinstance(created_at, datetime):
            created_str = created_at.strftime("%Y-%m-%d %H:%M")
        else:
            created_str = str(created_at)[:16]

        source = result.get("source", "vector")
        if source == "pageindex":
            doc_path = result.get("doc_path", "unknown")
            title = result.get("title", "")
            line_num = result.get("line_num")
            reason = result.get("relevance_reason", "")
            loc = f":{line_num}" if line_num else ""
            print(f"{i}. [{similarity:.0%}] 📄 {doc_path}{loc}")
            print(f"   Section: {title}")
            if reason:
                print(f"   Why: {reason}")
            print(f"   {content_preview}")
        else:
            print(f"{i}. [{similarity:.3f}] Session: {session_id} ({created_str})")
            print(f"   {content_preview}")
        print()

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
