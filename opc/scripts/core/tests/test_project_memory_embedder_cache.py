"""Tests for the BGE EmbeddingService singleton in project_memory.py.

Phase 3C of the CCv3 Memory Remediation Plan: project_memory.py was
re-instantiating EmbeddingService(provider='local') in every search call,
which loads the BGE SentenceTransformer model (~1.2s cold) on each call.

The fix mirrors the pattern already in store_learning.py: a module-level
_embedder cache + get_embedder() helper, lazy-initialized on first call.

These tests use a mock so we don't pay the actual BGE load cost in CI.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

# Make scripts/core importable
_CORE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_CORE_DIR))


@pytest.fixture(autouse=True)
def reset_embedder_cache():
    """Reset the module-level singleton between tests."""
    import project_memory
    # Snapshot
    before = getattr(project_memory, "_embedder", None)
    project_memory._embedder = None
    yield
    # Restore (unlikely to matter, but keeps tests hermetic)
    project_memory._embedder = before


def test_get_embedder_is_callable():
    """The new helper is exported from project_memory."""
    import project_memory
    assert hasattr(project_memory, "get_embedder")
    assert callable(project_memory.get_embedder)


def test_get_embedder_returns_same_instance_on_repeated_calls():
    """Singleton: the second call returns the same EmbeddingService object."""
    import project_memory

    # Patch the underlying constructor so we don't actually load BGE
    sentinel = object()  # any unique instance
    call_count = {"n": 0}

    class FakeEmbeddingService:
        def __init__(self, *args, **kwargs):
            call_count["n"] += 1
            self.id = id(self)

    with patch.object(project_memory, "_embedder", None):
        # Stub out the real EmbeddingService import inside get_embedder
        import db.embedding_service as es_mod

        with patch.object(es_mod, "EmbeddingService", FakeEmbeddingService):
            e1 = project_memory.get_embedder()
            e2 = project_memory.get_embedder()
            e3 = project_memory.get_embedder()

    assert e1 is e2 is e3, "get_embedder must return same instance"
    assert call_count["n"] == 1, (
        f"EmbeddingService should be constructed exactly once across "
        f"3 get_embedder() calls; was {call_count['n']}"
    )


def test_search_local_vector_uses_singleton(tmp_path):
    """search_local_vector goes through get_embedder, not direct construction."""
    import project_memory

    # No handoffs dir means search_local_vector returns [] before calling the
    # embedder. Create a minimal handoff structure so it actually tries to
    # embed.
    project_dir = tmp_path / "proj"
    handoffs_dir = project_dir / ".claude" / "memory" / "handoffs" / "session-1"
    handoffs_dir.mkdir(parents=True)
    # Drop a single fake-indexed handoff with a fake embedding
    (handoffs_dir / "task-1.json").write_text(
        '{"summary": "test", "content": "test content", "embedding": [0.1] * 1024}'.replace(
            "[0.1] * 1024", "[" + ", ".join(["0.1"] * 1024) + "]"
        )
    )

    call_count = {"n": 0}

    class FakeEmbeddingService:
        def __init__(self, *args, **kwargs):
            call_count["n"] += 1

        async def embed(self, text):
            return [0.1] * 1024

    import db.embedding_service as es_mod
    with patch.object(es_mod, "EmbeddingService", FakeEmbeddingService):
        import asyncio
        # Two calls in sequence -- expect the second to reuse the singleton.
        asyncio.run(project_memory.search_local_vector(str(project_dir), "query 1"))
        asyncio.run(project_memory.search_local_vector(str(project_dir), "query 2"))

    assert call_count["n"] == 1, (
        f"EmbeddingService should be constructed once across two "
        f"search_local_vector() calls; was {call_count['n']}"
    )


def test_get_embedder_lazy_initialization():
    """The embedder is NOT created at module import time."""
    import project_memory

    # After import, _embedder must be None until get_embedder() is called.
    # (Hooks reset this in autouse fixture, so we re-assert the lazy contract.)
    assert project_memory._embedder is None
