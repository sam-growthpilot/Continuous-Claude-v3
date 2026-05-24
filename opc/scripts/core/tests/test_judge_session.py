"""Tests for Gate C: Phase 3b autoevals judge runner.

These tests stub out the autoevals clients and the feedback HTTP POST,
so no real LLM calls and no real Braintrust traffic occurs.

Coverage (from spec):
- Env preflight fails fast when OPENAI_API_KEY is missing
- Deterministic sampling (same session_id -> same in/out)
- ~35% sample rate across random IDs (statistical tolerance)
- Exactly 3 feedback POSTs per sampled session
- 0 POSTs when session is out of sample
- --max-sessions caps batch size
- --dry-run produces 0 LLM calls and 0 feedback POSTs
- Idempotency: re-run produces same deterministic feedback IDs
- ClosedQA skip with reason 'nested_subagent_no_correlation' for nested Task spans
"""

from __future__ import annotations

import hashlib
import os
import random
import sys
from pathlib import Path
from unittest import mock

import pytest

# Ensure scripts/core is importable
_CORE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_CORE_DIR))


# ---------------------------------------------------------------------------
# Fixture: minimal session trace with all three artifacts
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_session_trace():
    """A session trace dict with recall, top-level Task, and plan artifacts."""
    return {
        "session_id": "sess-fixture-001",
        "user_prompt": "How do I add a new hook to the Claude Code system?",
        "top_recall_chunk": (
            "Hooks live in .claude/hooks/src/*.ts and are compiled by esbuild "
            "to dist/*.mjs. Register them in ~/.claude/settings.json via Node "
            "atomic write."
        ),
        "task_spans": [
            {
                "span_id": "task-1",
                "parent_span_id": "root-1",  # parent is root, NOT another Task
                "tool_name": "Task",
                "task_request": "Find all hook source files and list their names.",
                "agent_output": (
                    "Found 47 hook source files under .claude/hooks/src/, including "
                    "memory-awareness.ts, telemetry-tracker.ts, plan-exit-tracker.ts."
                ),
            }
        ],
        "plan_body": (
            "1. Add new hook scaffold at .claude/hooks/src/new-hook.ts.\n"
            "2. Implement handler logic.\n"
            "3. Build with `npm run build`.\n"
            "4. Register in settings.json.\n"
            "5. Test with vitest.\n"
            "Verification: run `npm test` and confirm hook fires on a test input."
        ),
    }


@pytest.fixture
def nested_task_session_trace():
    """A session trace where Task span is nested inside another Task."""
    return {
        "session_id": "sess-nested-002",
        "user_prompt": "Tell me about the codebase.",
        "top_recall_chunk": "Some recall result.",
        "task_spans": [
            {
                "span_id": "task-outer",
                "parent_span_id": "root-1",
                "tool_name": "Task",
                "task_request": "Outer task: explore repo.",
                "agent_output": "Repo has 47 hooks.",
            },
            {
                "span_id": "task-inner",
                "parent_span_id": "task-outer",  # nested!
                "tool_name": "Task",
                "task_request": "Inner task: list hook names.",
                "agent_output": "memory-awareness.ts, ...",
            },
        ],
        "plan_body": "Step 1. Do stuff.",
    }


# ---------------------------------------------------------------------------
# Helper to import the module fresh and provide all common mocks
# ---------------------------------------------------------------------------


def _import_judge_session():
    """Import the judge_session module fresh, isolated from prior imports."""
    if "judge_session" in sys.modules:
        del sys.modules["judge_session"]
    import judge_session  # noqa: E402
    return judge_session


# ---------------------------------------------------------------------------
# T1: env preflight
# ---------------------------------------------------------------------------


def test_env_preflight_fails_fast_when_openai_api_key_missing(monkeypatch):
    """Missing OPENAI_API_KEY -> sys.exit with explicit message (T1 mitigation)."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    js = _import_judge_session()
    with pytest.raises(SystemExit) as excinfo:
        js.check_env_preflight()
    assert excinfo.value.code != 0
    # Check that some explanatory text was printed to stderr
    # (the exact wording is verified by the spec; we just confirm non-zero exit)


def test_env_preflight_passes_when_openai_api_key_set(monkeypatch):
    """OPENAI_API_KEY present -> preflight returns without raising."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fixture")
    js = _import_judge_session()
    js.check_env_preflight()  # should not raise


# ---------------------------------------------------------------------------
# Deterministic sampling
# ---------------------------------------------------------------------------


def test_sampling_is_deterministic_per_session_id():
    """Same session_id always yields the same in/out decision."""
    js = _import_judge_session()
    sid = "deterministic-test-session-abc"
    decisions = {js.is_sampled(sid) for _ in range(50)}
    assert len(decisions) == 1, "Same session_id must produce deterministic sample decision"


def test_sampling_rate_approximates_35_percent():
    """Across many random IDs, ~35% should land in the sample (+/- 3%)."""
    js = _import_judge_session()
    rng = random.Random(42)  # reproducible
    in_count = 0
    n = 1000
    for _ in range(n):
        sid = f"sid-{rng.randint(0, 10_000_000)}-{rng.randint(0, 10_000_000)}"
        if js.is_sampled(sid):
            in_count += 1
    rate = in_count / n
    assert 0.32 <= rate <= 0.38, f"Expected ~35% sample rate, got {rate:.3f}"


# ---------------------------------------------------------------------------
# Feedback ID determinism (T5 idempotency)
# ---------------------------------------------------------------------------


def test_feedback_id_is_deterministic_sha256():
    """make_feedback_id(session_id, judge_name) is sha256 first 16 hex chars."""
    js = _import_judge_session()
    sid = "fixed-session-x"
    judge = "factuality"
    fid1 = js.make_feedback_id(sid, judge)
    fid2 = js.make_feedback_id(sid, judge)
    assert fid1 == fid2
    expected = hashlib.sha256(f"{sid}:{judge}".encode()).hexdigest()[:16]
    assert fid1 == expected
    # Different judge -> different id
    assert js.make_feedback_id(sid, "closedqa") != fid1


# ---------------------------------------------------------------------------
# Exactly 3 POSTs for sampled session, 0 for out-of-sample
# ---------------------------------------------------------------------------


def _setup_run_mocks(monkeypatch, js, force_in_sample: bool = True):
    """Common mock setup: env, autoevals judges, and the HTTP POST."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fixture")
    monkeypatch.setenv("BRAINTRUST_API_KEY", "bt-test-fixture")
    monkeypatch.setenv("BRAINTRUST_CC_PROJECT_ID", "test-project-id")
    monkeypatch.setenv("TRACE_TO_BRAINTRUST", "true")

    # Force sampling decision
    monkeypatch.setattr(js, "is_sampled", lambda _sid: force_in_sample)

    # Mock the three judge invocations
    fake_score = mock.MagicMock()
    fake_score.score = 1.0
    fake_score.metadata = {"rationale": "test"}

    monkeypatch.setattr(js, "_run_factuality", lambda **kw: fake_score)
    monkeypatch.setattr(js, "_run_closedqa", lambda **kw: fake_score)
    monkeypatch.setattr(js, "_run_battle_or_classifier", lambda **kw: fake_score)

    # Capture POSTs
    posts: list = []

    def fake_post(url, json=None, headers=None, timeout=None):
        posts.append({"url": url, "json": json, "headers": headers})
        resp = mock.MagicMock()
        resp.status_code = 200
        return resp

    monkeypatch.setattr(js.requests, "post", fake_post)
    return posts


def test_sampled_session_produces_exactly_three_posts(monkeypatch, sample_session_trace):
    js = _import_judge_session()
    posts = _setup_run_mocks(monkeypatch, js, force_in_sample=True)

    result = js.judge_session(sample_session_trace, dry_run=False)

    assert len(posts) == 3, f"Expected 3 feedback POSTs, got {len(posts)}"
    # All three POSTs should target /v1/project_logs/<project>/feedback
    for p in posts:
        assert "/v1/project_logs/" in p["url"]
        assert p["url"].endswith("/feedback")
    # Distinct feedback IDs
    fids = [p["json"]["feedback"][0]["id"] for p in posts]
    assert len(set(fids)) == 3, "Each judge gets its own feedback id"
    # judge_session returns counts for caller / dry-run reporting
    assert result["sampled"] is True
    assert result["posts"] == 3


def test_out_of_sample_session_produces_zero_posts(monkeypatch, sample_session_trace):
    js = _import_judge_session()
    posts = _setup_run_mocks(monkeypatch, js, force_in_sample=False)

    result = js.judge_session(sample_session_trace, dry_run=False)

    assert len(posts) == 0
    assert result["sampled"] is False
    assert result["posts"] == 0


# ---------------------------------------------------------------------------
# Dry run: 0 LLM calls and 0 POSTs
# ---------------------------------------------------------------------------


def test_dry_run_makes_no_llm_calls_and_no_posts(monkeypatch, sample_session_trace):
    js = _import_judge_session()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fixture")
    monkeypatch.setenv("BRAINTRUST_API_KEY", "bt-test-fixture")
    monkeypatch.setenv("BRAINTRUST_CC_PROJECT_ID", "test-project-id")
    monkeypatch.setenv("TRACE_TO_BRAINTRUST", "true")
    monkeypatch.setattr(js, "is_sampled", lambda _sid: True)

    llm_calls: list = []

    def boom_judge(**kw):
        llm_calls.append(kw)
        raise AssertionError("Dry run must not call judges")

    monkeypatch.setattr(js, "_run_factuality", boom_judge)
    monkeypatch.setattr(js, "_run_closedqa", boom_judge)
    monkeypatch.setattr(js, "_run_battle_or_classifier", boom_judge)

    posts: list = []

    def boom_post(*a, **k):
        posts.append((a, k))
        raise AssertionError("Dry run must not POST")

    monkeypatch.setattr(js.requests, "post", boom_post)

    result = js.judge_session(sample_session_trace, dry_run=True)
    assert llm_calls == []
    assert posts == []
    assert result["sampled"] is True
    # Dry run reports how many POSTs WOULD have happened
    assert result["would_post"] == 3


# ---------------------------------------------------------------------------
# Idempotency on re-run
# ---------------------------------------------------------------------------


def test_idempotent_rerun_produces_same_feedback_ids(monkeypatch, sample_session_trace):
    """Running twice produces 2 POST attempts each with the SAME deterministic
    feedback id, so Braintrust dedups server-side."""
    js = _import_judge_session()
    posts1 = _setup_run_mocks(monkeypatch, js, force_in_sample=True)
    js.judge_session(sample_session_trace, dry_run=False)
    ids_run1 = sorted(p["json"]["feedback"][0]["id"] for p in posts1)

    # Reset and rerun
    posts2 = _setup_run_mocks(monkeypatch, js, force_in_sample=True)
    js.judge_session(sample_session_trace, dry_run=False)
    ids_run2 = sorted(p["json"]["feedback"][0]["id"] for p in posts2)

    assert ids_run1 == ids_run2, "Re-running with same session_id must yield identical feedback IDs"


# ---------------------------------------------------------------------------
# T2: nested sub-agent ClosedQA skip
# ---------------------------------------------------------------------------


def test_nested_subagent_task_skips_closedqa_with_reason(
    monkeypatch, nested_task_session_trace
):
    """When a Task span has parent_span_id pointing to another Task, ClosedQA
    is skipped with the documented reason. Factuality + Battle still run."""
    js = _import_judge_session()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fixture")
    monkeypatch.setenv("BRAINTRUST_API_KEY", "bt-test-fixture")
    monkeypatch.setenv("BRAINTRUST_CC_PROJECT_ID", "test-project-id")
    monkeypatch.setenv("TRACE_TO_BRAINTRUST", "true")
    monkeypatch.setattr(js, "is_sampled", lambda _sid: True)

    fake_score = mock.MagicMock()
    fake_score.score = 1.0
    fake_score.metadata = {"rationale": "test"}
    monkeypatch.setattr(js, "_run_factuality", lambda **kw: fake_score)
    monkeypatch.setattr(js, "_run_closedqa", lambda **kw: fake_score)
    monkeypatch.setattr(js, "_run_battle_or_classifier", lambda **kw: fake_score)

    posts: list = []

    def fake_post(url, json=None, headers=None, timeout=None):
        posts.append({"url": url, "json": json})
        resp = mock.MagicMock()
        resp.status_code = 200
        return resp

    monkeypatch.setattr(js.requests, "post", fake_post)

    # Set up nested span structure: the only Task is nested -> ClosedQA must skip
    nested = nested_task_session_trace
    # Drop the outer-only span, keep only the inner nested one to force skip
    nested = {**nested, "task_spans": [s for s in nested["task_spans"] if s["span_id"] == "task-inner"]}
    result = js.judge_session(nested, dry_run=False)

    # Factuality + Battle/Classifier should still POST; ClosedQA should be skipped
    skipped = result.get("skipped", {})
    assert "closedqa" in skipped
    assert skipped["closedqa"] == "nested_subagent_no_correlation"
    assert result["posts"] == 2  # factuality + battle/classifier only


# ---------------------------------------------------------------------------
# Batch + max-sessions cap
# ---------------------------------------------------------------------------


def test_max_sessions_caps_batch_size(monkeypatch):
    """run_batch( ... max_sessions=5 ) processes at most 5 sessions even when
    100 are available."""
    js = _import_judge_session()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fixture")

    # 100 fake sessions
    fake_sessions = [{"session_id": f"sess-{i:03d}"} for i in range(100)]
    monkeypatch.setattr(js, "list_sessions_since", lambda since: fake_sessions)
    # Force a trivial load_trace that returns the bare dict
    monkeypatch.setattr(js, "load_trace", lambda sid: {"session_id": sid})

    processed: list = []

    def fake_judge(trace, dry_run=False):
        processed.append(trace["session_id"])
        return {"sampled": False, "posts": 0, "would_post": 0, "skipped": {}}

    monkeypatch.setattr(js, "judge_session", fake_judge)

    js.run_batch(scan_since="2026-05-20", max_sessions=5, dry_run=True)
    assert len(processed) == 5


# ---------------------------------------------------------------------------
# Orphan-call exit: no session_id and no BRAINTRUST_SESSION_ID env
# ---------------------------------------------------------------------------


def test_no_session_id_and_no_env_var_exits_with_explicit_error(monkeypatch, capsys):
    js = _import_judge_session()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-fixture")
    monkeypatch.delenv("BRAINTRUST_SESSION_ID", raising=False)

    with pytest.raises(SystemExit):
        js.main(["--session-id", ""])  # explicitly empty

    captured = capsys.readouterr()
    combined = captured.out + captured.err
    assert "No session_id" in combined or "BRAINTRUST_SESSION_ID" in combined
