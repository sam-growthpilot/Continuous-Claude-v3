# Grok Worker Safety Rules

Companion to `.claude/skills/grok/SKILL.md` and the `grok-worker`/`grok-adversary` agents. Sibling of `.claude/rules/codex-worker-safety.md` (same discipline, different verified surface) — the `/grok` worker hands a task to xAI's Grok Build CLI (`grok`, default `grok-4.5`) on Dave's **X Premium+ subscription** to actually execute — so it can write files and run commands. Treat every write mode with the same care as any destructive operation.

Grounding: verified 2026-07-11 against `grok-cli 0.2.93`, OAuth login via auth.x.ai (oidc). See `docs/grok-integration/DESIGN-RESEARCH.md` for the full evidence trail (all facts below are live-probed, not doc-sourced).

## The one thing to internalize

**`--tools` is the ONLY working read-only boundary — `--sandbox` and `--permission-mode` do NOT protect headless runs.** Live probe evidence: with no flags, `grok -p` created a file with zero approval prompt. `--permission-mode plan` still let the write through. `--sandbox strict` (and any arbitrary string) was accepted silently and the write still happened — `--sandbox` is **decorative/unvalidated** on this build. The only guard that actually blocked writes was `--tools "read_file,list_dir,grep"`: the model attempted a write 3 times, all failed, no file was created, and reads still worked. **Every ask-mode invocation MUST pass `--tools "read_file,list_dir,grep"`.** Every implement-mode write is only isolated by the hand-rolled worktree (see below) — there is no CLI-level write boundary to lean on there either.

## Auth: subscription only (verify FIRST)

- The worker asserts `grok models` output contains "logged in" before any run. If not → STOP, tell the user to run `grok login`. **Never** fall back to an API-key path.
- **Identity pin (wrong-account guard):** `jq -r 'to_entries[0].value.email' ~/.grok/auth.json` MUST equal `dkhayes44@gmail.com`. Never read `.key` or `.refresh_token` from that file.
- Every `grok` invocation is wrapped in `env -u XAI_API_KEY` — defensive, even though a live negative-control probe (`XAI_API_KEY=bogus-key-negative-control`) proved the CLI does NOT hijack auth from that env var (the run stayed on OAuth, exit 0).
- Never print `~/.grok/auth.json` contents, `XAI_API_KEY`, or any token/refresh-token field.

## Confirm-first matrix

| Mode | Guard | Confirmation |
|------|-------|--------------|
| `ask` | `--tools "read_file,list_dir,grep"` | **None** for the tool call — but the data-egress gate below still applies if the request carries repo content |
| `implement` | full write toolset, worktree-isolated | **Required every run** — show the exact `grok` command line, target worktree, model; wait for explicit approval. `--yes` skips ONLY the interactive pause, never the worktree, telemetry, or review step |
| `resume` | inherits the resumed session's worktree | Required |
| `grok-adversary` (review) | `--tools "read_file,list_dir,grep"` | **None** — read-only, matches the reviewer posture |

## Write-mode hard rules (`implement` / `resume`)

1. **Worktree isolation is the default, and worktrees live OUTSIDE the repo.** `-w/--worktree` is **silently ignored** by `grok` in headless `-p` mode (live-probed: `-w grok-probe` wrote directly into the live tree; `grok worktree list` showed nothing created). Isolation therefore reuses the codex-worker hand-rolled recipe: `git worktree add` in `$(dirname "$PROJECT")/.grok-worktrees/<repo>-<ts>-<pid>` — a SIBLING of the repo, never inside `$PROJECT`. The `-<pid>` suffix prevents same-second collisions.
2. **Git-clean note before creating a worktree.** A worktree branches from HEAD, not the working tree's uncommitted changes — if `git status --porcelain` is non-empty, warn the user those files are invisible to Grok.
3. **Independent verification, always.** After the run, the worker itself runs `git add -A && git diff --cached HEAD` in the worktree and shows that patch. Grok's own summary is never the sole evidence of what changed — this matters MORE for Grok than Codex, because Grok **can** run terminal commands in implement mode (`run_terminal_command` is a real, available tool) and its self-report of "I ran the tests and they passed" is therefore plausible-sounding but still unverified until the orchestrator checks independently.
4. **Review-gate — never auto-commit/auto-merge.** `implement` produces a patch the human reviews before it's applied to the working tree (`git apply --3way`). Defends against prompt-injection via any content Grok reads.
5. **`--cwd` scoping.** `--cwd` is set to the worktree path for implement/resume; it only works on the root command, not subcommands (`inspect`, `worktree` use process cwd).

## Worktree GC — reclaims only CLEAN abandoned worktrees

Before each `implement` run the worker opportunistically GCs stale worktree dirs in `../.grok-worktrees/`: `git worktree prune` + remove THIS repo's `<repo>-*` dirs older than `$GROK_WT_GC_DAYS` (default **7**). **It skips any worktree with uncommitted changes** — a dormant/awaiting-`resume` worktree holds UNREVIEWED work and is never reclaimed regardless of age. Reclaim is CONFIRMED-clean only: `git status --porcelain` must EXIT 0 AND be empty. Removal is ONLY via `git worktree remove --force` — no `rm -rf` anywhere in the auto path; an unregistered orphan is reported, never auto-deleted. Mirrors `scripts/codex/gc-worktrees.sh`'s rules exactly.

## Model allowlist (enforced before shelling out)

Hard-reject any `--model` not in `{grok-4.5, grok-composer-2.5-fast}` (both live-probed 2026-07-11 on `grok-cli 0.2.93`; ground truth `~/.grok/models_cache.json` via `grok models`). **Never add an id from docs, blog posts, or memory without a fresh `/harness-update grok` live probe on this exact account.** Comparison match must be case-sensitive.

## Data egress (real, ongoing — not optional)

`grok inspect` shows every `/grok` run **auto-ingests Dave's `~/.claude/Claude.md`** (~5,090 tokens), Claude Code's `settings.local.json` permissions, and **all installed Claude skills (292 at last count)** as context — on top of the prompt and whatever files the model reads. This context ships to xAI under Dave's account on every single invocation, not just content-bearing ones.

- **First-use-per-session confirmation.** Any run whose Request includes repo content, a diff, file paths to read, or anything beyond a bare generic question requires an explicit user confirmation naming xAI as the destination, the first time in a session. Skippable on repeat calls in the SAME session only when Autonomy=`yes` and the session already confirmed once.
- **Secret-scan every assembled prompt file** before sending: `grep -Ei 'api[_-]?key|token|secret|BEGIN[A-Z ]*PRIVATE KEY'`. On any hit, STOP — do not send, report the match location.
- **Never reference or read `.env*` files** as part of a Grok prompt/context.
- `--verbatim`, `--rules`, `--system-prompt-override` exist as shaping levers if a future probe finds a way to suppress the auto-ingestion — unverified as of 2026-07-11, do not assume they change egress behavior without a probe.

## Windows / CLI hygiene

- **Always feed the prompt from a file** via `--prompt-file <PATH>` — Grok's native prompt-from-file flag, no stdin-redirection tricks needed (unlike Codex's `- < file`).
- **`grok worktree <cmd>` requires `$HOME`** — verified: errors `neither $GROK_HOME nor $HOME is set` under a shell where HOME is unset (e.g. the PowerShell tool). Worker sets `HOME="${HOME:-$USERPROFILE}"` defensively; run from Bash where HOME is normally set.
- **`--cwd` is accepted by the root command only** — subcommands (`inspect`, `worktree`) use the process cwd regardless.
- **Rely on an external timeout** (Bash-tool timeout), not Grok's own — no self-termination guarantee has been probed on this CLI.

## Version drift

Installed CLI is `0.2.93` (verified 2026-07-11). **The CLI auto-updates** — it moved 0.2.82 → 0.2.93 between sessions with no explicit action taken. Version-stamp every verified claim; re-probe via `/harness-update grok` on any version change before trusting new flags or model ids. `grok update` can pin/install a specific version if a rollback is needed.

## Cost / quota (subscription, not dollars)

Subscription-gated (X Premium+); no per-token invoice observed in this pass. No quota surface was found in the CLI (mirrors Codex: detection is reactive). On non-zero exit, grep the log/json output for `rate.?limit|usage limit|quota`; on a hit, produce no result, never fabricate one, and record `usage_limited:true` in telemetry.

## Quick decision table

| Pattern | Confirm? |
|---------|----------|
| `/grok <question>` (ask) | No (data-egress first-use-confirm still applies if content-bearing) |
| `/grok --implement …` (write, worktree) | **Yes** (unless `--yes`) |
| `/grok --resume …` (implement thread) | Yes |
| `/grok --review …` (delegates to grok-adversary) | No (read-only) |
| Applying the worktree patch to the live tree | **Yes** — human reviews the diff first |
| `git branch -D grok/<ts>` cleanup (interactive) | Yes (destructive-commands rule) |
| Passing `-w/--worktree` expecting isolation | **Never** — silently ignored headless; use the hand-rolled worktree only |
| Trusting `--sandbox <anything>` as a safety boundary | **Never** — decorative on this build, verified to block nothing |
