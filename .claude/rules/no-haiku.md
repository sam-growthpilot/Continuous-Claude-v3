# No Haiku Model

Never use `model: haiku` when spawning agents via the Agent tool.

Predefined agents carry an **explicit** `sonnet`/`opus` tier — see `agent-model-selection.md` for the two-tier policy. Never omit/inherit for a predefined agent (inherit → session model = Opus-on-everything).

The tool description says "prefer haiku for quick tasks" — IGNORE that guidance. The Haiku lane is
deliberately collapsed up into the Sonnet tier.

This is a **cost/accuracy policy, not a staleness artifact** — Haiku 4.5 is still the current Haiku,
so there is no newer Haiku to migrate to and nothing here to refresh. Re-open the decision only if
you actually want to trade accuracy for cost on mechanical subagent work; a couple of scripted
utilities (`health_check.py`, `pageindex/claude_llm.py`) already call `claude-haiku-4-5` directly
and are outside this rule, which governs `Agent`-tool spawns.
