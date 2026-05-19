# Codex Adversarial Review Rules

OpenAI Codex (default `gpt-5.5 @ xhigh`; override via `CODEX_ADVERSARY_MODEL` env var; requires `@openai/codex` CLI >= 0.131) is wired into CCv3 as a **cross-model adversarial reviewer** via:
- `codex-plugin-cc` plugin (slash commands `/codex:*`)
- `codex-adversary` agent (used by `/review` and `/premortem`)
- `plan-exit-premortem-prompt` hook (auto-offers `/premortem` after every approved plan)

## When Codex Review Fires (default behavior)

| Trigger | Codex involvement |
|---------|-------------------|
| `/review` | codex-adversary runs in parallel Phase 1 alongside critic and plan-reviewer |
| `/premortem` | Codex adversarial pass after the inline failure-mode imagining step |
| After `ExitPlanMode` | AskUserQuestion offers `/premortem` (which includes Codex pass) |
| Manual: `/codex:adversarial-review --base <ref>` | One-shot review on demand |
| Manual: `/codex:review` | Standard (non-adversarial) review |

## When to Skip Codex

Use `--no-codex` on `/review` and `/premortem` for:
- Doc-only changes (.md, .json comments) - waste of Codex quota
- Hotfixes where latency matters more than depth
- Trivial diffs (<20 lines, single-file, no logic change)
- When the user has already explicitly burned through Codex quota this session

## Safe Commands (no confirmation needed)

- `codex login status` (check auth state without re-prompting)
- `codex --version`, `codex --help`
- `codex exec` with `--sandbox read-only`
- `/codex:review`
- `/codex:adversarial-review`
- `/codex:status`, `/codex:result`, `/codex:cancel`

## Confirm-First Commands (ALWAYS ask user)

Before running ANY of these, explain what it does and wait for explicit user approval:

- `/codex:rescue` - delegates *execution* of a task to Codex. Large blast radius, can modify files.
- `codex exec` with `--sandbox workspace-write` or `--sandbox danger-full-access`
- `codex exec --dangerously-bypass-approvals-and-sandbox`
- `/codex:setup --enable-review-gate` - **DO NOT enable**. Documented as high-cost (drains ChatGPT Codex quota), high-latency (900s timeout per turn), high-risk on Windows.

## Auth Model

Codex authenticates via OAuth against Dave's ChatGPT subscription (Plus/Pro). Quota usage counts against that subscription, not against an OpenAI API key. There is no separate API billing - if `codex auth status` shows a logged-in ChatGPT account, every adversarial-review call is on the subscription.

## Cost Awareness

Each `codex-adversary` invocation:
- Spends one Codex turn at gpt-5.5 (default) or whatever `CODEX_ADVERSARY_MODEL` resolves to, at xhigh reasoning
- Latency: typically 30-90 seconds for code review, 45-120 seconds for plan review
- xhigh reasoning is the expensive setting - we picked it because adversarial review needs depth

A typical `/review` run with codex enabled = 1 Codex call. A typical `/premortem` with codex enabled = 1 Codex call. The auto-prompt hook only OFFERS premortem - doesn't auto-run it.

## Synthesis Convention

When `review-agent` synthesizes Phase 1 findings, codex-adversary output is treated as a **distinct cross-model input source**, NOT pooled with critic's findings. Prefix Codex findings with `[Codex]` in synthesis output so cross-model agreement is visible at a glance.

Findings that BOTH critic and codex-adversary flag are high-confidence - the cross-model lift is exactly the findings only one side catches.

## Integration Files

| File | Role |
|------|------|
| `.claude/agents/codex-adversary.md` | Agent definition - calls `codex exec` |
| `.claude/skills/review/SKILL.md` | Spawns codex-adversary in Phase 1 |
| `.claude/skills/premortem/SKILL.md` | Spawns codex-adversary --mode=plan |
| `.claude/hooks/src/plan-exit-premortem-prompt.ts` | Auto-prompts user to run /premortem after ExitPlanMode |
| `~/.claude/plugins/cache/.../codex-plugin-cc/.../prompts/adversarial-review.md` | Upstream adversarial system prompt (referenced by codex-adversary agent) |
