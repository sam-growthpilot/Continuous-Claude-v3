# Tri-model documentation

Cross-model collaboration for **Claude Code + Codex + Grok** inside Continuous Claude.

**Next session starts here → [SESSION-REVIEW-2026-07-11.md](./SESSION-REVIEW-2026-07-11.md)** (the combined plan: connection layer × governance layer, corrections, build order).

| Doc | Purpose |
|-----|---------|
| [SESSION-REVIEW-2026-07-11.md](./SESSION-REVIEW-2026-07-11.md) | Combined workstream review + next-session build order (supersedes the two separate roadmaps) |
| [COLLABORATION-PLAN.md](./COLLABORATION-PLAN.md) | Canonical governance design: Game Plan roster + workroom disk bus + Tracks A–G |
| [BUILD-PLAN-2026-07-11.md](./BUILD-PLAN-2026-07-11.md) | The executed connection-layer plan (in-repo copy per placement rule; original was session-local) |
| [../grok-integration/DESIGN-RESEARCH.md](../grok-integration/DESIGN-RESEARCH.md) | Live-probed Grok CLI surface (safety facts source of truth) |
| [../codex-integration/DESIGN-RESEARCH.md](../codex-integration/DESIGN-RESEARCH.md) | Live-probed Codex CLI surface (§13 = 0.144.1 + gpt-5.6) |
| [Handoff 2026-07-11](../../thoughts/shared/handoffs/feature-tri-model-workers/2026-07-11-tri-model-handoff.md) | Session handoff: done/verified list, load-bearing facts, resumption steps |

External mirrors (human-facing, one revision behind until Track E/F):
- Notion: "Cross-Model Workers in CCv3" (page `39676fd7ac8281068c7ee4b6f793f5af`)
- Visual map artifact: `claude.ai/code/artifact/edadfc5f-fa44-4952-a299-23f586d1c435`

**Rule:** durable multi-model plans and contracts live **in this repo** (`docs/` / `.workroom/`), not only under `~/.grok/sessions/`, `~/.claude/plans/`, or chat.
