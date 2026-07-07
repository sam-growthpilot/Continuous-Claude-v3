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

**Flags:** `--model gpt-5.5|gpt-5.4|gpt-5.4-mini` (default `gpt-5.5`; any `-codex` id is rejected — it 400s on the subscription). `--effort low|medium|high|xhigh`. `--yes` (skip the interactive confirm for orchestrator/Ralph use — still sandboxed, still logged, still produces a reviewable patch). `--complex` (multi_agent — **v2, not yet available**).

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

  ## Scope           # resume only
  last | <SESSION_ID>

  ## Codebase
  $CLAUDE_PROJECT_DIR
  """
)
```

For **implement**, the worker will surface the exact command + target worktree and (unless `--yes`) wait for your explicit go-ahead, run Codex with `workspace-write` inside a throwaway worktree, independently `git diff` the result, and show you the patch before anything touches your live working tree. Present that diff to the user; on approval the worker applies it, otherwise it discards and removes the worktree.

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
- **Worktree isolation by default** — write runs happen in `.codex-worktrees/<ts>` (gitignored), never in-place, so they can't collide with your live session or the `file_claims` DB. (`--in-place` is a v2 opt-in.)
- **Review-gate** — never auto-commits/auto-merges; produces a patch you approve first.
- **Model allowlist** — `gpt-5.5/gpt-5.4/gpt-5.4-mini` only.
- **No hook can see inside Codex's sandbox** — enforcement is `--sandbox` + this preflight, not any Claude Code hook.

## Examples

```
User: /codex how does the report-registry upsert dedupe by Run ID?
→ ask mode, read-only. Returns GPT-5.5's answer sourced from the clean -o capture. No confirm, no writes.

User: /codex --implement add a --limit flag to scripts/report-registry/query.mjs
→ implement mode. Shows the codex exec command + worktree path, waits for your OK,
  runs Codex with workspace-write in an isolated worktree, shows you the diff,
  applies it to your working tree on approval. Logs a telemetry row.

User: /codex --resume also add a test for the new flag
→ continues the same Codex thread + worktree.

User: /codex --review main
→ runs the standard cross-model adversarial review (codex-adversary), read-only.
```

## Telemetry

One row per run → `.claude/logs/codex-worker.jsonl` (schema: `.claude/logs/codex-worker.README.md`). Distinct from `codex-lift.jsonl` (that logs review *lift* counts; this logs task *execution*).
