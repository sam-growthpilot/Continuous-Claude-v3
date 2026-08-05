"""CLI wrapper around rlm_complete.

Used by the /rlm-analyze Claude Code skill (see
.claude/skills/rlm-analyze/cli.py) and for ad-hoc shell invocations.

Responsibilities:
- Parse flags (--question, --input-file, --budget-usd, --model, --mode).
- Read the input-file into a string (the `context` for the RLM).
- Create a timestamped trajectory dir under .claude/cache/rlm-logs/.
- Call rlm_complete(...) with an RLMPolicy that enforces max_depth=1 and
  the requested budget cap.
- Print the final answer to stdout; write a status footer
  ``--- rlm-analyze path: {path} | trajectory: {dir} ---`` to stderr.

This module MUST NOT:
- Accept `sandbox="local"` (the wrapper refuses it; we never override).
- Parameterize max_depth above 1.
- Make live LLM calls from tests (tests patch rlm_complete).
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

from scripts.core.rlm_client import RLMPolicy, rlm_complete


def _short_ts() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def _build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="rlm_cli")
    ap.add_argument("--mode", choices=["skill", "shell"], default="shell")
    ap.add_argument("--question", required=True)
    ap.add_argument("--input-file", required=True)
    ap.add_argument("--budget-usd", type=float, default=2.00)
    ap.add_argument("--model", default="claude-sonnet-5")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    input_path = Path(args.input_file)
    if not input_path.is_file():
        print(
            f"rlm_cli: input-file not found: {input_path}",
            file=sys.stderr,
        )
        return 2

    context = input_path.read_text(encoding="utf-8", errors="replace")

    traj_dir = Path(".claude/cache/rlm-logs") / _short_ts()
    traj_dir.mkdir(parents=True, exist_ok=True)

    result = rlm_complete(
        question=args.question,
        context=context,
        policy=RLMPolicy(max_budget_usd=args.budget_usd),
        model=args.model,
        trajectory_dir=traj_dir,
    )

    # stdout = the answer itself. Callers (skill, humans) read this directly.
    print(result.answer)
    # stderr = status footer with which path was taken and the trajectory dir.
    print(
        f"\n--- rlm-analyze path: {result.path} | trajectory: {traj_dir} ---",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
