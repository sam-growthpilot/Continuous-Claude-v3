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
| **[system-overview.html](./system-overview.html)** | Interactive visual overview (roster, topology, pipeline, disk bus, animated flow) |
| **[cockpit-guide.html](./cockpit-guide.html)** | Operator cockpit guide (controls, gates, ask-moments, troubleshooting) — published to Notion as a Project Board child page |

## Operational surfaces

| Surface | Path |
|---------|------|
| Workroom protocol (doctrine, phases, message schema) | `.workroom/PROTOCOL.md` |
| Room templates (ROOM.yaml, CONTRACT, status, message, milestone, finding) | `.workroom/templates/` |
| Workroom skill | `.claude/skills/workroom/SKILL.md` |
| Grok skill / safety rule | `.claude/skills/grok/SKILL.md` · `.claude/rules/grok-worker-safety.md` |
| Codex skill / safety rule | `.claude/skills/codex/SKILL.md` · `.claude/rules/codex-worker-safety.md` |
| Harness update playbook | `.claude/skills/harness-update/SKILL.md` · `.claude/rules/harness-update.md` |
| Test suite (static tier, 53 checks) | `scripts/tri-model/tri-model-suite.sh` |

## Roster defaults (Game Plan)

**Grok builds. Codex reviews and fixes.** Codex builds only as failover or via explicit
`--builder codex` override — and a failover builder never grades its own milestone.
Claude is hub: phase authority, smoke evidence, synthesis. Human holds Gate 1 (plan) and
Gate 2 (ship). Full doctrine: `.workroom/PROTOCOL.md`.

External mirrors (human-facing):
- Notion cockpit guide: "Tri-Model Cockpit Guide" (page `39a76fd7ac82817abc0bffdfeaec1c54`, child of Project Board; embed of `cockpit-guide.html` + AI digest)
- Notion how-to (one revision behind until Track F): "Cross-Model Workers in CCv3" (page `39676fd7ac8281068c7ee4b6f793f5af`)
- Visual map (in-repo): [system-overview.html](./system-overview.html)
- Visual map (Claude.ai session artifact, may lag): `claude.ai/code/artifact/edadfc5f-fa44-4952-a299-23f586d1c435`

**Rule:** durable multi-model plans and contracts live **in this repo** (`docs/` / `.workroom/`), not only under `~/.grok/sessions/`, `~/.claude/plans/`, or chat.
