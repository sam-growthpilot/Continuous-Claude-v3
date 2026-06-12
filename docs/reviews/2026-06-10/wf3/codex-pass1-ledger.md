# Codex Cross-Model Pass 1 — Adversary over the Confirmed Ledger

**Via:** codex-adversary agent (gpt-5.5 @ xhigh, `--disable multi_agent`) · **Scope:** wf2/GATE-B-LEDGER.md + source @ SHA 86b8f60
**Verdict:** needs-attention — most confirms correct, but 2 inflated severities, 2 missed compound risks, sharpened fix framing.

## Challenged verdicts (severity adjustments)

| Finding | Panel | Codex challenge | Reasoning |
|---|---|---|---|
| **D2e-02** | CONFIRM S1 | **DOWNGRADE S2** | `post-edit-diagnostics` `spawnSync('tsc')` silent no-op on Windows is **advisory-only** (injects context, never blocks/decides). Lost type hints = observability gap, not a wrong hot-path decision. |
| **D3c-03** | CONFIRM S1 | **DOWNGRADE S2** | `expandGitQuery` `'pr'` substring match (project/problem/improve) only **expands the recall query with noise** — a precision leak, not a decision-blocking false claim. |
| **D2d-03** | CONFIRM S1 | CONFIRM S1 **+ second kill-shot** | `epistemic-reminder` is dead via `input.tool` (vs `tool_name`) AND its output uses a `hookEventName` body field that isn't a recognized injector key — **two-layer dead**; fixing the field name alone still drops the reminder. |

## Missed risks (cross-model lift)

1. **`agent-error-capture` dual-name internal guard = false-correctness signal.** Source (line ~210) guards `tool_name !== 'Agent' && tool_name !== 'Task'` — i.e. the *code* was defensively updated to handle the live `Task` name, but the `settings.json` registration is matcher `"Agent"` only, so the harness never routes it there. A reviewer reading the source would believe the hook handles the real tool name correctly. Load-bearing: the dead-matcher (D10c-02) is masked by code that *looks* correct.
2. **permission-auto-allow + injection family = zero user circuit-breaker (compound risk).** `permission-auto-allow` (D2g-02) auto-approves every PermissionRequest except 2 tools — it removes the user's last DENY gate. Combined with the confirmed shell-interpolation injectors (D2c-04/D3a-01/D2d-06), the chain has no human checkpoint. **Auto-allow removal should be a PRECONDITION for the injection fixes, not a parallel backlog track.** The ledger lacks this cross-reference.
3. **`smart-search-router` ripgrepFallback is Windows-self-limiting.** The `2>/dev/null` POSIX redirect is passed literally to `rg` on cmd.exe → the fallback throws (caught → `[]`) or mis-runs. The `"`-injection (GAP4-02) is real but the Windows blast radius is self-limiting through early failure — a hidden reliability bug as much as an injection.
4. **write-dead bus is an EXISTING degradation, not just a future gap.** `bus-focus.ts:108` reads `focus_symbols`; since no writer exists (D1A-001), `buildFocusBlock()` returns empty on every call → the bus injection path in `memory-awareness.ts` silently contributes nothing to recall quality today.

## Remediation-framing sharpening
- **D5a-01 (junk-creator):** fast-track correct. `execSync` ALWAYS shells (Node `execSync` uses `/bin/sh` on POSIX, `cmd.exe` on Windows) — so the sh-style `\"` escaping is wrong on **all** platforms. Real fix = `execSync`→`spawnSync(cmd, [args], {shell:false})` across **all three** hooks (agent-error-capture, user-confirmation-detector [explicit `shell:true`], hook-error-pipeline) in one PR or the class persists.
- **D2d-01 (contamination):** identity keywords from `continuous-claude` = `['continuous','claude']` — **`'continuous'` is as toxic as `'claude'`** (matches "continuous integration/delivery" in any CI plan). Ship a **quick-win stopword patch** (`claude`, `continuous`, `code`, `anthropic` + word-boundary) immediately, then the structural positive-relevance rewrite.
- **D2b-01/D10c-02 (matcher split-brain):** before flipping `"Agent"`→`"Task"` in settings.json, run a **live telemetry pre-flight** — confirm zero historical fires under the `Agent` matcher. A settings edit that kills live behavior would be worse than the current dead state.
- **D3b-01 (HYBRID_FLOOR):** structural in *impact* but a **one-line quick-win** in code (lower/remove the floor for hybrid mode) — fastest recall improvement available.

_All citations verified against source at the live SHA; nothing fabricated._
