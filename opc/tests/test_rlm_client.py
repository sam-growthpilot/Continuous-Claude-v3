"""RLM wrapper safety + routing tests. No live LLM calls."""
from unittest.mock import patch, MagicMock
import pytest

from scripts.core.rlm_client import rlm_complete, RLMPolicy


def test_refuses_local_sandbox():
    with pytest.raises(ValueError, match="RCE-by-LLM"):
        rlm_complete(
            "q", "x" * 400_000,
            policy=RLMPolicy(sandbox="local"),  # type: ignore[arg-type]
        )


def test_below_threshold_uses_vanilla(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    # Force anthropic backend so the test exercises the SDK vanilla path
    policy = RLMPolicy(backend="anthropic")
    with patch("scripts.core.rlm_client._vanilla_via_sdk", return_value="ok"):
        result = rlm_complete("q", "x" * 100, policy=policy)  # way below threshold
    assert result.path == "vanilla-threshold"
    assert result.answer == "ok"


def test_falls_back_on_rlm_error(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    policy = RLMPolicy(backend="anthropic")
    with patch("scripts.core.rlm_client.RLM") as Mock, \
         patch("scripts.core.rlm_client._vanilla_via_sdk", return_value="fb"):
        agent = MagicMock()
        agent.completion.side_effect = RuntimeError("sandbox died")
        Mock.return_value = agent
        result = rlm_complete("q", "x" * 400_000, policy=policy)
    assert result.path == "vanilla-fallback"
    assert result.answer == "fb"


def test_raises_when_fallback_disabled(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    policy = RLMPolicy(backend="anthropic", fallback_on_error=False)
    with patch("scripts.core.rlm_client.RLM") as Mock:
        agent = MagicMock()
        agent.completion.side_effect = RuntimeError("boom")
        Mock.return_value = agent
        with pytest.raises(RuntimeError, match="boom"):
            rlm_complete("q", "x" * 400_000, policy=policy)


def test_rlm_policy_defaults_to_claude_cli_backend():
    """Default backend must be claude_cli (routes through Max, not Developer API)."""
    policy = RLMPolicy()
    assert policy.backend == "claude_cli"


def test_rlm_complete_with_claude_cli_backend_uses_cli_client(monkeypatch):
    """With backend='claude_cli', the vanilla path must use the CLI, not the Anthropic SDK."""
    # No ANTHROPIC_API_KEY needed for claude_cli backend
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    policy = RLMPolicy(backend="claude_cli")

    with patch("scripts.core.rlm_client._vanilla_via_cli", return_value="cli-ok") as mock_cli, \
         patch("scripts.core.rlm_client._vanilla_via_sdk", return_value="sdk-nope") as mock_sdk:
        result = rlm_complete("q", "x" * 100, policy=policy)  # below threshold

    assert result.path == "vanilla-threshold"
    assert result.answer == "cli-ok"
    assert mock_cli.call_count == 1
    assert mock_sdk.call_count == 0


def test_rlm_policy_defaults_scaled_for_audit_corpora():
    p = RLMPolicy()
    assert p.max_tokens >= 1_500_000, p.max_tokens
    assert p.max_iterations >= 40, p.max_iterations
    assert p.max_timeout_s >= 900.0, p.max_timeout_s
    assert p.max_response_tokens == 4096  # preserved cap on per-turn loops


def test_rlm_auto_scales_for_large_context(monkeypatch):
    """Smoke: 2.5MB input should scale defaults; explicit override should win."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    with patch("scripts.core.rlm_client.RLM") as Mock:
        agent = MagicMock()
        agent.completion.side_effect = RuntimeError("stop")
        Mock.return_value = agent
        with patch("scripts.core.rlm_client._vanilla_claude", return_value="fb"):
            rlm_complete("q", "x" * 2_500_000, policy=RLMPolicy())
        # Inspect constructor kwargs to confirm max_tokens was scaled up
        _, kwargs = Mock.call_args
        assert kwargs["max_tokens"] > 1_500_000, kwargs["max_tokens"]
