# Agent Model Selection

**Default:** Omit `model` parameter - agents inherit parent model (usually Opus).

## Never use Haiku

**Never set `model: haiku`** — no exceptions.

This applies universally, including agents where it might seem harmless:
- **scout** - Needs accuracy for codebase exploration
- **oracle** - External research requires comprehension
- **architect/phoenix** - Planning requires nuanced judgment
- **kraken** - Implementation needs to understand context
- **spark** - Even simple fixes require understanding context

## Why This Matters

Haiku optimizes for cost/latency at the expense of accuracy. Tasks often seem "quick" but require tracing relationships across files. A cheap model that misses connections wastes more time than it saves.

## Rule

**Always omit the model parameter.** Let the agent inherit Opus.
