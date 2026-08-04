# /codex — v1 Handoff Brief

**For:** a fresh session picking up v1 of the CCv3 Codex worker.
**Created:** 2026-07-07. **Author:** the v0 build+dogfood session.
**Companion docs:** `DESIGN-RESEARCH.md` (§3 verified CLI surface, §7 phased plan, §8 open decisions, §10 dogfood findings, **§11 v1 build findings**) · `.claude/rules/codex-worker-safety.md` · memory `codex-worker-v0`.

---

## ✅ v1 SHIPPED (2026-07-07) — evidence in DESIGN-RESEARCH §11

- **Item A (session-id capture):** DONE + live-verified. `--json` first event is `{"type":"thread.started","thread_id":"<uuid>"}` (field is `thread_id`, not `session_id`). Captured in implement/resume, threaded into `resume <id>` + telemetry (`scope:"resume:<id>"`, `session_id`). Acceptance proven: resume-by-id hits the exact thread even with a newer intervening session; `--last` hits the wrong (most-recent) one.
- **Item B (startup latency):** DONE + benchmarked — but **the planned `--profile-v2 worker` was empirically REFUTED** (overlay deep-merges, can't mute MCP). Replaced with **`--ignore-user-config`**: ~47s→18s, MCP-fails 6→2, no machine-local file. On every worker `codex exec`/`resume`.
- **Cleanups:** DONE — telemetry one-row-per-turn + enum-only `mode`/`scope`/`verification` + `session_id`; git-clean "excluded from worktree" list in the summary.

The scope detail below is the original brief (retained for context).

---

## Where things stand (v0 = DONE)

`/codex` is a live, hardened, write-capable Codex task worker on the user's ChatGPT subscription (no API key). Shipped in **PR #15** (`upstream/Continuous-Claude-v3`, branch `feature/codex-worker`, commit `12a21dd`).

- **Skill:** `.claude/skills/codex/SKILL.md` — `/codex` with modes ask / implement / resume / `--review` alias.
- **Agent (engine):** `.claude/agents/codex-worker.md` — preflight → invoke `codex exec` → capture (`-o`) → independent verify → telemetry.
- **Safety rule:** `.claude/rules/codex-worker-safety.md`.
- **Telemetry:** `.claude/logs/codex-worker.jsonl` (schema in `.README.md`).
- **Verified:** all 3 modes run; worktree isolation airtight; subscription-only; hooks-collision spike RESOLVED (`~/.codex/hooks.json` does not collide under `codex exec`).

## Hard constraints carried from the v0 dogfood — do NOT regress

1. **Windows `workspace-write` sandbox blocks ALL subprocess launches** (`CreateProcessAsUserW failed: 5`). Codex can create/edit files but cannot run git/node/tests inside its sandbox → it writes code **blind**. **The orchestrator MUST actually run changed code** (not just `node --check`) before presenting it.
2. **`codex exec resume` takes NO `--sandbox`/`-C`** — inherits cwd+sandbox; `cd` into the worktree, don't pass `-C`. Passing `--sandbox` errors RC=2.
3. **Worktrees live OUTSIDE the repo** — sibling `$(dirname "$PROJECT")/.codex-worktrees/<repo>-<ts>-<pid>`. An in-repo worktree pollutes the skill list (~150 dup path-scoped skills) + 190MB checkout.
4. **Model allowlist `{gpt-5.5, gpt-5.4, gpt-5.4-mini}`** — any `-codex` id 400s on the subscription. **`--disable multi_agent`** on every call (gpt-4.1 fallback trap + token tax). **Subscription-only** (`env -u OPENAI_API_KEY -u CODEX_API_KEY`, assert `codex login status` = "Logged in using ChatGPT").
5. **Stdin from a file** (`- < "$FILE"`), never a TTY (Windows hang). **`-o`** clean-capture is mandatory.

---

## v1 scope — two items

### Item A — Session-id capture for robust `resume`

**Problem.** `resume` currently uses `codex exec resume --last`, which is **cwd-scoped global "most recent"** state. Under concurrency (another `codex` run between an implement turn and its resume — likely under Ralph / parallel use) `--last` targets the wrong session.

**Fix.** Capture the real Codex session id from the **implement turn's `--json` event stream** and thread it through:
- Parse the session id from the implement turn's `--json` stdout. Internal-B reported the id is on the **`thread.started`** event — **verify the exact event name + field on 0.131.0** first (run a tiny `codex exec --json` and inspect the JSONL). (Parsing Codex's own `--json` stdout is NOT a subprocess, so the Windows sandbox block does not apply.)
- Use it in resume: `codex exec resume <SESSION_ID> …` instead of `--last`.
- Record it in telemetry `scope: "resume:<id>"` (the README schema already anticipates this format).

**Files:** `.claude/agents/codex-worker.md` (Step 3b: capture id from `--json`; Step 3c: use `SESSION_ID`; Step 4: telemetry scope) · `.claude/skills/codex/SKILL.md` (resume flow) · `.claude/logs/codex-worker.README.md` (scope enum note).

**Acceptance:** implement turn → run an *unrelated* `codex exec` in between → `resume <captured-id>` still continues the correct thread (whereas `--last` would not). Show the evidence.

### Item B — Startup-latency speedup (worker profile)

**Problem.** Each `codex exec` is ~120–180s, dominated by **startup noise** (≈16 MCP-server connection attempts + a large `~/.agents/skills/` YAML scan), NOT model work.

**Fix.** A worker-scoped config that mutes the noise for worker calls only, leaving the user's interactive `~/.codex/config.toml` untouched:
- Create `~/.codex/worker.config.toml` (or a `[profiles.worker]` block) that sets **no MCP servers** (empty `[mcp_servers]`) + keeps `model=gpt-5.5`, `model_reasoning_effort`, `multi_agent=false`.
- Pass the profile on every worker `codex exec`. **Verify the exact flag on 0.131.0** — `codex exec --help` (candidates: `--profile <name>` / `-p`; the design doc §5.3 wrote `--profile-v2 worker` speculatively — CONFIRM before wiring).
- The `~/.agents/skills/` YAML scan is a *separate* source from MCP (see `codex-adversarial.md` "Startup Noise") — measure how much each contributes; the profile likely cuts MCP but not the skill scan. Do NOT delete the `.agents/skills` mirror blindly (unknown provenance — investigate what regenerates it first).

**Files:** new `~/.codex/worker.config.toml` (machine-local; document it in the safety rule) · `.claude/agents/codex-worker.md` (add the profile flag to every invocation) · `.claude/rules/codex-worker-safety.md` (document the profile).

**Acceptance:** wall-clock before/after on an `ask` smoke; the ≈16 MCP-connection error lines gone from the `-o`/log; a measured latency drop. Record the numbers.

### Also-worth-doing in v1 (deferred from §10, low effort)

- **Telemetry enum conformance:** the emit must use the documented `mode`/`scope`/`verification` enums and log **one row per turn** (the dogfood's combined `implement+resume` emitted non-enum values). Fix in `codex-worker.md` Step 4 + reconcile with the README.
- **Git-clean "excluded files" list:** upgrade the Step 3b git-clean note from a warning into an explicit "excluded from this worktree: <files>" line in the returned summary.

---

## How to work v1 (process)

- These are **agent-doc + config (`.md`/`.toml`) changes**, not TS — the plan-to-ralph enforcer won't block them.
- **Dogfood every change** through the live `codex-worker` agent, exactly like the v0 session did — see the reusable workflow pattern (`codex-worker-dogfood`): run the real agent + an adversarial judge that inspects real state. Ultracode: use workflows for the verify/research parts.
- **Re-sync to active** after editing (`bash scripts/sync-to-active.sh`, or commit → post-commit auto-sync — note the incremental sync only picks up *committed* changes; targeted `Copy-Item` for uncommitted, as v0 did).
- **Verify with real runs** before claiming done; a timed-out codex call (exit 143) is not proof of failure — check state.
- Branch: if PR #15 is still open, continue on `feature/codex-worker`; if merged, branch `feature/codex-worker-v1` off `main` (never work on `main`).

## Kickoff prompt

The exact prompt to paste into the fresh session is in `V1-KICKOFF-PROMPT.md` (same folder).
