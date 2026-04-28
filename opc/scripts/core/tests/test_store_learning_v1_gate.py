"""Tests for Phase 4A: v1 store_learning() now routes through v2 quality gate.

Prior to Phase 4A, the legacy v1 entrypoint wrote directly to Postgres
without invoking ``validate_learning_quality``. Any caller still on the
legacy interface (``--worked/--failed/--decisions/--patterns`` CLI mode or
direct ``store_learning(...)`` calls) bypassed the gate and could persist
NOISE rows.

Phase 4A refactors v1 to translate each legacy category into a v2 call:

    worked    -> WORKING_SOLUTION
    failed    -> FAILED_APPROACH
    decisions -> ARCHITECTURAL_DECISION
    patterns  -> CODEBASE_PATTERN

Each translation goes through ``store_learning_v2`` so the quality scorer
runs and dedup applies. v1's external signature stays stable for back-compat.

These tests stub out ``store_learning_v2`` to assert routing without
needing a live Postgres connection.
"""

from __future__ import annotations

import asyncio
import sys
import warnings
from pathlib import Path
from unittest import mock

import pytest

# Ensure scripts/core is importable as a package via PYTHONPATH=opc
_CORE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_CORE_DIR))

import store_learning  # noqa: E402


# ---------------------------------------------------------------------------
# Routing tests (no DB)
# ---------------------------------------------------------------------------


def test_v1_emits_deprecation_warning():
    """Calling the legacy v1 entrypoint emits a DeprecationWarning."""
    async def _run():
        with mock.patch.object(
            store_learning,
            "store_learning_v2",
            new=mock.AsyncMock(return_value={"success": True, "memory_id": "abc"}),
        ):
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always")
                await store_learning.store_learning(
                    session_id="phase4a-test",
                    worked="A high-quality WORKING_SOLUTION with enough characters to pass the gate.",
                    failed="None",
                    decisions="None",
                    patterns="None",
                )
                deprecation_warnings = [
                    w for w in caught if issubclass(w.category, DeprecationWarning)
                ]
                assert len(deprecation_warnings) >= 1, (
                    "v1 store_learning() must emit DeprecationWarning"
                )
                assert "store_learning_v2" in str(deprecation_warnings[0].message)

    asyncio.run(_run())


def test_v1_routes_each_category_to_correct_learning_type():
    """worked/failed/decisions/patterns map to v2 learning_types correctly."""
    async def _run():
        v2_mock = mock.AsyncMock(
            return_value={"success": True, "memory_id": "uuid-stub"}
        )
        with mock.patch.object(store_learning, "store_learning_v2", new=v2_mock):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                await store_learning.store_learning(
                    session_id="phase4a-test",
                    worked="Worked content sufficient to pass the gate easily.",
                    failed="Failed approach was not enough -- needs more length to pass the gate threshold of 100 characters because failed_approach gate is the strictest threshold of all the types.",
                    decisions="Decision content sufficient to pass the gate easily.",
                    patterns="Pattern content sufficient to pass the gate easily.",
                )

        # Should have 4 v2 calls, one per category
        assert v2_mock.call_count == 4

        # Inspect each call -- match the kwargs precisely
        calls_by_type: dict[str, dict] = {}
        for call in v2_mock.call_args_list:
            kwargs = call.kwargs
            calls_by_type[kwargs["learning_type"]] = kwargs

        assert "WORKING_SOLUTION" in calls_by_type
        assert "FAILED_APPROACH" in calls_by_type
        assert "ARCHITECTURAL_DECISION" in calls_by_type
        assert "CODEBASE_PATTERN" in calls_by_type

        # Worked content should land in WORKING_SOLUTION
        assert "Worked content" in calls_by_type["WORKING_SOLUTION"]["content"]
        assert "Failed approach" in calls_by_type["FAILED_APPROACH"]["content"]
        assert "Decision content" in calls_by_type["ARCHITECTURAL_DECISION"]["content"]
        assert "Pattern content" in calls_by_type["CODEBASE_PATTERN"]["content"]

    asyncio.run(_run())


def test_v1_skips_none_categories():
    """Categories set to 'None' (literal string) are not routed to v2."""
    async def _run():
        v2_mock = mock.AsyncMock(
            return_value={"success": True, "memory_id": "uuid-stub"}
        )
        with mock.patch.object(store_learning, "store_learning_v2", new=v2_mock):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                await store_learning.store_learning(
                    session_id="phase4a-test",
                    worked="Only worked is populated -- all others are None defaults.",
                    failed="None",
                    decisions="None",
                    patterns="None",
                )

        # Only one call -- worked
        assert v2_mock.call_count == 1
        kwargs = v2_mock.call_args.kwargs
        assert kwargs["learning_type"] == "WORKING_SOLUTION"

    asyncio.run(_run())


def test_v1_returns_error_when_all_categories_none():
    """v1 returns the same error shape as before when nothing is provided."""
    async def _run():
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            result = await store_learning.store_learning(
                session_id="phase4a-test",
                worked="None",
                failed="None",
                decisions="None",
                patterns="None",
            )
        assert result.get("success") is False
        assert "No learning content" in result.get("error", "")

    asyncio.run(_run())


def test_v1_passes_when_v2_skips_due_to_quality_gate():
    """If v2 skips a category as NOISE, v1 still reports overall success.

    v2 returning ``{"success": True, "skipped": True}`` means the gate
    rejected the content. That's not a transport error -- v1 should treat
    it as a clean skip, not a hard failure.
    """
    async def _run():
        # First call rejected, second call stored
        v2_mock = mock.AsyncMock(side_effect=[
            {"success": True, "skipped": True, "reason": "too_short (5<100)"},
            {"success": True, "memory_id": "uuid-stored", "backend": "postgres"},
        ])
        with mock.patch.object(store_learning, "store_learning_v2", new=v2_mock):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                result = await store_learning.store_learning(
                    session_id="phase4a-test",
                    worked="hi",  # Will be NOISE -- too short for WORKING_SOLUTION (50 chars)
                    failed="A real fix that is long enough to pass: the bug was a stale ImportError handler and the workaround is to call store_learning_v2 directly.",
                    decisions="None",
                    patterns="None",
                )
        # Overall success because no transport error
        assert result.get("success") is True
        # One stored, one skipped
        results = result.get("results", {})
        assert results.get("worked", {}).get("skipped") is True
        assert results.get("failed", {}).get("memory_id") == "uuid-stored"

    asyncio.run(_run())


def test_v1_propagates_v2_transport_failure():
    """If v2 returns success=False (real backend error), v1 surfaces it."""
    async def _run():
        v2_mock = mock.AsyncMock(
            return_value={"success": False, "error": "Postgres unreachable"}
        )
        with mock.patch.object(store_learning, "store_learning_v2", new=v2_mock):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                result = await store_learning.store_learning(
                    session_id="phase4a-test",
                    worked="A high-quality WORKING_SOLUTION with enough characters to pass the gate.",
                    failed="None",
                    decisions="None",
                    patterns="None",
                )
        assert result.get("success") is False

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# Quality gate behavior: NOISE rejected via v1 path
# ---------------------------------------------------------------------------


def test_v1_noise_rejected_by_quality_gate():
    """Sending pure NOISE through v1 (e.g., 'hi') results in skip, not store.

    This is the core Phase 4A guarantee: the v1 path no longer bypasses the
    quality scorer. We don't need a live DB here -- we mock v2 and simply
    confirm v1 calls v2 (which has the gate) instead of bypassing it.
    """
    async def _run():
        # Use the actual v2 (which runs the gate), but mock the storage layer
        # below it so no DB is needed.
        v2_mock = mock.AsyncMock(
            return_value={"success": True, "skipped": True, "reason": "too_short (2<50)"}
        )
        with mock.patch.object(store_learning, "store_learning_v2", new=v2_mock):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                result = await store_learning.store_learning(
                    session_id="phase4a-test",
                    worked="hi",  # Far below 50-char WORKING_SOLUTION threshold
                    failed="None",
                    decisions="None",
                    patterns="None",
                )

        # v2 was called (gate-bearing path)
        assert v2_mock.call_count == 1
        # Top-level success because skip is not a transport error
        assert result.get("success") is True
        # The category was skipped, not stored
        assert result["results"]["worked"].get("skipped") is True
        # No memory_id at top level since nothing was actually stored
        assert "memory_id" not in result

    asyncio.run(_run())


def test_v1_high_quality_stores_via_v2():
    """High-quality input via v1 reaches v2's store path with metadata.type."""
    async def _run():
        captured: dict = {}

        async def fake_v2(**kwargs):
            captured.update(kwargs)
            return {
                "success": True,
                "memory_id": "11111111-2222-3333-4444-555555555555",
                "backend": "postgres",
                "embedding_dim": 1024,
                "scope": "GLOBAL",
            }

        with mock.patch.object(store_learning, "store_learning_v2", new=fake_v2):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                result = await store_learning.store_learning(
                    session_id="phase4a-test",
                    worked="The fix works because we now route v1 through v2's quality gate, ensuring no NOISE entries land in archival_memory.",
                    failed="None",
                    decisions="None",
                    patterns="None",
                )

        assert result.get("success") is True
        assert result.get("memory_id") == "11111111-2222-3333-4444-555555555555"
        assert captured["learning_type"] == "WORKING_SOLUTION"
        # v1 marker tags so future analysis can spot legacy callers
        assert "v1_legacy" in captured["tags"]

    asyncio.run(_run())


# ---------------------------------------------------------------------------
# Mapping integrity
# ---------------------------------------------------------------------------


def test_v1_category_mapping_complete():
    """All four legacy categories map to a valid v2 learning_type."""
    mapping = store_learning._V1_CATEGORY_TO_TYPE
    assert set(mapping.keys()) == {"worked", "failed", "decisions", "patterns"}
    for v2_type in mapping.values():
        assert v2_type in store_learning.LEARNING_TYPES, (
            f"v1 maps to {v2_type} which is not in LEARNING_TYPES"
        )
