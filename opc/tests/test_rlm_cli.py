"""Tests for scripts/core/rlm_cli.py CLI wrapper around rlm_complete.

No live LLM calls. Exercises:
- plumbing: reads input-file, forwards to rlm_complete with expected args
- stdout/stderr split: answer -> stdout, status footer -> stderr
- error handling: missing input-file exits non-zero
"""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest


def _run_main(argv: list[str]) -> int:
    """Invoke rlm_cli.main() with a patched sys.argv."""
    from scripts.core import rlm_cli

    with patch.object(sys, "argv", ["rlm_cli", *argv]):
        return rlm_cli.main()


def test_rlm_cli_reads_input_file_and_invokes_rlm_complete(tmp_path, monkeypatch):
    """Verify plumbing: file contents flow into context kwarg, question flag
    into question kwarg, and the default model is forwarded."""
    monkeypatch.chdir(tmp_path)
    input_file = tmp_path / "corpus.txt"
    input_file.write_text("hello world", encoding="utf-8")

    fake_result = SimpleNamespace(
        answer="42",
        path="rlm",
        usage={"input_tokens": 10, "output_tokens": 2},
        trajectory_path=None,
    )

    with patch("scripts.core.rlm_cli.rlm_complete", return_value=fake_result) as mock_rlm:
        code = _run_main([
            "--mode", "skill",
            "--question", "what is the answer?",
            "--input-file", str(input_file),
        ])

    assert code == 0
    assert mock_rlm.call_count == 1
    _, kwargs = mock_rlm.call_args
    assert kwargs["question"] == "what is the answer?"
    assert kwargs["context"] == "hello world"
    assert kwargs["model"] == "claude-sonnet-5"
    # trajectory dir should exist and be under .claude/cache/rlm-logs/
    traj = kwargs["trajectory_dir"]
    assert isinstance(traj, Path)
    assert traj.exists()
    assert "rlm-logs" in traj.as_posix()


def test_rlm_cli_writes_answer_to_stdout_and_status_to_stderr(
    tmp_path, monkeypatch, capsys
):
    """Answer goes to stdout. Status footer with path + trajectory dir goes to stderr."""
    monkeypatch.chdir(tmp_path)
    input_file = tmp_path / "corpus.txt"
    input_file.write_text("payload", encoding="utf-8")

    fake_result = SimpleNamespace(
        answer="THE ANSWER",
        path="vanilla-threshold",
        usage={},
        trajectory_path=None,
    )

    with patch("scripts.core.rlm_cli.rlm_complete", return_value=fake_result):
        code = _run_main([
            "--mode", "skill",
            "--question", "q",
            "--input-file", str(input_file),
            "--budget-usd", "1.50",
        ])

    assert code == 0
    captured = capsys.readouterr()
    assert "THE ANSWER" in captured.out
    # Status footer lands on stderr with path + trajectory marker
    assert "rlm-analyze path: vanilla-threshold" in captured.err
    assert "trajectory:" in captured.err


def test_rlm_cli_errors_on_missing_input_file(tmp_path, monkeypatch, capsys):
    """Missing input-file produces a non-zero exit and a stderr message."""
    monkeypatch.chdir(tmp_path)
    missing = tmp_path / "does-not-exist.txt"

    with patch("scripts.core.rlm_cli.rlm_complete") as mock_rlm:
        code = _run_main([
            "--mode", "skill",
            "--question", "q",
            "--input-file", str(missing),
        ])

    assert code != 0
    mock_rlm.assert_not_called()
    captured = capsys.readouterr()
    assert "input-file" in captured.err.lower() or "not found" in captured.err.lower()
