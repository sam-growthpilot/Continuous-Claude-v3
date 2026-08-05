# Agent Model Selection

Every predefined agent (`.claude/agents/*.md` **and** its `.json` mirror) carries an **explicit two-tier** `model:` — no omit, no inherit, never haiku.

## The two tiers

The tier names are **bare aliases, deliberately unpinned** — `opus` and `sonnet` resolve at spawn
time to whatever the running build maps them to, so this policy survives model releases without
edits. Do not replace them with dated IDs (`claude-opus-5`, `claude-sonnet-5-…`): a pin freezes the
agent on one model and has to be re-migrated every release. Pin only when reproducing a specific
run.

- **`model: opus`** = the current Opus tier. Reserve for judgment-dense work: planning/design (architect, phoenix, plan-agent), review/soundness gates (critic, plan-reviewer, principal-reviewer, review-agent), orchestration (maestro), deep forensics (sleuth, debug-agent), security (aegis), high-stakes bootstrap (wizard).
- **`model: sonnet`** = the current Sonnet tier. The **default** for execution: implementation (kraken, spark, agentica-agent), exploration/research (scout, oracle, pathfinder, onboard), test execution (arbiter, atlas, sentinel), checklist review, mechanical ops, docs.

Effort is a **global** `~/.claude/settings.json` `effortLevel`, not a per-agent field.

Tier by **judgment density**, not task size. Current split: **43 agents, 14 Opus / 29 Sonnet**
(`grep -h '^model:' .claude/agents/*.md | sort | uniq -c` to re-derive — don't trust a stale count here).

## Never omit/inherit for a predefined agent

`inherit` (or an omitted `model:`) resolves to the **session model** (currently Opus) — silently reproducing Opus-on-everything, the exact anti-goal. Predefined agents MUST be explicit. Omitting is acceptable only for a genuinely ad-hoc, chat-level `Agent` call.

## Never use Haiku

**Never set `model: haiku`** — no exceptions. Haiku optimizes cost/latency at the expense of accuracy; the Haiku lane is deliberately collapsed up into Sonnet 5. Tasks often seem "quick" but require tracing relationships across files.

## Never set `CLAUDE_CODE_SUBAGENT_MODEL`

The env var overrides every agent's frontmatter and **flattens the whole tier map to one model**. Keep it unset (verified unset 2026-07-07); a standing guard fails loud if it is ever set.

## Expression mechanics

Use the bare aliases `model: opus` / `model: sonnet` (no `ANTHROPIC_DEFAULT_*_MODEL` pins). The
`.json` mirror's `model` field is read at spawn by `opc/scripts/claude_spawn.py`, which passes it
through as `--model` — so the alias is resolved by the CLI, not by this repo. The mirror is **not**
auto-synced from the `.md` (`sync-agent-json.py` preserves it) — edit both in lockstep.
