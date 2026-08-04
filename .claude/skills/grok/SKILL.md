---
name: grok
description: Hand a task to the xAI Grok Build CLI (grok-4.5, on the X Premium+ subscription — no API key) to WORK THROUGH — answer it, or actually implement it with write access — not just review. Cross-model execution, a third training family distinct from both Claude and GPT-5.5/Codex. Use when the user types /grok, says "hand this to Grok", "have Grok implement/audit X", "delegate to Grok", "grok, work through this", or wants Grok to execute a well-specified task. For adversarial code/plan REVIEW use /review or /premortem (those can already call Codex read-only; this skill's --review flag adds Grok); use this skill directly for getting work DONE.
---

# /grok — Delegate a task to the Grok Build CLI (grok-4.5)

Hands an arbitrary request to xAI Grok on the user's **X Premium+ subscription** (never an API key) to work through it. A third training family (Grok, distinct from both Claude and GPT-5.5/Codex) executing the task gives additional cross-model leverage on top of `/codex` — same "let the other model do well-spec'd execution, keep Claude for orchestration" pattern, now tri-model. The read-only `grok-adversary` reviewer is its sibling; this is the write-capable one.

**Roster position (Game Plan):** Grok is the **default milestone builder and researcher** — `/grok --implement` is the first choice for building workroom milestones, and the `research` role (live web/X, widened write-free allowlist per `grok-worker-safety.md`) feeds `research/` in the room. **Codex is the rostered reviewer/fixer** — Grok never grades its own build; the review booth is Codex + Claude critics. Doctrine: `.workroom/PROTOCOL.md`.

**Safety contract:** `.claude/rules/grok-worker-safety.md` (confirm-first, `--tools`-is-the-boundary, worktree isolation, review-gate, data-egress gate). **Engine:** the `grok-worker` agent.

## When to Use

- `/grok <request>` — explicit invocation (primary path)
- "hand this to Grok", "have Grok implement …", "delegate this to Grok", "grok, work through …"
- You want Grok to actually DO a well-specified task (implement, refactor, script, analyze), not critique one
- NOT for code/plan review as your ONLY need → use `--review` below (delegates to `grok-adversary`), or `/review`/`/premortem` for the full multi-model synthesis

## Modes

| Mode | Invoke | Guard | Confirm? | Writes land where |
|------|--------|-------|----------|-------------------|
| **ask** (default) | `/grok <question>` | `--tools "read_file,list_dir,grep"` | no (data-egress first-use-confirm still applies if content-bearing) | nowhere (answer only) |
| **implement** | `/grok --implement <task>` | full write toolset, worktree-isolated | **yes** (unless `--yes`) | isolated git worktree → you review the diff → apply/discard |
| **resume** | `/grok --resume <followup>` | inherits | yes | same worktree/session |
| **review** (alias) | `/grok --review [base]` | `--tools "read_file,list_dir,grep"` | no | delegates to `grok-adversary` unchanged |

**Flags:** `--model grok-4.5|grok-composer-2.5-fast` (default `grok-4.5`; both live-verified 2026-07-11 on `grok-cli 0.2.93`; any other id is rejected — unverified against this account). `--yes` (skip the interactive confirm for orchestrator/Ralph use — still worktree-isolated, still logged, still produces a reviewable patch).

## Execution

### `ask` / `implement` / `resume` → spawn `grok-worker`

```
Task(
  subagent_type="grok-worker",
  prompt="""
  ## Mode
  ask | implement | resume

  ## Request
  [the user's task, verbatim + any clarifying context]

  ## Model
  grok-4.5

  ## Autonomy
  confirm            # or "yes" if the user passed --yes

  ## Scope           # resume only — the Grok sessionId from the implement run's summary
  <SESSION_ID>

  ## Worktree        # resume only — the worktree path from the implement run's summary
  <path>

  ## Codebase
  $CLAUDE_PROJECT_DIR
  """
)
```

For **implement**, the worker will surface the exact command + target worktree and (unless `--yes`) wait for your explicit go-ahead, run Grok with a full write toolset inside a throwaway worktree (created because `-w/--worktree` is silently ignored by Grok headless), independently `git diff` the result, and show you the patch before anything touches your live working tree. Present that diff to the user; on approval the worker applies it, otherwise it discards and removes the worktree. The worker also returns Grok's **session id** and the **worktree path** — pass both back on a later `--resume`.

### `--review` → delegate to the existing reviewer

```
Task(
  subagent_type="grok-adversary",
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
`/grok --review` is a convenience alias so users have one mental entry point (`/grok`) — it reuses `grok-adversary`'s carefully-tuned `--tools` guard, it does NOT reimplement review.

## Guardrails (summary — full text in `.claude/rules/grok-worker-safety.md`)

- **Subscription only.** The worker asserts `grok models` shows "logged in" AND that `~/.grok/auth.json` `.email` equals `you@example.com` (wrong-account guard), and strips `XAI_API_KEY` from Grok's env. Fails loud, never silently uses an API key or the wrong account.
- **`--tools` is the ONLY working read-only boundary.** `--sandbox` is decorative on this CLI build (accepts any string, blocks nothing — live-probed) and `--permission-mode plan` does not block writes headless either. Ask mode always passes `--tools "read_file,list_dir,grep"`.
- **Confirm-first for `implement`/`resume`** (the only approval gate — `grok` has no approval dial). `--yes` skips only the interactive pause.
- **Worktree isolation by default** — `-w/--worktree` is silently ignored by Grok in headless mode, so write runs use the same hand-rolled out-of-repo worktree recipe as `/codex` (sibling `../.grok-worktrees/<repo>-<ts>-<pid>`), never in-place.
- **Auto worktree GC** — before each implement run, stale *clean* worktree dirs older than `$GROK_WT_GC_DAYS` (default 7d) are reclaimed; a worktree with unreviewed (dirty) changes is never touched.
- **Review-gate** — never auto-commits/auto-merges; produces a patch you approve first.
- **Model allowlist** — `grok-4.5` / `grok-composer-2.5-fast` only.
- **Data-egress gate** — every run auto-ingests `~/.claude/Claude.md` + all installed skills; content-bearing runs need a first-use-per-session confirmation naming xAI as destination, plus a secret-scan of the assembled prompt.
- **Usage-limit aware** — if the subscription quota is exhausted, `/grok` returns a clean "usage/rate limit hit" message (never a fabricated result) and logs `usage_limited:true`.

## Examples

```
User: /grok audit the CCv3 .claude system architecture and report what you find
→ ask mode, --tools read-only guard. Returns Grok's answer. No confirm (beyond the
  first-use data-egress note), no writes.

User: /grok --implement add a --limit flag to scripts/report-registry/query.mjs
→ implement mode. Shows the grok command + worktree path, waits for your OK,
  runs Grok with full write access inside an isolated worktree, shows you the diff,
  applies it to your working tree on approval. Logs a telemetry row.

User: /grok --resume also add a test for the new flag
→ continues the same Grok session + worktree.

User: /grok --review main
→ runs the standard cross-model adversarial review (grok-adversary), read-only.
```

## Telemetry

One row per run → `.claude/logs/grok-worker.jsonl` (schema: `.claude/logs/grok-worker.README.md`).
