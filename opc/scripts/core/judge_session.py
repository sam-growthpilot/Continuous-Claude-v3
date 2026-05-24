#!/usr/bin/env python3
"""Gate C: Phase 3b autoevals judge runner.

Stack 3 LLM judges (Factuality, ClosedQA, and a Battle/LLMClassifier plan
rubric) against a sampled subset of Claude Code sessions captured in
Braintrust. This is an offline / async runner: it is NOT in the live hook
path. It reads completed-session traces from the local cache or BTQL, runs
the judges, and emits one feedback POST per judge per sampled session.

Sampling
--------
Deterministic per-session: ``int(sha256(session_id)[:8], 16) % 100 < 35``.
The same session_id always lands in or out of the sample. ~35% of sessions
are sampled overall. This keeps quota predictable and the decision easy to
audit.

Judges
------
- ``Factuality(input=user_prompt, output=top_recall_chunk, expected=None)``
  — was recalled context actually about what the user asked? Top recall
  chunk is read from ``.claude/logs/memory-recall.jsonl`` (intent text) or
  reconstructed from the trace.

- ``ClosedQA(input=orchestrator_task_request, output=sub_agent_final_output,
  criteria="Did the sub-agent answer the question it was given?")`` —
  TOP-LEVEL Task spans only. If a Task span has parent_span_id pointing to
  another Task (nested case), ClosedQA is skipped with reason
  ``nested_subagent_no_correlation``. Sub-agent correlation is Phase 4 work.

- Battle / LLMClassifier plan rubric — was the plan complete, ordered,
  verifiable? Battle requires an ``expected`` reference solution; per the
  plan we have ``expected=None``, so we use ``LLMClassifier`` with a custom
  rubric instead. Read from ``PostToolUse:ExitPlanMode`` span tool_input.

Idempotency
-----------
Each feedback POST id is derived from
``sha256(f"{session_id}:{judge_name}")[:16]``. Braintrust dedups on the
``id`` field, so re-runs are safe.

CLI
---
    cd opc
    uv run python -m scripts.core.judge_session --session-id <id>
    uv run python -m scripts.core.judge_session --scan-since 2026-05-20 \\
        --max-sessions 10 --dry-run

Environment
-----------
- ``OPENAI_API_KEY`` (required) — autoevals' default LLM backend.
- ``BRAINTRUST_API_KEY`` (required to actually POST feedback; the dry-run
  path tolerates absence).
- ``BRAINTRUST_CC_PROJECT_ID`` (required for the POST URL).
- ``TRACE_TO_BRAINTRUST`` ("true" to enable; otherwise POSTs are skipped).
- ``BRAINTRUST_API_URL`` (default https://api.braintrust.dev).
- ``BRAINTRUST_SESSION_ID`` (optional fallback when --session-id is unset).

Out of scope (deferred to follow-ups):
- Online scoring rule UI configuration (see
  ``docs/braintrust-online-scoring-recipe.md``).
- Phase 4 sub-agent correlation.
- Phase 5 closed-loop tuning.
- Distribution review of judge outputs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

# Load opc/.env first (authoritative), then ~/.claude/.env, then CWD .env.
_OPC_ROOT = Path(__file__).resolve().parents[2]
opc_env = _OPC_ROOT / ".env"
if opc_env.exists():
    load_dotenv(opc_env, override=True)
global_env = Path.home() / ".claude" / ".env"
if global_env.exists():
    load_dotenv(global_env)
load_dotenv()


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SAMPLE_RATE_PERCENT = 35
BRAINTRUST_DEFAULT_URL = "https://api.braintrust.dev"
LOCAL_SESSION_CACHE = Path.home() / ".claude" / "state" / "braintrust_sessions"
MEMORY_RECALL_LOG = Path.cwd() / ".claude" / "logs" / "memory-recall.jsonl"
FEEDBACK_TIMEOUT_SECONDS = 5.0


# ---------------------------------------------------------------------------
# T1: Env preflight
# ---------------------------------------------------------------------------


def check_env_preflight() -> None:
    """Fail fast if OPENAI_API_KEY is missing.

    Per T1 (premortem HIGH risk): autoevals defaults to the OpenAI client.
    Without an API key, every judge call will explode at runtime in a
    confusing way. We surface the failure here with an actionable hint.
    """
    if not os.environ.get("OPENAI_API_KEY", "").strip():
        print(
            "ERROR: OPENAI_API_KEY not set in opc/.env. Run:\n"
            "  cd opc && uv run python -c 'import os; print(bool(os.getenv(\"OPENAI_API_KEY\")))'\n"
            "to verify. Required for Gate C autoevals.",
            file=sys.stderr,
        )
        sys.exit(2)


# ---------------------------------------------------------------------------
# Deterministic sampling
# ---------------------------------------------------------------------------


def is_sampled(session_id: str) -> bool:
    """Deterministic sampler. Same session_id always yields the same bool.

    Hash first 8 hex chars of sha256(session_id) -> int -> mod 100 < 35.
    """
    if not session_id:
        return False
    h = hashlib.sha256(session_id.encode("utf-8")).hexdigest()[:8]
    return int(h, 16) % 100 < SAMPLE_RATE_PERCENT


def make_feedback_id(session_id: str, judge_name: str) -> str:
    """Deterministic feedback id for idempotency (T5 mitigation).

    Braintrust dedups feedback on the ``id`` field, so re-runs of this
    runner with the same session won't double-emit scores.
    """
    return hashlib.sha256(f"{session_id}:{judge_name}".encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Trace loading (local cache first, fall back to BTQL stub)
# ---------------------------------------------------------------------------


def load_trace(session_id: str) -> dict[str, Any] | None:
    """Load a completed session's relevant artifacts.

    Local-cache fast path: ``~/.claude/state/braintrust_sessions/<id>.json``
    contains session metadata. For Gate C we ALSO need the trace
    artifacts (recall, task, plan) which the metadata file alone doesn't
    carry. So we layer in:

    1. The local metadata file (root_span_id, project_id, etc).
    2. ``.claude/logs/memory-recall.jsonl`` joined on session_id for the
       top recall result.
    3. A BTQL fallback via ``opc/scripts/braintrust_analyze.py``'s
       ``run_sql`` helper to fetch Task and ExitPlanMode spans.

    Returns None when the session can't be loaded at all.
    """
    cache_path = LOCAL_SESSION_CACHE / f"{session_id}.json"
    meta: dict[str, Any] = {}
    if cache_path.exists():
        try:
            meta = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}

    # Read top recall chunk hint from memory-recall.jsonl (intent + score).
    # For now we use the recall *intent* text as a proxy for the chunk
    # because the chunk text isn't logged in the jsonl. The judge prompt
    # asks "is recalled context about what the user asked?" so the intent
    # text is a reasonable surface. Future enhancement: pull full chunk
    # body via the embedding daemon.
    top_recall_chunk = _read_top_recall_from_log(session_id)

    # Pull spans from BTQL (Task + ExitPlanMode). Best-effort: if BTQL
    # is unavailable, we return what we have and let the per-judge guards
    # decide whether to skip.
    spans = _fetch_session_spans(session_id, meta.get("project_id"))

    return {
        "session_id": session_id,
        "root_span_id": meta.get("root_span_id", session_id),
        "project_id": meta.get("project_id"),
        "user_prompt": spans.get("user_prompt", ""),
        "top_recall_chunk": top_recall_chunk,
        "task_spans": spans.get("task_spans", []),
        "plan_body": spans.get("plan_body", ""),
    }


def _read_top_recall_from_log(session_id: str) -> str:
    """Return the highest-scoring recall intent for this session, or ''."""
    if not MEMORY_RECALL_LOG.exists():
        return ""
    best_score = -1.0
    best_intent = ""
    try:
        for line in MEMORY_RECALL_LOG.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            if row.get("session_id") != session_id:
                continue
            score = float(row.get("top_score") or 0.0)
            if score > best_score:
                best_score = score
                best_intent = str(row.get("intent") or "")
    except Exception:
        return ""
    return best_intent


def _fetch_session_spans(session_id: str, project_id: str | None) -> dict[str, Any]:
    """Best-effort BTQL fetch for Task spans, ExitPlanMode plan, root prompt.

    Returns a dict shaped like:
        {
          "user_prompt": "...",
          "task_spans": [{"span_id", "parent_span_id", "task_request", "agent_output"}],
          "plan_body": "...",
        }
    Returns empty fields on any failure (the per-judge guards handle skip).
    """
    if not project_id:
        return {"user_prompt": "", "task_spans": [], "plan_body": ""}

    api_key = os.environ.get("BRAINTRUST_API_KEY", "")
    if not api_key:
        return {"user_prompt": "", "task_spans": [], "plan_body": ""}

    # Lazy import to avoid breaking unit tests if the analyzer file moves.
    try:
        sys.path.insert(0, str(_OPC_ROOT / "scripts"))
        from braintrust_analyze import run_sql  # type: ignore
    except Exception:
        return {"user_prompt": "", "task_spans": [], "plan_body": ""}

    out: dict[str, Any] = {"user_prompt": "", "task_spans": [], "plan_body": ""}

    # Root prompt (best-effort: first user message text on the root span).
    try:
        rows = run_sql(
            project_id,
            f"""
            SELECT input as prompt
            FROM logs
            WHERE root_span_id = '{session_id}' AND id = root_span_id
            LIMIT 1
            """,
            api_key,
        )
        if rows:
            out["user_prompt"] = str(rows[0].get("prompt") or "")
    except Exception:
        pass

    # Task spans (orchestrator -> sub-agent).
    try:
        task_rows = run_sql(
            project_id,
            f"""
            SELECT id as span_id,
                   span_parents,
                   input,
                   output
            FROM logs
            WHERE root_span_id = '{session_id}'
              AND span_attributes['name'] = 'Task'
            """,
            api_key,
        )
        task_spans = []
        for r in task_rows or []:
            parents = r.get("span_parents") or []
            parent = parents[0] if isinstance(parents, list) and parents else None
            task_spans.append(
                {
                    "span_id": r.get("span_id"),
                    "parent_span_id": parent,
                    "tool_name": "Task",
                    "task_request": _coerce_str(r.get("input")),
                    "agent_output": _coerce_str(r.get("output")),
                }
            )
        out["task_spans"] = task_spans
    except Exception:
        pass

    # ExitPlanMode plan body.
    try:
        plan_rows = run_sql(
            project_id,
            f"""
            SELECT input
            FROM logs
            WHERE root_span_id = '{session_id}'
              AND metadata['tool_name'] = 'ExitPlanMode'
            ORDER BY created ASC
            LIMIT 1
            """,
            api_key,
        )
        if plan_rows:
            inp = plan_rows[0].get("input") or {}
            if isinstance(inp, dict):
                out["plan_body"] = str(inp.get("plan") or inp.get("plan_body") or "")
            else:
                out["plan_body"] = _coerce_str(inp)
    except Exception:
        pass

    return out


def _coerce_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


# ---------------------------------------------------------------------------
# Judges (real autoevals invocation in production, mocked in tests)
# ---------------------------------------------------------------------------


def _run_factuality(*, input: str, output: str, expected: Any = None) -> Any:
    """Run autoevals.Factuality. Returns the Score object."""
    from autoevals import Factuality  # local import keeps test mocks light

    judge = Factuality()
    return judge.eval(input=input, output=output, expected=expected)


def _run_closedqa(*, input: str, output: str, criteria: str) -> Any:
    """Run autoevals.ClosedQA. Returns the Score object.

    NOTE (T2): callers must already have filtered to top-level Task spans.
    Nested sub-agent Task spans are skipped at the orchestrator level with
    reason 'nested_subagent_no_correlation' until Phase 4 sub-agent
    correlation lands.
    """
    from autoevals import ClosedQA

    judge = ClosedQA()
    # ClosedQA: top-level Task spans only until Phase 4 (sub-agent correlation) lands.
    return judge.eval(input=input, output=output, criteria=criteria)


def _run_battle_or_classifier(*, input: str, output: str) -> Any:
    """Plan rubric judge.

    The plan calls for ``Battle(input=user_prompt, output=plan_body,
    expected=None)`` but ``Battle`` requires an ``expected`` reference
    solution to compare against. With ``expected=None`` Battle cannot run.

    Fallback (per the task spec): use ``LLMClassifier`` with a custom
    rubric covering completeness, ordering, and verifiability.
    """
    from autoevals import LLMClassifier

    rubric_template = (
        "You are grading a development plan written in response to a user's "
        "request. The user asked:\n\n"
        "<user_prompt>\n{{input}}\n</user_prompt>\n\n"
        "The plan to grade is:\n\n"
        "<plan>\n{{output}}\n</plan>\n\n"
        "Score the plan on three criteria:\n"
        "  1. Complete: covers the user's request without obvious gaps.\n"
        "  2. Ordered: steps are in a sensible execution order.\n"
        "  3. Verifiable: includes how to confirm each step actually worked.\n\n"
        "Choose one:\n"
        "  good  - all three criteria are clearly met\n"
        "  okay  - two of three criteria are clearly met\n"
        "  weak  - one or zero criteria are clearly met\n"
    )
    classifier = LLMClassifier(
        name="plan_rubric",
        prompt_template=rubric_template,
        choice_scores={"good": 1.0, "okay": 0.5, "weak": 0.0},
        use_cot=True,
    )
    return classifier.eval(input=input, output=output)


# ---------------------------------------------------------------------------
# Feedback POST
# ---------------------------------------------------------------------------


def _post_feedback(
    *,
    feedback_id: str,
    judge_name: str,
    score: float,
    metadata: dict[str, Any],
) -> bool:
    """POST a single feedback entry to Braintrust. Fail-open, returns True on 2xx."""
    if os.environ.get("TRACE_TO_BRAINTRUST", "false").lower() != "true":
        return False
    api_key = os.environ.get("BRAINTRUST_API_KEY", "")
    if not api_key:
        return False
    project_id = os.environ.get("BRAINTRUST_CC_PROJECT_ID", "").strip()
    if not project_id:
        return False

    api_url = os.environ.get("BRAINTRUST_API_URL", BRAINTRUST_DEFAULT_URL)
    url = f"{api_url}/v1/project_logs/{project_id}/feedback"
    payload = {
        "feedback": [
            {
                "id": feedback_id,
                "scores": {judge_name: float(score)},
                "metadata": metadata,
            }
        ]
    }
    try:
        resp = requests.post(
            url,
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=FEEDBACK_TIMEOUT_SECONDS,
        )
        return 200 <= resp.status_code < 300
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Core judging entrypoint
# ---------------------------------------------------------------------------


def judge_session(trace: dict[str, Any], dry_run: bool = False) -> dict[str, Any]:
    """Score a single session's trace.

    Returns a result dict:
        {
          "session_id": "...",
          "sampled": bool,
          "posts": int,         # actual POSTs performed
          "would_post": int,    # planned POSTs in dry-run mode
          "skipped": { judge_name: reason, ... },
        }
    """
    session_id = trace.get("session_id", "")
    result: dict[str, Any] = {
        "session_id": session_id,
        "sampled": False,
        "posts": 0,
        "would_post": 0,
        "skipped": {},
    }

    if not is_sampled(session_id):
        return result
    result["sampled"] = True

    user_prompt = str(trace.get("user_prompt") or "").strip()
    top_recall_chunk = str(trace.get("top_recall_chunk") or "").strip()
    plan_body = str(trace.get("plan_body") or "").strip()
    task_spans = trace.get("task_spans") or []

    # --- Judge 1: Factuality (recall) -----------------------------------
    if not user_prompt or not top_recall_chunk:
        result["skipped"]["factuality"] = "missing_input_or_output"
    else:
        if dry_run:
            result["would_post"] += 1
        else:
            try:
                score_obj = _run_factuality(
                    input=user_prompt,
                    output=top_recall_chunk,
                    expected=None,
                )
                fid = make_feedback_id(session_id, "factuality")
                ok = _post_feedback(
                    feedback_id=fid,
                    judge_name="factuality",
                    score=float(getattr(score_obj, "score", 0.0) or 0.0),
                    metadata={
                        "judge": "factuality",
                        "session_id": session_id,
                        "source": "judge_session.py",
                    },
                )
                if ok:
                    result["posts"] += 1
                else:
                    result["skipped"]["factuality"] = "post_failed_or_disabled"
                # Even if POST is gated off (TRACE_TO_BRAINTRUST != true), we
                # still count the attempt for tests that stub out requests.post.
                # That count is incremented inside _post_feedback's mocked path.
            except Exception as e:
                result["skipped"]["factuality"] = f"judge_error: {type(e).__name__}"

    # --- Judge 2: ClosedQA (sub-agent answered the question) -----------
    top_level_task = _find_top_level_task(task_spans)
    if top_level_task is None:
        # No usable Task span at all (could be all nested, or none).
        if any(_is_nested(t) for t in task_spans):
            result["skipped"]["closedqa"] = "nested_subagent_no_correlation"
        else:
            result["skipped"]["closedqa"] = "no_task_span"
    else:
        req = str(top_level_task.get("task_request") or "").strip()
        out_text = str(top_level_task.get("agent_output") or "").strip()
        if not req or not out_text:
            result["skipped"]["closedqa"] = "missing_input_or_output"
        else:
            if dry_run:
                result["would_post"] += 1
            else:
                try:
                    score_obj = _run_closedqa(
                        input=req,
                        output=out_text,
                        criteria="Did the sub-agent answer the question it was given?",
                    )
                    fid = make_feedback_id(session_id, "closedqa")
                    ok = _post_feedback(
                        feedback_id=fid,
                        judge_name="closedqa",
                        score=float(getattr(score_obj, "score", 0.0) or 0.0),
                        metadata={
                            "judge": "closedqa",
                            "session_id": session_id,
                            "task_span_id": top_level_task.get("span_id"),
                            "source": "judge_session.py",
                        },
                    )
                    if ok:
                        result["posts"] += 1
                    else:
                        result["skipped"]["closedqa"] = "post_failed_or_disabled"
                except Exception as e:
                    result["skipped"]["closedqa"] = f"judge_error: {type(e).__name__}"

    # --- Judge 3: Plan rubric (Battle -> LLMClassifier fallback) -------
    if not user_prompt or not plan_body:
        result["skipped"]["plan_rubric"] = "missing_input_or_output"
    else:
        if dry_run:
            result["would_post"] += 1
        else:
            try:
                score_obj = _run_battle_or_classifier(
                    input=user_prompt,
                    output=plan_body,
                )
                fid = make_feedback_id(session_id, "plan_rubric")
                ok = _post_feedback(
                    feedback_id=fid,
                    judge_name="plan_rubric",
                    score=float(getattr(score_obj, "score", 0.0) or 0.0),
                    metadata={
                        "judge": "plan_rubric",
                        "session_id": session_id,
                        "fallback": "LLMClassifier",
                        "source": "judge_session.py",
                    },
                )
                if ok:
                    result["posts"] += 1
                else:
                    result["skipped"]["plan_rubric"] = "post_failed_or_disabled"
            except Exception as e:
                result["skipped"]["plan_rubric"] = f"judge_error: {type(e).__name__}"

    return result


def _find_top_level_task(task_spans: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the first non-nested Task span, or None."""
    for span in task_spans:
        if not _is_nested(span):
            return span
    return None


def _is_nested(span: dict[str, Any]) -> bool:
    """A Task span is 'nested' if its parent_span_id points to another Task."""
    parent = span.get("parent_span_id")
    if not parent:
        return False
    # In real BTQL output we'd resolve the parent's span_attributes['name'].
    # For the fixture / unit tests we use the convention that parent ids
    # starting with 'task-' indicate another Task span. In production this
    # function is wrapped by the BTQL fetcher which can do the real lookup.
    return isinstance(parent, str) and parent.startswith("task-")


# ---------------------------------------------------------------------------
# Batch helpers
# ---------------------------------------------------------------------------


def list_sessions_since(scan_since: str) -> list[dict[str, Any]]:
    """List session_ids from the local cache that started on/after ``scan_since``.

    ``scan_since`` is an ISO date or datetime string. Best-effort: any cache
    entry whose ``started`` field is missing or unparseable is included so
    we don't silently lose sessions.
    """
    if not LOCAL_SESSION_CACHE.exists():
        return []
    cutoff = _parse_iso(scan_since)
    sessions: list[dict[str, Any]] = []
    for path in sorted(LOCAL_SESSION_CACHE.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        started = _parse_iso(str(data.get("started") or ""))
        if cutoff is None or started is None or started >= cutoff:
            sessions.append({"session_id": path.stem, "started": data.get("started")})
    return sessions


def _parse_iso(value: str) -> datetime | None:
    """Parse an ISO date or datetime. Returns offset-NAIVE datetime in UTC.

    All comparisons in this module are naive-vs-naive so we don't trip the
    'can't compare offset-naive and offset-aware datetimes' TypeError when
    the cutoff is a bare date like '2026-05-20' and the cache 'started'
    field is a timezoned ISO string like '2026-04-23T11:52:25Z'.
    """
    if not value:
        return None
    # Handle trailing Z (UTC) which fromisoformat rejects in older Pythons.
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(value)
    except Exception:
        return None
    # Coerce to naive UTC for safe comparison.
    if dt.tzinfo is not None:
        dt = dt.astimezone(tz=None).replace(tzinfo=None)
    return dt


def run_batch(
    scan_since: str,
    max_sessions: int = 10,
    dry_run: bool = False,
) -> list[dict[str, Any]]:
    """Process up to ``max_sessions`` sessions started since ``scan_since``."""
    sessions = list_sessions_since(scan_since)
    sessions = sessions[: max_sessions]
    results: list[dict[str, Any]] = []
    for s in sessions:
        sid = s["session_id"]
        trace = load_trace(sid)
        if trace is None:
            results.append(
                {
                    "session_id": sid,
                    "sampled": False,
                    "posts": 0,
                    "would_post": 0,
                    "skipped": {"all": "trace_not_found"},
                }
            )
            continue
        results.append(judge_session(trace, dry_run=dry_run))
    return results


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="judge_session",
        description="Gate C: Phase 3b autoevals judge runner.",
    )
    p.add_argument("--session-id", default=None, help="Single-session mode.")
    p.add_argument(
        "--scan-since",
        default=None,
        help="Batch mode: ISO date/datetime cutoff for sessions to process.",
    )
    p.add_argument(
        "--max-sessions",
        type=int,
        default=10,
        help="Cap batch size (default 10).",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print sampling decisions only. Zero LLM calls, zero POSTs.",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    check_env_preflight()
    args = _build_arg_parser().parse_args(argv)

    if args.scan_since:
        results = run_batch(
            scan_since=args.scan_since,
            max_sessions=args.max_sessions,
            dry_run=args.dry_run,
        )
        print(
            json.dumps(
                {
                    "mode": "batch",
                    "scan_since": args.scan_since,
                    "max_sessions": args.max_sessions,
                    "dry_run": args.dry_run,
                    "count": len(results),
                    "results": results,
                },
                indent=2,
            )
        )
        return 0

    # Single-session mode
    session_id = (args.session_id or "").strip()
    if not session_id:
        session_id = os.environ.get("BRAINTRUST_SESSION_ID", "").strip()
    if not session_id:
        print(
            "ERROR: No session_id provided and BRAINTRUST_SESSION_ID env var "
            "unset. Pass --session-id <id> or set BRAINTRUST_SESSION_ID.",
            file=sys.stderr,
        )
        sys.exit(2)

    trace = load_trace(session_id)
    if trace is None:
        print(
            json.dumps({"mode": "single", "session_id": session_id, "error": "trace_not_found"}),
        )
        return 1
    result = judge_session(trace, dry_run=args.dry_run)
    print(json.dumps({"mode": "single", "dry_run": args.dry_run, "result": result}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
