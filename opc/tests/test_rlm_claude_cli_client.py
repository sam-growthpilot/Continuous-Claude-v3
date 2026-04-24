"""Tests for ClaudeCliClient -- routes LLM calls through `claude -p` (Max subscription).

All subprocess calls are mocked. No live CLI invocations.
"""
from __future__ import annotations

import json
import subprocess
from unittest.mock import MagicMock, patch

import pytest

from scripts.core.rlm_claude_cli_client import ClaudeCliClient


def _fake_completed(stdout: str, returncode: int = 0, stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        args=["claude"], returncode=returncode, stdout=stdout, stderr=stderr
    )


def test_completion_flattens_messages_to_prompt_string():
    """Message list with system + user roles must flatten to a single prompt string."""
    client = ClaudeCliClient(api_key=None, model_name="claude-sonnet-4-6")
    messages = [
        {"role": "system", "content": "You are concise."},
        {"role": "user", "content": "What is 2+2?"},
    ]

    with patch("scripts.core.rlm_claude_cli_client.subprocess.run") as mock_run:
        mock_run.return_value = _fake_completed("4")
        result = client.completion(messages)

    assert result == "4"
    # One subprocess call
    assert mock_run.call_count == 1
    call_args = mock_run.call_args
    argv = call_args[0][0] if call_args[0] else call_args.kwargs.get("args", [])
    # Must invoke the claude CLI with -p (exe name may be resolved by shutil.which)
    exe_basename = argv[0].lower().replace("\\", "/").rsplit("/", 1)[-1]
    assert exe_basename in ("claude", "claude.exe")
    assert "-p" in argv
    # User content must be in the prompt argv (last positional after -p flags)
    joined = " ".join(argv)
    assert "What is 2+2?" in joined
    # System prompt should be passed via --system-prompt or embedded
    assert "concise" in joined.lower()


def test_completion_returns_correct_rlm_type():
    """BaseLM contract: completion must return a str."""
    client = ClaudeCliClient(api_key=None, model_name="claude-sonnet-4-6")
    with patch("scripts.core.rlm_claude_cli_client.subprocess.run") as mock_run:
        mock_run.return_value = _fake_completed("The answer is 4.\n")
        out = client.completion("What is 2+2?")

    assert isinstance(out, str)
    assert out.strip() == "The answer is 4."


def test_completion_surfaces_subprocess_error():
    """Non-zero return code from claude -p must surface as a RuntimeError."""
    client = ClaudeCliClient(api_key=None, model_name="claude-sonnet-4-6")
    with patch("scripts.core.rlm_claude_cli_client.subprocess.run") as mock_run:
        mock_run.return_value = _fake_completed(
            stdout="", returncode=1, stderr="Error: authentication failed"
        )
        with pytest.raises(RuntimeError, match="claude -p failed|authentication"):
            client.completion("hi")


def test_get_usage_summary_returns_empty():
    """Max billing is opaque at the call level -- usage summary starts empty."""
    client = ClaudeCliClient(api_key=None, model_name="claude-sonnet-4-6")
    summary = client.get_usage_summary()
    # UsageSummary has a model_usage_summaries dict; should be empty before any calls
    assert hasattr(summary, "model_usage_summaries")
    assert summary.model_usage_summaries == {} or all(
        ms.total_calls == 0 for ms in summary.model_usage_summaries.values()
    )
    assert summary.total_cost is None

    # get_last_usage before any call should also return zero/empty
    last = client.get_last_usage()
    assert last.total_calls in (0, 1)  # implementation detail; tokens must be 0
    assert last.total_input_tokens == 0
    assert last.total_output_tokens == 0
