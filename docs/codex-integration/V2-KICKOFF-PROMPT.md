# /codex v2 — Kickoff Prompt

Paste into a fresh session to build v2 of the CCv3 Codex worker.

---

We're continuing the CCv3 Codex integration. `/codex` v0 + v1 are shipped and merged to `main` (PR #15 → `e10cd5f`). Your job is **v2** — the recon is done and the scope is approved (lean high-value set; `--in-place` skipped).

**Orient first (before any edits):**
1. Read `docs/codex-integration/V2-HANDOFF.md` (your task brief — 4 items, hard constraints, Step 0 gates). Skim `DESIGN-RESEARCH.md` §11 (v1 findings) and the safety rule `.claude/rules/codex-worker-safety.md`.
2. Recall memory: `/recall codex worker` (file `codex-worker-v0`).
3. Confirm environment: `codex --version` (0.131.0), `codex login status` ("Logged in using ChatGPT"; `OPENAI_API_KEY`/`CODEX_API_KEY` unset).
4. **Quota gate:** the subscription usage limit was hit during recon on 2026-07-07 (reset ~1:08 PM). Run a tiny `ask` smoke to confirm quota is back before any codex-dependent step.
5. Branch off `main`: `feature/codex-worker-v2` (never `main`).

**Step 0 (do first):**
- Run `/premortem` on `docs/codex-integration/V2-HANDOFF.md` (Codex cross-model pass) — after quota reset.
- Resolve the one unverified interaction (Item 1): does `--enable multi_agent` still honor `~/.codex/agents/explorer.toml` when combined with the worker's default `--ignore-user-config`? Probe it live. If the explorer 400s on gpt-4.1 or doesn't spawn → `--complex` must drop `--ignore-user-config`.

**Then build the 4 items** (full detail + acceptance in V2-HANDOFF.md):
- **Item 1** — `--complex` opt-in (multi_agent; explorer.toml pin verified viable, standing #19399 caveat).
- **Item 2** — reactive usage-limit handling (detect the runtime error; preflight isn't buildable — `codex doctor --json` has no quota surface).
- **Item 3** — worktree GC automation (v1 deferral).
- **Item 4** — doc sweep (DESIGN-RESEARCH §5.3/§7 stale in-repo-gitignore refs).

**Hard constraints — do NOT regress** (from v0/v1): model allowlist gpt-5.5/5.4/5.4-mini; subscription-only (`env -u`); worktrees OUTSIDE the repo; `resume` takes no `--sandbox`/`-C` and prefers the captured UUID over `--last`; Windows `workspace-write` blocks subprocesses so YOU run changed code; stdin-from-file + `-o` + external timeout; **`--ignore-user-config` is `ask`-ONLY** (v2 correction: it silently breaks Windows workspace-write, so implement/resume keep the config path — see DESIGN-RESEARCH §12).

**Process:** `.md`/`.toml`/`.sh` changes (plan-to-ralph won't block). Dogfood every change through the live `codex-worker` agent + a Claude wiring audit + a cross-model `codex-adversary` pass on the diff (reuse the v1 dogfood workflow pattern); verify shell fixes on synthetic inputs first. Re-sync active, verify with real runs before claiming done. Ultracode expected — use workflows for research/verify.
