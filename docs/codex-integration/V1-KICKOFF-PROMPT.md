# v1 Kickoff Prompt

Paste the block below into a fresh Claude Code session (in the `continuous-claude` repo) to start v1.

---

We're continuing the CCv3 Codex integration. **v0** of the `/codex` worker is shipped (PR #15 on `upstream/Continuous-Claude-v3`, branch `feature/codex-worker`). Your job is **v1**.

**Orient yourself first (do this before any edits):**
1. Read `docs/codex-integration/V1-HANDOFF.md` (your task brief) and skim `docs/codex-integration/DESIGN-RESEARCH.md` §3 (verified CLI surface), §7 (phased plan), §10 (dogfood findings).
2. Recall memory: `/recall codex worker` (see memory file `codex-worker-v0`).
3. Confirm environment: `codex --version` (expect `0.131.0`) and `codex login status` (expect "Logged in using ChatGPT"; `OPENAI_API_KEY`/`CODEX_API_KEY` must be unset).
4. Check git: `git -C . status` and whether PR #15 merged. If still open, continue on `feature/codex-worker`; if merged, branch `feature/codex-worker-v1` off `main` (do NOT work on main).

**Then implement v1 (full detail + acceptance criteria in V1-HANDOFF.md):**
- **A) Session-id capture for robust `resume`** — capture the Codex session id from the implement turn's `--json` stream (verify the event name/field on 0.131.0 first) and use it for `resume` instead of cwd-scoped `--last`; record it in telemetry.
- **B) Startup-latency speedup** — a worker config profile that mutes the ~16 MCP servers for worker calls only, cutting the ~120–180s startup tax (verify the exact `--profile` flag on 0.131.0 first; measure before/after).
- Plus the low-effort cleanups: telemetry enum conformance + git-clean "excluded files" list.

**Hard constraints — do NOT regress (from the v0 dogfood):** Windows `workspace-write` sandbox blocks Codex subprocess launches, so YOU must run changed code (not just syntax-check); `codex exec resume` takes NO `--sandbox`/`-C` (cd into the worktree); worktrees live OUTSIDE the repo; model allowlist `gpt-5.5/gpt-5.4/gpt-5.4-mini`; `--disable multi_agent` default; subscription-only (no API key).

**Process:** these are `.md`/`.toml` changes (plan-to-ralph won't block). **Dogfood every change** through the live `codex-worker` agent + an adversarial judge (reuse the v0 `codex-worker-dogfood` workflow pattern). Re-sync to active after editing, verify with real runs before claiming done. Ultracode is expected — use workflows for research/verify.
