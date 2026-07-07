---
name: codex
description: Hand a task to the OpenAI Codex harness (gpt-5.5, on the ChatGPT subscription — no API key) to WORK THROUGH — answer it, or actually implement it with write access — not just review. Cross-model execution, complementary to Claude. Use when the user types /codex, says "hand this to Codex", "have Codex implement/do X", "delegate to Codex", "codex, work through this", or wants GPT-5.5 to execute a well-specified task. For adversarial code/plan REVIEW use /review or /premortem (those already call Codex read-only); this skill is for getting work DONE.
---

# /codex — Delegate a task to the Codex harness (gpt-5.5)

Hands an arbitrary request to OpenAI Codex on Dave's **ChatGPT subscription** (never an API key) to work through it. A different training family (GPT-5.5) executing the task gives cross-model leverage — Theo's "let Codex do the well-spec'd execution, keep Claude for orchestration" pattern, realized in CCv3. The read-only `codex-adversary` reviewer is untouched; this is its write-capable sibling.

**Safety contract:** `.claude/rules/codex-worker-safety.md` (confirm-first, sandbox-is-the-boundary, worktree isolation, review-gate). **Engine:** the `codex-worker` agent. **Cross-model review convention:** `.claude/rules/codex-adversarial.md`.

## When to Use

- `/codex <request>` — explicit invocation (primary path)
- "hand this to Codex", "have Codex implement …", "delegate this to Codex", "codex, work through …"
- You want GPT-5.5 to actually DO a well-specified task (implement, refactor, script, analyze), not critique one
- NOT for code/plan review → use `/review` / `/premortem` (they already run Codex read-only)

## Modes

| Mode | Invoke | Sandbox | Confirm? | Default effort | Writes land where |
|------|--------|---------|----------|----------------|-------------------|
| **ask** (default) | `/codex <question>` | `read-only` | no | xhigh | nowhere (answer only) |
| **implement** | `/codex --implement <task>` | `workspace-write` | **yes** (unless `--yes`) | high | isolated git worktree → you review the diff → apply/discard |
| **resume** | `/codex --resume <followup>` | inherits | yes | inherits | same worktree/thread |
| **review** (alias) | `/codex --review [base]` | read-only | no | xhigh | delegates to `codex-adversary` unchanged |

**Flags:** `--model gpt-5.5|gpt-5.4|gpt-5.4-mini` (default `gpt-5.5`; any `-codex` id is rejected — it 400s on the subscription). `--effort low|medium|high|xhigh`. `--yes` (skip the interactive confirm for orchestrator/Ralph use — still sandboxed, still logged, still produces a reviewable patch). `--complex` (multi_agent fan-out for genuinely BROAD ask/implement tasks — opt-in; requires `~/.codex/agents/explorer.toml` pinned to gpt-5.5 or it refuses; ~1,940 tok/call + fan-out latency; NOT re-applied on resume).

## Execution

### `ask` / `implement` / `resume` → spawn `codex-worker`

```
Task(
  subagent_type="codex-worker",
  prompt="""
  ## Mode
  ask | implement | resume

  ## Request
  [the user's task, verbatim + any clarifying context]

  ## Model
  gpt-5.5

  ## Effort
  [xhigh for ask, high for implement — or the user's --effort]

  ## Autonomy
  confirm            # or "yes" if the user passed --yes

  ## Complex
  false              # or "true" if the user passed --complex (multi_agent fan-out; ask/implement only)

  ## Scope           # resume only — the Codex session id (UUID) from the implement run's summary
  <SESSION_ID>       # leave EMPTY to fall back to --last (do NOT pass the literal "last")

  ## Worktree        # resume only — the worktree path from the implement run's summary
  <path>

  ## Codebase
  $CLAUDE_PROJECT_DIR
  """
)
```

For **implement**, the worker will surface the exact command + target worktree and (unless `--yes`) wait for your explicit go-ahead, run Codex with `workspace-write` inside a throwaway worktree, independently `git diff` the result, and show you the patch before anything touches your live working tree. Present that diff to the user; on approval the worker applies it, otherwise it discards and removes the worktree. The worker also returns the Codex **session id** and **worktree path** — pass both back on a later `--resume` so it continues the exact thread (robust under concurrency, unlike `--last`).

### `--review` → delegate to the existing reviewer

```
Task(
  subagent_type="codex-adversary",
  prompt="""
  ## Mode
  code
  ## Scope
  base ref: [BASE_REF, default main]
  ## Codebase
  $CLAUDE_PROJECT_DIR
  """
)
```
`/codex --review` is a convenience alias so users have one mental entry point (`/codex`) — it reuses `codex-adversary`'s carefully-tuned read-only flags, it does NOT reimplement review.

## Guardrails (summary — full text in `.claude/rules/codex-worker-safety.md`)

- **Subscription only.** The worker asserts `codex login status` = "Logged in using ChatGPT" and strips `OPENAI_API_KEY`/`CODEX_API_KEY` from Codex's env. Fails loud, never silently uses an API key.
- **Confirm-first for `implement`/`resume`** (the only approval gate — `codex exec` has none). `--yes` skips only the interactive pause.
- **Worktree isolation by default** — write runs happen in a throwaway git worktree **outside** the repo (sibling `../.codex-worktrees/<repo>-<ts>-<pid>`), never in-place, so they can't collide with your live session or the `file_claims` DB. (An `--in-place` mode was considered and **dropped** in v2 — worktree isolation is the retained safety win.)
- **Auto worktree GC** — before each implement run, stale *clean* worktree dirs (~190MB each) older than `$CODEX_WT_GC_DAYS` (default 7d) are reclaimed; a worktree with unreviewed (dirty) changes is never touched, so a dormant awaiting-`resume` one is safe. Manual sweep: `scripts/codex/gc-worktrees.sh`.
- **Review-gate** — never auto-commits/auto-merges; produces a patch you approve first.
- **Model allowlist** — `gpt-5.5/gpt-5.4/gpt-5.4-mini` only.
- **No hook can see inside Codex's sandbox** — enforcement is `--sandbox` + this preflight, not any Claude Code hook.
- **Usage-limit aware** — if the ChatGPT subscription quota is exhausted, `/codex` returns a clean "usage limit hit; resets ~<time>" message (never a fabricated result) and logs `usage_limited:true`. Detection is reactive — the subscription exposes no queryable quota surface to preflight.
- **`--complex` is gated** — multi_agent fan-out (ask/implement) runs only after asserting `~/.codex/agents/explorer.toml` pins gpt-5.5 (prevents the gpt-4.1 role-fallback 400); opt-in, never default, with a standing Windows re-probe caveat (openai/codex#19399).

## Examples

```
User: /codex how does the report-registry upsert dedupe by Run ID?
→ ask mode, read-only. Returns GPT-5.5's answer sourced from the clean -o capture. No confirm, no writes.

User: /codex --implement add a --limit flag to scripts/report-registry/query.mjs
→ implement mode. Shows the codex exec command + worktree path, waits for your OK,
  runs Codex with workspace-write in an isolated worktree, shows you the diff,
  applies it to your working tree on approval. Logs a telemetry row.

User: /codex --implement --complex refactor the report-registry pipeline end-to-end
→ implement + multi_agent fan-out (explorer/worker sub-agents on gpt-5.5). Asserts
  ~/.codex/agents/explorer.toml is pinned to gpt-5.5 first, prints the #19399 re-probe
  caveat, then the usual worktree + diff-review flow. For genuinely BROAD tasks; costs
  extra tokens + latency. Refuses if the explorer pin is missing.

User: /codex --resume also add a test for the new flag
→ continues the same Codex thread + worktree.

User: /codex --review main
→ runs the standard cross-model adversarial review (codex-adversary), read-only.
```

## Telemetry

One row per run → `.claude/logs/codex-worker.jsonl` (schema: `.claude/logs/codex-worker.README.md`). Distinct from `codex-lift.jsonl` (that logs review *lift* counts; this logs task *execution*).
