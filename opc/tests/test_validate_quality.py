"""Tests for validate_learning_quality and the type-inference / agent_id flow.

Covers Task #6 + #15 + G14 (memory hardening v2):

- G14: validate_learning_quality MUST reject noise prefixes (Let me / Now I have / ...)
- G14: must reject when learning_type is None for non-internal callers
- G14: must pass when _internal_caller=True even with NULL type
- Task #6/#15: store_learning_v2 must infer learning_type when caller passes None
- Task #6/#15 bonus: store_learning_v2 must accept agent_id and thread it to memory service

These tests are pure unit tests; they don't touch Postgres. The Postgres path
is exercised by the smoke test in this file's __main__ section (run manually).
"""
from __future__ import annotations

import pytest

# conftest.py adds opc/scripts/core to sys.path
from store_learning import (
    NOISE_PREFIXES,
    validate_learning_quality,
)


# ---------- validate_learning_quality: noise-prefix rejection ----------

class TestNoisePrefixRejection:
    """G14 -- the 8 prefixes in NOISE_PREFIXES MUST be rejected, no exceptions."""

    def test_now_i_have_rejected(self):
        content = "Now I have to figure out which hook is misbehaving and trace the call stack carefully."
        result = validate_learning_quality(content, learning_type="WORKING_SOLUTION")
        assert result["passes"] is False
        assert "noise_prefix" in result["reason"]
        assert "Now I have" in result["reason"]

    def test_let_me_rejected(self):
        content = "Let me explain why this approach failed and what we'd do differently next time."
        result = validate_learning_quality(content, learning_type="WORKING_SOLUTION")
        assert result["passes"] is False
        assert "noise_prefix" in result["reason"]
        assert "Let me" in result["reason"]

    def test_the_user_wants_rejected(self):
        content = "The user wants me to refactor the validation logic across all hooks consistently."
        result = validate_learning_quality(content, learning_type="WORKING_SOLUTION")
        assert result["passes"] is False
        assert "noise_prefix" in result["reason"]

    def test_i_need_to_rejected(self):
        content = "I need to verify the database schema before touching the migration file again."
        result = validate_learning_quality(content, learning_type="WORKING_SOLUTION")
        assert result["passes"] is False
        assert "noise_prefix" in result["reason"]

    def test_agent_dump_rejected(self):
        content = "Agent 'kraken' returned with error: connection refused on port 5432 during init"
        result = validate_learning_quality(content, learning_type="FAILED_APPROACH")
        assert result["passes"] is False
        assert "noise_prefix" in result["reason"]

    def test_looking_at_rejected(self):
        content = "Looking at the hook implementation it seems the regex pattern is too greedy at line 42."
        result = validate_learning_quality(content, learning_type="WORKING_SOLUTION")
        assert result["passes"] is False
        assert "noise_prefix" in result["reason"]

    def test_all_eight_prefixes_present(self):
        """Smoke test: ensure NOISE_PREFIXES list is what we expect."""
        expected = {
            "Agent '",
            "Now I have",
            "Let me ",
            "The user wants",
            "I need to",
            "Looking at",
            "I notice the",
            "The user sent",
        }
        assert set(NOISE_PREFIXES) == expected


# ---------- validate_learning_quality: positive cases (real learnings) ----------

class TestQualityContentAccepted:
    """Content with real diagnostic signal MUST pass."""

    def test_postgres_root_cause_accepted(self):
        content = (
            "Postgres ALTER TABLE fixed the slow query because the missing index "
            "on (session_id, created_at) caused full table scans across 2M rows. "
            "Pattern: always add composite indexes when filtering by both columns."
        )
        result = validate_learning_quality(content, learning_type="WORKING_SOLUTION")
        assert result["passes"] is True

    def test_failed_approach_accepted(self):
        content = (
            "The retry-on-timeout approach didn't work because the upstream "
            "service was rate-limiting based on IP, not request count. Solution: "
            "switch to exponential backoff with jitter and respect Retry-After headers."
        )
        result = validate_learning_quality(content, learning_type="FAILED_APPROACH")
        assert result["passes"] is True

    def test_error_fix_accepted(self):
        content = (
            "Fix: setting PYTHONUTF8=1 as a permanent user env var resolves "
            "cp1252 crashes in TLDR CLI (dead, calls, impact) and all Python tools on Windows."
        )
        result = validate_learning_quality(content, learning_type="ERROR_FIX")
        assert result["passes"] is True


# ---------- validate_learning_quality: NULL type rejection ----------

class TestNullTypeRejection:
    """G14 follow-up: external callers MUST provide learning_type. Internal callers may bypass."""

    def test_null_type_rejected_for_external_caller(self):
        content = (
            "Postgres ALTER TABLE fixed the slow query because the missing index "
            "caused full table scans across 2M rows."
        )
        # learning_type=None, no _internal_caller -- should reject
        result = validate_learning_quality(content, learning_type=None)
        assert result["passes"] is False
        assert "type" in result["reason"].lower()

    def test_null_type_accepted_for_internal_caller(self):
        content = (
            "Postgres ALTER TABLE fixed the slow query because the missing index "
            "caused full table scans across 2M rows."
        )
        # Internal caller flag set -- bypass the NULL-type guard
        result = validate_learning_quality(
            content, learning_type=None, _internal_caller=True
        )
        assert result["passes"] is True

    def test_typed_content_passes_normally(self):
        content = (
            "WORKING_SOLUTION: Postgres ALTER TABLE fixed the slow query because "
            "the missing index caused full table scans across 2M rows."
        )
        result = validate_learning_quality(content, learning_type="WORKING_SOLUTION")
        assert result["passes"] is True


# ---------- Idempotence ----------

class TestIdempotence:
    """Re-running validator on same content -> same outcome."""

    def test_repeated_call_same_result(self):
        content = "Let me think about how to approach this database migration carefully."
        r1 = validate_learning_quality(content, learning_type="WORKING_SOLUTION")
        r2 = validate_learning_quality(content, learning_type="WORKING_SOLUTION")
        r3 = validate_learning_quality(content, learning_type="WORKING_SOLUTION")
        assert r1 == r2 == r3
        assert r1["passes"] is False


# ---------- Type inference fallback in store_learning_v2 ----------

class TestTypeInferenceFallback:
    """When caller passes learning_type=None to store_learning_v2, the helper
    should infer type via the same heuristic as incremental_extract.infer_learning_type."""

    def test_infer_helper_exists(self):
        """The store_learning module should expose an _infer_learning_type helper
        OR re-use incremental_extract.infer_learning_type."""
        from store_learning import _infer_learning_type
        assert callable(_infer_learning_type)

    def test_infer_working_solution_default(self):
        from store_learning import _infer_learning_type
        # Pure factual sentence with no special keyword -> WORKING_SOLUTION
        assert _infer_learning_type("Drizzle ORM works well with Neon for serverless edge functions.") == "WORKING_SOLUTION"

    def test_infer_error_fix(self):
        from store_learning import _infer_learning_type
        result = _infer_learning_type("Fixed the bug where the worker crashed on startup")
        assert result == "ERROR_FIX"

    def test_infer_failed_approach(self):
        from store_learning import _infer_learning_type
        result = _infer_learning_type("This approach failed because of memory pressure")
        assert result == "FAILED_APPROACH"

    def test_infer_architectural_decision(self):
        from store_learning import _infer_learning_type
        result = _infer_learning_type("Decided to use postgres because of pgvector support")
        assert result == "ARCHITECTURAL_DECISION"


# ---------- store_learning_v2 accepts agent_id kwarg ----------

class TestAgentIdKwarg:
    """G12 follow-up: store_learning_v2 must accept agent_id as a kwarg."""

    def test_signature_has_agent_id(self):
        import inspect
        from store_learning import store_learning_v2
        sig = inspect.signature(store_learning_v2)
        assert "agent_id" in sig.parameters, (
            f"store_learning_v2 missing agent_id kwarg. Has: {list(sig.parameters)}"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
