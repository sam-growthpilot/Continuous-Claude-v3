# Codex Worker Safety Rules

Companion to `.claude/skills/codex/SKILL.md` and the `codex-worker` agent. This is the **write-capable** sibling of `.claude/rules/codex-adversarial.md` (which stays read-only, review-only). Different safety posture → separate rule. The `/codex` skill hands a task to the OpenAI Codex harness (`gpt-5.5`) on Dave's **ChatGPT subscription** to actually execute — so it can write files and run commands. Treat every write mode with the same care as any destructive operation.

Grounding: verified 2026-07-06 against `codex-cli 0.131.0`, `Logged in using ChatGPT`. See `docs/codex-integration/DESIGN-RESEARCH.md` for the full evidence trail.

## The one thing to internalize

**`codex exec` has no approval dial, and no Claude Code hook can see inside Codex's sandboxed process.** The `codex exec …` command line itself passes through `destructive-command-guard` like any Bash call (and isn't itself a destructive pattern, so it's allowed), but everything Codex does *inside* its sandbox — every file write, every shell command — is invisible to Claude Code's hook layer. **The entire safety boundary is `--sandbox` + this rule's confirm-first preflight.** There is no second line of defense. Choose the sandbox deliberately and confirm write runs.

## Auth: subscription only (verify FIRST)

- The worker asserts `codex login status` reports **"Logged in using ChatGPT"** before any run. If not → STOP, tell the user to run `codex login`. **Never** fall back to an API-key path.
- Every `codex exec` is wrapped in `env -u OPENAI_API_KEY -u CODEX_API_KEY` — a repo-controlled or job-level env var must not silently switch auth to a paid API key.
- Never print `~/.codex/auth.json`, `OPENAI_API_KEY`, or `CODEX_API_KEY`.

## Confirm-first matrix

| Mode | Sandbox | Confirmation |
|------|---------|--------------|
| `ask` | `read-only` | **None** — read-only, matches the reviewer posture |
| `implement` | `workspace-write` | **Required every run** — show the exact `codex exec` command line, target worktree, model+effort; wait for explicit approval. `--yes` skips ONLY the interactive pause (for orchestrator/Ralph), never the sandbox, telemetry, or review step |
| `resume` | inherits the resumed session's sandbox (resume takes NO `--sandbox`/`-C` — `cd` into the worktree) | Required if resuming an `implement` thread |
| `danger-full-access` | none | **Not used by this agent.** If ever needed, confirm-first, never default, identical posture to `--dangerously-bypass-approvals-and-sandbox` |

## Write-mode hard rules (`implement` / `resume`)

1. **Worktree isolation is the default, and worktrees live OUTSIDE the repo.** Writes happen in `$(dirname "$PROJECT")/.codex-worktrees/<repo>-<ts>-<pid>` — a throwaway git worktree branched from HEAD, a SIBLING of the repo, **never inside `$PROJECT`** and never in-place against the live tree. This structurally prevents collision with the concurrent Claude Code session's edits and the `file_claims` DB. **Out-of-repo is mandatory (verified 2026-07-07 dogfood):** an in-repo worktree makes Claude Code re-scan the whole `.claude/skills` tree as ~150 duplicate path-scoped skills (context pollution) and is a ~190MB full checkout. The `-<pid>` suffix prevents same-second name collisions. (`--in-place` is a deferred v2 opt-in, still confirm-gated.)
2. **Git-clean note before creating a worktree.** A worktree branches from HEAD, not the working tree's uncommitted changes — if `git status --porcelain` is non-empty, warn the user that Codex won't see those pending edits.
3. **Independent verification, always.** After the run, the worker itself runs `git add -A && git diff --cached HEAD` in the worktree and shows that patch. Codex's own summary is never the sole evidence of what changed (RULES.md "External Verification").
4. **Review-gate — never auto-commit/auto-merge.** `implement` produces a patch the human reviews before it's applied to the working tree (`git apply --3way`). This is the strongest cross-source consensus in the research: it defends against prompt-injection via any content Codex reads (commit messages, issue text, fetched web content).
5. **Writable-root scoping.** `-C` is always the worktree path. `--add-dir` only for genuinely shared scratch space, never the live repo root, in v0/v1.
6. **Network stays off.** `workspace-write` keeps network access `false` by default. Enabling it requires an explicit flag + confirm (prompt-injection risk via fetched content).

## Model allowlist (enforced before shelling out)

Hard-reject any `--model` not in `{gpt-5.5, gpt-5.4, gpt-5.4-mini}`, citing the verified evidence: `gpt-5.2-codex` and `gpt-5.5-codex` both return byte-identical HTTP 400 ("model is not supported when using Codex with a ChatGPT account") on this account. Treat ANY future `-codex`-suffixed id as unverified-until-tested against this exact account, regardless of what the docs' model table says.

## multi_agent

`--disable multi_agent` on every call by default. Global config has `[features] multi_agent = true`; leaving it on makes a complex task spawn built-in explorer/worker sub-agents that fall back to `gpt-4.1` (400 on subscription) and adds ~1,940 tokens/call even unused. The **`--complex` opt-in** (ask/implement; NOT resume) swaps in `--enable multi_agent`, but the agent HARD-REQUIRES `~/.codex/agents/explorer.toml` to pin `model = "gpt-5.5"` FIRST — else it refuses (the pin mitigates the gpt-4.1 role-fallback 400; openai/codex #19399 / #16893). Standing caveat printed every `--complex` run: the pin was verified ONCE on Windows 2026-07-07 — **re-probe before trusting `--complex` unattended** (#19399: subagent TOML can be ignored on Windows). Confirm-gated like any write (implement already confirms); on read-only ask the explicit flag + printed caveat is the acknowledgment.

## Startup profile — `--ignore-user-config` (latency, v1)

Every worker `codex exec`/`resume` passes **`--ignore-user-config`**. It skips loading Dave's interactive `~/.codex/config.toml` (which defines ~16 MCP servers whose network handshakes dominate cold-start), cutting a read-only smoke **~47s → ~18s** and removing the config-defined MCP connection-failure noise (verified 2026-07-07 v1 benchmark; 2 residual failures remain, sourced from plugins/runtime, not `config.toml`).

- **Auth is NOT affected.** `--ignore-user-config` still reads `CODEX_HOME`/`auth.json` (the flag's own doc guarantee; the benchmark ran rc=0 on the subscription). The model / `model_reasoning_effort` / `multi_agent=false` the worker needs are passed as explicit CLI flags regardless, so nothing worker-relevant is dropped.
- **Tradeoff to know:** Codex's shell also loses the base config's `shell_environment_policy.set` extras (e.g. `DATABASE_URL`, `CLAUDE_OPC_DIR`). Moot on Windows where `workspace-write` cannot spawn subprocesses anyway; if a specific task needs one, add `-c shell_environment_policy.set.KEY=VALUE` for that call.
- **Refuted alternative (do NOT use):** the design-doc §5.3 `--profile-v2 worker` + `~/.codex/worker.config.toml` overlay was **empirically refuted 2026-07-07** — overlay layering deep-merges, so an empty `[mcp_servers]` (or `-c mcp_servers={}`) does NOT remove the base MCP servers (MCP-fail count unchanged from baseline). No machine-local `worker.config.toml` is created; `--ignore-user-config` is self-contained and portable across machines.

## Windows / CLI hygiene

- **Always feed the prompt from a file** via `- < "$PROMPT_FILE"`, never an inherited TTY (hang bug openai/codex#20919). Same universal rule as `ntn` (`.claude/rules/notion-cli-safety.md`).
- **Rely on an external timeout** (the Bash-tool timeout or `timeout` wrapper), not Codex's own — documented Windows stall bugs (#18983, #20200) mean Codex doesn't reliably self-terminate a stuck run.
- **`-o <file>` is the mandatory clean-output contract** — it strips the ~100+ lines of startup noise (skill-YAML load errors, MCP auth failures, hook lines). Parse findings/answers from the `-o` file, fall back to the full log's post-`codex`-sentinel text only if `-o` is empty.
- **`workspace-write` sandbox blocks subprocess launches on Windows** (`CreateProcessAsUserW failed: 5`, verified 2026-07-07 dogfood). Codex can create/edit files but CANNOT run `git`/`node`/tests inside its own sandbox — it writes code BLIND and self-reports done without executing it. The orchestrator's out-of-sandbox verification is the ONLY verification, and it must actually **run** changed runnable code, not just `node --check` (syntax-check missed a real `spawnSync`-ENOENT bug in dogfooding).
- **`codex exec resume` takes no `--sandbox`/`-C`** — it inherits the resumed session's cwd + sandbox; `--last` is cwd-scoped, so `cd` into the worktree, don't pass `-C`. Passing `--sandbox` errors RC=2. Prefer capturing + reusing the explicit Codex session id (v1) over cwd-scoped `--last`.

## Version drift

Installed CLI is `0.131.0`; upstream is newer (`0.142.x`). Official docs describe `--full-auto`/`--ask-for-approval` on `exec` that **do not exist in 0.131.0**. Code against the installed surface. Any CLI upgrade must re-run the verification in `docs/codex-integration/DESIGN-RESEARCH.md` §3 before trusting new flags.

## Cost / quota (subscription, not dollars)

There is no per-call dollar price — the cost is ChatGPT-subscription quota (two clocks: a rolling 5-hour message window + a separate weekly cap; the 5h meter can look healthy while the weekly cap is exhausted). A multi-file `gpt-5.5` implement run can be a meaningful fraction of a Plus-tier weekly allowance, and a known unresolved regression (openai/codex#28879) inflates per-token cost for some accounts. The telemetry log records per-run usage so a weekly total can be reconstructed.

**Usage-limit handling (v2, reactive).** A quota **preflight** is impossible — `codex doctor --json` exposes no usage/quota surface (only `checks`/`codexVersion`/`generatedAt`/`overallStatus`/`schemaVersion`; verified 2026-07-07). Detection is **reactive**: the worker greps every run's log for `You've hit your usage limit … try again at <time>` (present in all modes — the `-o` clean file is EMPTY on a cap hit, and the run exits non-zero), returns a clean "usage limit hit; resets ~<time>" message instead of a fabricated result, and records `usage_limited:true` + the non-zero exit in telemetry. Implement/resume additionally skip verify/apply (no changes exist) and remove the worktree.

## Hooks-collision question — RESOLVED (spike, 2026-07-07)

`~/.codex/hooks.json` mirrors ~40 CCv3 hooks (git-auto-commit, sync-to-repo, file-claims, ralph enforcers) pointing at `~/.codex/hooks/dist/*.mjs`. The open question was whether these fire under non-interactive `codex exec`, risking double-commits / `file_claims` collisions. **Spike verdict: on this Windows host they do NOT cause commit/`file_claims` collisions.** In a throwaway git fixture, a `codex exec --sandbox workspace-write` write run: (a) created the file but did NOT auto-commit — commits stayed `1→1`, the file remained `?? untracked` → git-auto-commit did NOT fire; (b) left `file_claims` unchanged (`7481→7481`, zero fixture rows) → file-claims did NOT fire. Only Codex's OWN `SessionStart`/`UserPromptSubmit` hooks fired (mostly "Failed"), with no PostToolUse git/DB side effects — consistent with the community finding that `unified_exec` doesn't fire `PreToolUse`/`PostToolUse` hooks, reinforced by the Windows `workspace-write` subprocess block. This was the WORST case (in-place, NOT worktree-isolated) and still showed no collision, so worktree-isolated `implement` is doubly safe (hooks don't fire to collide, and the worktree is isolated regardless). **Re-verify after any Codex CLI upgrade or `~/.codex/hooks.json` change** (one fixture, one run).

## Quick decision table

| Pattern | Confirm? |
|---------|----------|
| `/codex <question>` (ask, read-only) | No |
| `/codex --implement …` (workspace-write, worktree) | **Yes** (unless `--yes`) |
| `/codex --resume …` (implement thread) | Yes |
| `/codex --review …` (delegates to codex-adversary) | No (read-only) |
| Applying the worktree patch to the live tree | **Yes** — human reviews the diff first |
| `git branch -D codex/<ts>` cleanup (interactive) | Yes (destructive-commands rule) |
| Enabling network / `danger-full-access` / `--complex` | **Yes**, never default |
