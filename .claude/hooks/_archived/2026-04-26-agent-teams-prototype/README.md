# 2026-04-26 — Agent Teams Prototype Archive

17 hook bundles (`.mjs` only — no source) from a v4 multi-agent swarm
experiment that was abandoned. None were registered in `settings.json` and
none were imported by other hooks. They appear to prefigure Claude Code's
official **Agent Teams** feature (https://code.claude.com/docs/en/agent-teams).

## What's here

| Hook | Likely purpose |
|---|---|
| `agent-state-broadcast` | Emit agent state changes to peers |
| `composition-gate-hook` | Gate multi-agent composition decisions |
| `pattern-orchestrator` | Coordinate which pattern fires for a request |
| `phase-gate` | Block transitions until phase prerequisites satisfied |
| `post-task-complete` | Post-task notification/cleanup |
| `pre-edit-context` | Inject context before edits in multi-agent flows |
| `resource-gate` | Throttle/permission resource use across agents |
| `session-end-cleanup-swarms` | Clean up swarm state at session end |
| `stop-coordinator` | Coordinator-side stop event |
| `stop-swarm-coordinator` | Swarm-coordinator stop event |
| `subagent-learning` | Capture learning from subagent traces |
| `subagent-start` | Subagent lifecycle start |
| `subagent-start-swarm` | Swarm-flavored subagent start |
| `subagent-stop` | Subagent lifecycle stop |
| `subagent-stop-continuity` | Continuity capture at subagent stop |
| `subagent-stop-swarm` | Swarm-flavored subagent stop |
| `test-multi-agent` | Test/validation harness for multi-agent flows |

## Why archived (not deleted)

When we adopt Claude Code's Agent Teams API, several of these designs may map
back onto the official lifecycle hooks. The bundles preserve the v4 logic so
we can mine them for ideas (or revive verbatim) rather than re-deriving.

## Caveats

- These are `.mjs` bundles — the original `.ts` sources were already gone
  before this archive was created. So revival means re-deriving the source
  from the bundle, or rewriting fresh against the new Agent Teams API.
- They were never registered, so behavior is unverified.

## Revival

See `../README.md` for the standard revival recipe.
