"""Custom rlms backend that shells out to `claude -p` (Claude Code CLI).

Routes every LLM call made by the RLM wrapper through the user's Claude Code
Max subscription instead of the Anthropic Developer API. Cost-to-caller: zero
Developer API credits; charged against Max usage instead.

Trade-offs versus the SDK backend:
- ~1s per-call subprocess overhead (vs ~100ms for the SDK). RLM tolerates this
  because iteration count is capped (policy.max_iterations) and context lives
  in the sandbox REPL, not the prompt.
- Max billing is opaque at the call level: `claude -p --output-format json`
  exposes per-call token counts + cost, so we record those best-effort in
  get_usage_summary/get_last_usage.
- No `--max-tokens` flag on `claude -p`: max_tokens is accepted in the
  constructor for signature compatibility with AnthropicClient but does not
  cap generation. `--max-budget-usd` is the closest native cap and is passed
  when set.

Design notes:
- api_key is accepted (BaseLM/AnthropicClient compatibility) but ignored.
  The CLI uses the local Max session, not an API key.
- model_name maps to `--model <name>`. Aliases like `sonnet`, `opus` work.
- system messages flatten into `--system-prompt`. Other message roles are
  concatenated into the positional prompt argument as `Role: content`.
- `--bare` is used to avoid pulling in hooks / plugins / auto-memory on each
  invocation. Keeps latency tight and behavior deterministic.
"""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
from collections import defaultdict
from typing import Any

from rlm.clients.base_lm import BaseLM
from rlm.core.types import ModelUsageSummary, UsageSummary

logger = logging.getLogger(__name__)


class ClaudeCliClient(BaseLM):
    """LM Client that shells out to `claude -p` for every completion.

    Instances of this client route all calls through the local Claude Code
    Max subscription. No api.anthropic.com traffic.
    """

    def __init__(
        self,
        api_key: str | None = None,
        model_name: str | None = None,
        max_tokens: int = 4096,
        cli_path: str | None = None,
        output_format: str = "json",
        bare: bool = True,
        max_budget_usd: float | None = None,
        **kwargs: Any,
    ):
        super().__init__(model_name=model_name or "", **kwargs)
        # api_key accepted for interface compatibility; Max doesn't use it.
        self._api_key_unused = api_key
        self.model_name = model_name
        self.max_tokens = max_tokens  # best-effort; claude -p has no --max-tokens
        self.cli_path = cli_path or shutil.which("claude") or "claude"
        self.output_format = output_format  # "json" preserves usage; "text" is simpler
        self.bare = bare
        self.max_budget_usd = max_budget_usd

        # Per-model usage tracking (best-effort from JSON output)
        self.model_call_counts: dict[str, int] = defaultdict(int)
        self.model_input_tokens: dict[str, int] = defaultdict(int)
        self.model_output_tokens: dict[str, int] = defaultdict(int)
        self.model_total_cost: dict[str, float] = defaultdict(float)

        # Last-call snapshot
        self.last_prompt_tokens = 0
        self.last_completion_tokens = 0
        self.last_cost: float | None = None

    # ------------------------------------------------------------------ public
    def completion(self, prompt: str | list[dict[str, Any]], model: str | None = None) -> str:
        flattened, system_prompt = self._prepare_prompt(prompt)
        argv = self._build_argv(flattened, system_prompt, model)
        stdout = self._run(argv)
        return self._parse_stdout(stdout, model or self.model_name or "unknown")

    async def acompletion(
        self, prompt: str | list[dict[str, Any]], model: str | None = None
    ) -> str:
        # claude -p is synchronous; wrap in a thread to avoid blocking the loop.
        return await asyncio.to_thread(self.completion, prompt, model)

    def get_usage_summary(self) -> UsageSummary:
        summaries: dict[str, ModelUsageSummary] = {}
        for model in self.model_call_counts:
            cost = self.model_total_cost[model] if self.model_total_cost[model] > 0 else None
            summaries[model] = ModelUsageSummary(
                total_calls=self.model_call_counts[model],
                total_input_tokens=self.model_input_tokens[model],
                total_output_tokens=self.model_output_tokens[model],
                total_cost=cost,
            )
        return UsageSummary(model_usage_summaries=summaries)

    def get_last_usage(self) -> ModelUsageSummary:
        return ModelUsageSummary(
            total_calls=1 if (self.last_prompt_tokens or self.last_completion_tokens) else 0,
            total_input_tokens=self.last_prompt_tokens,
            total_output_tokens=self.last_completion_tokens,
            total_cost=self.last_cost,
        )

    # ---------------------------------------------------------------- internal
    def _prepare_prompt(
        self, prompt: str | list[dict[str, Any]]
    ) -> tuple[str, str | None]:
        """Flatten messages to (prompt_str, system_prompt). Mirrors AnthropicClient."""
        if isinstance(prompt, str):
            return prompt, None

        if isinstance(prompt, list) and all(isinstance(item, dict) for item in prompt):
            system_parts: list[str] = []
            non_system: list[dict[str, Any]] = []
            for msg in prompt:
                if msg.get("role") == "system":
                    content = msg.get("content") or ""
                    if isinstance(content, str):
                        system_parts.append(content)
                    else:
                        # Anthropic-style list-of-blocks: best-effort join text fields.
                        system_parts.append(_stringify_content(content))
                else:
                    non_system.append(msg)

            # Flatten remaining messages to a single prompt string.
            # For a single user message, emit only the content (cleanest for claude -p).
            if len(non_system) == 1 and non_system[0].get("role") == "user":
                flat = _stringify_content(non_system[0].get("content") or "")
            else:
                lines = []
                for msg in non_system:
                    role = str(msg.get("role") or "user").capitalize()
                    lines.append(f"{role}: {_stringify_content(msg.get('content') or '')}")
                flat = "\n\n".join(lines)

            system = "\n\n".join(s for s in system_parts if s) or None
            return flat, system

        raise ValueError(f"Invalid prompt type: {type(prompt)}")

    def _build_argv(
        self, flattened_prompt: str, system_prompt: str | None, model: str | None
    ) -> list[str]:
        argv: list[str] = [self.cli_path, "-p"]
        if self.bare:
            argv.append("--bare")
        argv.extend(["--output-format", self.output_format])

        chosen_model = model or self.model_name
        if chosen_model:
            argv.extend(["--model", chosen_model])

        if system_prompt:
            argv.extend(["--system-prompt", system_prompt])

        if self.max_budget_usd is not None:
            argv.extend(["--max-budget-usd", str(self.max_budget_usd)])

        # Prompt must be the last positional arg.
        argv.append(flattened_prompt)
        return argv

    def _run(self, argv: list[str]) -> str:
        logger.debug("ClaudeCliClient: invoking %s (prompt_len=%d)", argv[0], len(argv[-1]))
        try:
            proc = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=self.timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(
                f"claude -p timed out after {self.timeout}s"
            ) from exc
        except FileNotFoundError as exc:
            raise RuntimeError(
                f"claude CLI not found at '{argv[0]}'. Install Claude Code or set cli_path."
            ) from exc

        if proc.returncode != 0:
            raise RuntimeError(
                f"claude -p failed (returncode={proc.returncode}): "
                f"{proc.stderr.strip() or '<no stderr>'}"
            )
        return proc.stdout

    def _parse_stdout(self, stdout: str, model: str) -> str:
        """Extract result text from stdout and record usage if JSON format."""
        if self.output_format == "json":
            try:
                payload = json.loads(stdout)
            except json.JSONDecodeError:
                # Fall back to raw text if JSON parse fails unexpectedly.
                logger.warning("claude -p returned non-JSON despite --output-format json")
                return stdout.strip()

            # Non-dict JSON (e.g. a bare string or number from a mocked test)
            # is treated as plain text with no usage data.
            if not isinstance(payload, dict):
                return stdout.strip()

            if payload.get("is_error"):
                raise RuntimeError(
                    f"claude -p reported error: {payload.get('api_error_status') or payload}"
                )

            result_text = payload.get("result") or ""
            # Record best-effort usage.
            usage = payload.get("usage") or {}
            input_tokens = int(usage.get("input_tokens") or 0)
            output_tokens = int(usage.get("output_tokens") or 0)
            cost = payload.get("total_cost_usd")

            self.model_call_counts[model] += 1
            self.model_input_tokens[model] += input_tokens
            self.model_output_tokens[model] += output_tokens
            if isinstance(cost, (int, float)):
                self.model_total_cost[model] += float(cost)
                self.last_cost = float(cost)
            else:
                self.last_cost = None

            self.last_prompt_tokens = input_tokens
            self.last_completion_tokens = output_tokens
            return result_text

        # Plain text output: no usage available.
        return stdout.strip()


def _stringify_content(content: Any) -> str:
    """Best-effort stringify for Anthropic-style content blocks or plain strings."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                text = block.get("text")
                if isinstance(text, str):
                    parts.append(text)
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts)
    return str(content)
