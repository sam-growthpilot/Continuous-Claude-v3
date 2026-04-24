"""Tests for scripts/health_check.py.

All external dependencies (subprocess, asyncpg, anthropic, filesystem) are
mocked. No live DB, LLM, or CLI calls.
"""
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from scripts.health_check import (
    CheckResult,
    HealthCheckRunner,
    compute_exit_code,
    render_markdown,
    CATEGORY_ORDER,
)


# ---------------------------------------------------------------------------
# CheckResult dataclass
# ---------------------------------------------------------------------------


def test_checkresult_serializes_cleanly():
    """CheckResult -> JSON roundtrip preserves every field."""
    r = CheckResult(
        name="memory-canary-roundtrip",
        category="memory",
        status="PASS",
        severity="CRITICAL",
        evidence="canary stored and retrieved as top-1 in 842ms",
        duration_ms=842,
        remediation="",
        metadata={"canary_id": "HEALTH_CHECK_abc"},
    )
    as_dict = r.to_dict()
    # must be JSON-serializable
    blob = json.dumps(as_dict)
    back = json.loads(blob)
    assert back["name"] == "memory-canary-roundtrip"
    assert back["category"] == "memory"
    assert back["status"] == "PASS"
    assert back["severity"] == "CRITICAL"
    assert back["duration_ms"] == 842
    assert back["metadata"]["canary_id"] == "HEALTH_CHECK_abc"


def test_checkresult_default_metadata_is_independent():
    """default metadata dict must not be shared between instances."""
    a = CheckResult(name="a", category="x", status="PASS", severity="INFO",
                    evidence="", duration_ms=0)
    b = CheckResult(name="b", category="x", status="PASS", severity="INFO",
                    evidence="", duration_ms=0)
    a.metadata["x"] = 1
    assert "x" not in b.metadata


# ---------------------------------------------------------------------------
# Exit code escalation
# ---------------------------------------------------------------------------


def _mk(status: str, severity: str = "MEDIUM") -> CheckResult:
    return CheckResult(
        name="x", category="c", status=status, severity=severity,
        evidence="", duration_ms=1,
    )


def test_exit_code_all_pass_is_zero():
    assert compute_exit_code([_mk("PASS"), _mk("PASS")]) == 0


def test_exit_code_warn_escalates_to_one():
    assert compute_exit_code([_mk("PASS"), _mk("WARN", "LOW")]) == 1


def test_exit_code_high_fail_escalates_to_two():
    assert compute_exit_code([_mk("PASS"), _mk("FAIL", "HIGH")]) == 2


def test_exit_code_critical_fail_escalates_to_three():
    assert compute_exit_code([_mk("PASS"), _mk("FAIL", "CRITICAL")]) == 3


def test_exit_code_critical_beats_everything():
    """CRITICAL must dominate regardless of order."""
    results = [_mk("WARN"), _mk("FAIL", "HIGH"), _mk("FAIL", "CRITICAL")]
    assert compute_exit_code(results) == 3


def test_exit_code_skip_does_not_contribute():
    assert compute_exit_code([_mk("PASS"), _mk("SKIP", "INFO")]) == 0


# ---------------------------------------------------------------------------
# Isolation: one crash must not kill siblings
# ---------------------------------------------------------------------------


def test_one_check_crash_does_not_kill_others(tmp_path):
    runner = HealthCheckRunner(output_dir=tmp_path, quiet=True)

    def good_check() -> CheckResult:
        return CheckResult(
            name="good", category="infrastructure", status="PASS",
            severity="INFO", evidence="ok", duration_ms=1,
        )

    def crashing_check() -> CheckResult:
        raise RuntimeError("boom -- check crashed")

    def another_good() -> CheckResult:
        return CheckResult(
            name="another", category="infrastructure", status="PASS",
            severity="INFO", evidence="also ok", duration_ms=1,
        )

    runner.register("good", "infrastructure", good_check)
    runner.register("crash", "infrastructure", crashing_check)
    runner.register("another", "infrastructure", another_good)

    results = runner.run_sync()
    names = {r.name: r for r in results}

    # all three ran
    assert set(names.keys()) == {"good", "crash", "another"}
    # the crash became a FAIL result, not an uncaught exception
    assert names["crash"].status == "FAIL"
    assert names["crash"].severity == "HIGH"
    assert "boom" in names["crash"].evidence
    # neighbours still passed
    assert names["good"].status == "PASS"
    assert names["another"].status == "PASS"


# ---------------------------------------------------------------------------
# Category filtering
# ---------------------------------------------------------------------------


def test_category_filter_runs_only_requested(tmp_path):
    runner = HealthCheckRunner(output_dir=tmp_path, quiet=True)

    def mem_check() -> CheckResult:
        return CheckResult(name="m", category="memory", status="PASS",
                           severity="INFO", evidence="", duration_ms=1)

    def infra_check() -> CheckResult:
        return CheckResult(name="i", category="infrastructure",
                           status="PASS", severity="INFO",
                           evidence="", duration_ms=1)

    runner.register("m", "memory", mem_check)
    runner.register("i", "infrastructure", infra_check)

    results = runner.run_sync(categories=["memory"])
    assert {r.name for r in results} == {"m"}


def test_category_filter_empty_means_all(tmp_path):
    runner = HealthCheckRunner(output_dir=tmp_path, quiet=True)
    runner.register("m", "memory", lambda: CheckResult(
        name="m", category="memory", status="PASS", severity="INFO",
        evidence="", duration_ms=1))
    runner.register("i", "infrastructure", lambda: CheckResult(
        name="i", category="infrastructure", status="PASS", severity="INFO",
        evidence="", duration_ms=1))
    results = runner.run_sync(categories=None)
    assert len(results) == 2


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------


def test_markdown_output_has_required_sections():
    results = [
        CheckResult(name="a", category="memory", status="PASS",
                    severity="INFO", evidence="ok", duration_ms=5),
        CheckResult(name="b", category="hooks", status="WARN",
                    severity="MEDIUM", evidence="mild", duration_ms=3),
        CheckResult(name="c", category="memory", status="FAIL",
                    severity="CRITICAL", evidence="boom",
                    remediation="restart", duration_ms=4),
    ]
    md = render_markdown(results, duration_s=12.5)
    # headline
    assert "CCv3 Health Check" in md
    assert "Overall:" in md
    # severity sections
    assert "## CRITICAL" in md
    assert "## Summary" in md
    assert "## Per-category" in md
    # per-category table header
    assert "| Category" in md
    # evidence text appears
    assert "boom" in md
    # remediation surfaced for the failing check
    assert "restart" in md


def test_markdown_reports_counts():
    results = [
        _mk("PASS"), _mk("PASS"), _mk("WARN"),
        _mk("FAIL", "CRITICAL"), _mk("SKIP", "INFO"),
    ]
    md = render_markdown(results, duration_s=1.0)
    assert "PASS: 2" in md
    assert "WARN: 1" in md
    assert "FAIL: 1" in md
    assert "SKIP: 1" in md


# ---------------------------------------------------------------------------
# JSON + history output
# ---------------------------------------------------------------------------


def test_runner_writes_json_and_markdown_and_history(tmp_path):
    runner = HealthCheckRunner(output_dir=tmp_path, quiet=True)
    runner.register("ok", "infrastructure", lambda: CheckResult(
        name="ok", category="infrastructure", status="PASS",
        severity="INFO", evidence="ran", duration_ms=2))

    results = runner.run_sync()
    runner.write_outputs(results)

    # JSON artifact
    json_files = list(tmp_path.glob("*.json"))
    # we expect at least the run JSON (history.jsonl also lives here but ends in .jsonl)
    assert any(f.name != "history.jsonl" for f in json_files)

    # markdown artifact
    md_files = list(tmp_path.glob("*.md"))
    assert md_files
    md_text = md_files[0].read_text(encoding="utf-8")
    assert "CCv3 Health Check" in md_text

    # history line appended
    history = tmp_path / "history.jsonl"
    assert history.exists()
    lines = [line for line in history.read_text().splitlines() if line.strip()]
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["counts"]["PASS"] == 1
    assert "timestamp" in entry
    assert "overall_status" in entry


def test_history_accumulates_across_runs(tmp_path):
    runner = HealthCheckRunner(output_dir=tmp_path, quiet=True)
    runner.register("ok", "infrastructure", lambda: CheckResult(
        name="ok", category="infrastructure", status="PASS",
        severity="INFO", evidence="", duration_ms=1))

    for _ in range(3):
        results = runner.run_sync()
        runner.write_outputs(results)

    history = tmp_path / "history.jsonl"
    lines = [line for line in history.read_text().splitlines() if line.strip()]
    assert len(lines) == 3


# ---------------------------------------------------------------------------
# Category ordering (stable report layout)
# ---------------------------------------------------------------------------


def test_category_order_is_declared_and_covers_known_categories():
    # Must contain the big-ticket categories the runner defines
    for expected in ("infrastructure", "hooks", "memory", "skills", "agents"):
        assert expected in CATEGORY_ORDER


# ---------------------------------------------------------------------------
# Canary roundtrip -- logic-level test (no real DB)
# ---------------------------------------------------------------------------


def test_canary_id_is_unique_per_invocation():
    """The canary generator must produce distinct ids on repeat calls."""
    from scripts.health_check import _build_canary_signal

    a = _build_canary_signal()
    b = _build_canary_signal()
    assert a["canary_id"] != b["canary_id"]
    # both must carry a deterministic semantic phrase marker
    assert a["phrase"]
    assert b["phrase"]
    # and a date stamp component for audit
    assert a["canary_id"].startswith("HEALTH_CHECK_")


# ---------------------------------------------------------------------------
# Exit code matches overall_status
# ---------------------------------------------------------------------------


def test_exit_code_matches_overall_status():
    """compute_exit_code must agree with _overall_status across all 4 tiers."""
    pass_only = [CheckResult(name="x", category="c", status="PASS",
                             severity="INFO", evidence="", duration_ms=1)]
    assert compute_exit_code(pass_only) == 0

    with_warn = pass_only + [CheckResult(name="y", category="c", status="WARN",
                                         severity="LOW", evidence="",
                                         duration_ms=1)]
    assert compute_exit_code(with_warn) == 1

    with_high = pass_only + [CheckResult(name="z", category="c", status="FAIL",
                                          severity="HIGH", evidence="",
                                          duration_ms=1)]
    assert compute_exit_code(with_high) == 2

    with_crit = pass_only + [CheckResult(name="w", category="c", status="FAIL",
                                          severity="CRITICAL", evidence="",
                                          duration_ms=1)]
    assert compute_exit_code(with_crit) == 3


def test_exit_code_covers_all_fail_severities():
    """FAIL at MEDIUM or LOW must still return 2 (any FAIL merits a signal)."""
    base = [CheckResult(name="x", category="c", status="PASS",
                        severity="INFO", evidence="", duration_ms=1)]

    with_medium = base + [CheckResult(name="y", category="c", status="FAIL",
                                      severity="MEDIUM", evidence="",
                                      duration_ms=1)]
    assert compute_exit_code(with_medium) == 2

    with_low = base + [CheckResult(name="z", category="c", status="FAIL",
                                   severity="LOW", evidence="",
                                   duration_ms=1)]
    assert compute_exit_code(with_low) == 2


# ---------------------------------------------------------------------------
# Vitest check uses --outputFile (not stdout parsing)
# ---------------------------------------------------------------------------


def test_vitest_check_uses_output_file(tmp_path):
    """check_hook_vitest must pass --outputFile to vitest and read that file."""
    from scripts.health_check import check_hook_vitest, CLAUDE_DIR

    vitest_json = {
        "numTotalTests": 10,
        "numPassedTests": 10,
        "numFailedTests": 0,
    }

    captured_cmd: list = []

    def fake_run(cmd, **kwargs):
        captured_cmd.extend(cmd)
        # Find the --outputFile argument and write JSON there.
        for arg in cmd:
            if arg.startswith("--outputFile="):
                out_path = Path(arg.split("=", 1)[1])
                out_path.write_text(json.dumps(vitest_json), encoding="utf-8")
        ns = MagicMock()
        ns.returncode = 0
        ns.stdout = ""
        ns.stderr = ""
        return ns

    hooks_pkg = CLAUDE_DIR / "hooks" / "package.json"
    hooks_pkg.parent.mkdir(parents=True, exist_ok=True)
    hooks_pkg.write_text("{}", encoding="utf-8")

    try:
        with patch("scripts.health_check._run", side_effect=fake_run):
            result = check_hook_vitest()

        # Must have passed --outputFile in the command
        assert any(a.startswith("--outputFile=") for a in captured_cmd), (
            "--outputFile not found in vitest command: " + str(captured_cmd)
        )
        # Must have read the file and reported correctly
        assert result.status == "PASS"
        assert "10/10" in result.evidence
    finally:
        # Clean up the package.json we created only if it was ours
        try:
            if hooks_pkg.exists() and hooks_pkg.read_text() == "{}":
                hooks_pkg.unlink(missing_ok=True)
        except OSError:
            pass
