# Codex CLI Repair — Handoff (2026-06-01)

> **✅ RESOLVED 2026-06-01 (same day).** By the time the repair session ran, the CLI was already at `codex-cli 0.131.0` (the hang/0.104.0 state below was stale) and `codex --version` answered in <2s. No reinstall was needed. Verified end-to-end: `codex login status` = "Logged in using ChatGPT"; a `codex exec --sandbox read-only --model gpt-5.5 -c model_reasoning_effort=xhigh` smoke test returned model text at exit 0 (**ChatGPT-subscription auth authorizes `exec` — no `OPENAI_API_KEY`**, settling §4 below); and a real `codex-adversary` spawn on a live diff emitted genuine `[Codex]` findings. Docs updated: `codex-adversarial.md` + `cli-integration-strategy.md` (version + verified-auth note). Remaining wart: cosmetic startup noise (skill-YAML / MCP / hook errors) — documented in `codex-adversarial.md` "Startup Noise", optional cleanup. The playbook below is retained as the diagnostic record.

**For:** a fresh session whose sole job is to restore the OpenAI Codex CLI so the cross-model adversarial review (`codex-adversary`) works again in `/review` and `/premortem`.

**One-line problem:** the `codex` CLI **hangs on `codex --version`** (>=20s, exit 124) in BOTH git-bash and PowerShell — the binary itself is wedged, so every `codex exec` call in `codex-adversary` either hangs to timeout or returns garbage. There is currently **no cross-model lift** from `/review`.

---

## 1. Symptoms (verified 2026-06-01)

| Check | Result |
|---|---|
| `command -v codex` | found: `C:\Users\david.hayes\AppData\Roaming\npm\codex` (shim: `...\npm\codex.ps1`) |
| `codex --version` (git-bash, `timeout 15`) | **exit 124 — hung, no output** |
| `codex --version` (PowerShell job, 20s) | **TIMED OUT — hung, no output** |
| `codex auth status` (git-bash, `timeout 20`) | exit 0 but **no output** (ambiguous) |
| `CODEX_ADVERSARY_MODEL` env | unset (so agent defaults to `gpt-5.5` — correct) |

`codex --version` returning in <1s is the floor for a healthy install. A >=20s hang on the simplest command in **two different shells** means the issue is the CLI binary/install, NOT a shell, PATH, auth, or model-name problem.

**Observed downstream effect:** the `codex-adversary` agent ran for a very long wall-clock time, then reported trying models `o3 / gpt-4.1 / gpt-4o` (which is WRONG — its definition uses `gpt-5.5`) and getting `model not supported with ChatGPT account`. Treat that report as unreliable improvisation after the CLI failed — not as ground truth about auth.

## 2. What is NOT the problem (already ruled out — do not chase these)

- **The agent definition is correct.** `.claude/agents/codex-adversary.md` uses `codex exec --model "${CODEX_ADVERSARY_MODEL:-gpt-5.5}" -c model_reasoning_effort=xhigh --sandbox read-only` with a `-` stdin prompt, and documents a `gpt-5.4` fallback for "requires a newer version of Codex" errors. No change needed there unless the repair reveals a new constraint.
- **Not a git-bash-only quirk.** It hangs in native PowerShell too.
- **Not `CODEX_ADVERSARY_MODEL` mis-set.** It is unset (defaults to `gpt-5.5`).

## 3. Likely root cause

The installed CLI is the **old `codex-cli 0.104.0`** (per `.claude/rules/cli-integration-strategy.md` inventory). `.claude/rules/codex-adversarial.md` states `gpt-5.5` **requires `@openai/codex` CLI >= 0.131**. So the install is both (a) too old for the configured model and (b) apparently broken (a healthy 0.104 would still answer `--version`). Most probable fix is a clean reinstall/upgrade. Secondary hypotheses to check if upgrade alone does not fix the hang: a stale lock or bad config under `~/.codex/`, an update-check phoning home and blocking, or a Node ABI mismatch.

## 4. Repair playbook (do in order; stop when `codex --version` answers fast)

1. **Confirm the hang + look for a cause (read-only):**
   - `npm ls -g @openai/codex` (or `npm ls -g codex`) to see the installed version.
   - Inspect `~/.codex/` (Windows: `C:\Users\david.hayes\.codex\`) for a `config.toml`, a lock file, or a half-written auth file. A bad config can hang startup.
   - `node --version` (Codex needs a modern Node; this machine runs Node 24.4.1 — fine).
2. **Upgrade the CLI:**
   - `npm install -g @openai/codex@latest`
   - NOTE: this trips the **`package-install-guard`** PreToolUse hook (4-layer supply-chain check). `@openai/codex` is the official OpenAI package — let the guard run; if it false-positives, re-run with `SKIP_PACKAGE_GUARD=1` only after eyeballing the package name. See `.claude/rules/package-install-safety.md`.
   - Re-test: `codex --version` should now return in <2s. If it STILL hangs, the install is environmentally broken — try `npm uninstall -g @openai/codex` then reinstall, or check for a wrapper/antivirus interfering with the `.ps1` shim.
3. **Re-check auth (safe, no re-prompt):**
   - `codex login status` (or `codex auth status`). Per `.claude/rules/codex-adversarial.md`, Codex authenticates via **OAuth against Dave's ChatGPT subscription**.
   - If not logged in, Dave runs `! codex login` himself in the session prompt (interactive OAuth — you cannot drive it).
4. **VERIFY the auth-vs-exec question** (the codex-adversary agent *claimed* exec needs `OPENAI_API_KEY` — this is unverified and may be false):
   - Smoke test: pipe a trivial prompt to `codex exec --sandbox read-only --model gpt-5.5 -c model_reasoning_effort=xhigh -` such as "Reply with exactly: OK".
   - If it returns `OK` -> ChatGPT-subscription auth DOES authorize `exec`; the agent's claim was wrong. Done.
   - If it returns `model not supported with ChatGPT account` -> try `--model gpt-5.4`. If that also fails, THEN the exec endpoint needs an `OPENAI_API_KEY` (set it and re-test, and document the cost implication — API billing vs subscription).
5. **End-to-end verify:**
   - Re-run the `codex-adversary` agent directly, or run `/review` on a tiny throwaway diff, and confirm it produces real `[Codex]` findings (not a fallback "auth failed" note).

## 5. Success criteria (all must hold)

- `codex --version` returns in <2s.
- `codex exec --sandbox read-only` with a trivial stdin prompt returns model text.
- A real `/review` (or a direct `codex-adversary` spawn) emits genuine `[Codex]`-prefixed findings.

## 6. If the repair changes anything, update these docs

- `.claude/rules/codex-adversarial.md` — correct the **"requires CLI >= 0.131"** line to the actual working version, and fix the **"Auth Model"** section if exec turns out to need `OPENAI_API_KEY` rather than ChatGPT-subscription auth.
- `.claude/rules/cli-integration-strategy.md` — bump the Codex CLI version in the inventory (currently records `0.104.0`).
- Optionally add a one-line "verified working YYYY-MM-DD" note so the next reviewer trusts it.

## 7. Safety / guardrails (from `.claude/rules/codex-adversarial.md`)

- Safe without asking: `codex login status`, `codex --version`, `codex --help`, `codex exec --sandbox read-only`.
- **Confirm with Dave first:** anything `--sandbox workspace-write`/`danger-full-access`, `/codex:rescue`, and **do NOT** run `/codex:setup --enable-review-gate` (documented high-cost/high-risk on Windows).
- `codex login` is interactive — Dave runs it via `! codex login`.

## 8. References (read first)

- `.claude/rules/codex-adversarial.md` — full Codex integration convention, auth model, safe/confirm command lists, cost awareness.
- `.claude/agents/codex-adversary.md` — the agent that invokes `codex exec` (its invocation block is the source of truth for the command shape).
- `.claude/rules/cli-integration-strategy.md` — Codex row in the CLI inventory + Agent Compatibility Checklist.
- `.claude/rules/package-install-safety.md` — what the install guard does and the `SKIP_PACKAGE_GUARD=1` override.
- `.claude/rules/windows-platform.md` — Windows CLI/`cmd /c` invocation rules.
- This was discovered during the 2026-06-01 `/review` of the item-4 sweep (see `docs/ccv3-hardening-state-2026-06-01.md`).
