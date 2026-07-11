# Tri-Model System — Current State Reference

**Snapshot: 2026-07-11 (late).** Written for any session needing ground truth on the tri-model work in flight. Verified against git, not narration.

## Layer status

| Layer | Where | Status |
|---|---|---|
| **Connection layer** — `/codex` + `/grok` workers, adversaries, reviewer picker, `/harness-update` | `main` (PR #18, merge `089ea55`) | ✅ Shipped, 61/61 suite, live in `~/.claude` |
| **Governance layer** — workroom disk bus, roster policy, preflight gate | branch `feature/game-plan-governance` (commits `e262814`→`73d2a63`, 8 commits, +2322 lines) | ✅ Built + dogfood-verified · ⏳ **Gate 2 pending: Dave's PR review/merge** |
| Track D `/game-plan` orchestrator | not started | Deliberately deferred until after dogfood (done) + merge |
| Track F Notion roster rewrite | not started | Confirm-first; page `39676fd7ac8281068c7ee4b6f793f5af` is one revision behind |

## What exists on `feature/game-plan-governance`

| Track | Deliverable | Key paths |
|---|---|---|
| A | Workroom protocol + 7 templates, **gitignore-first** (`rooms/*` never committed) | `.workroom/PROTOCOL.md`, `.workroom/templates/` |
| B | `/workroom` skill: `new / status / post / advance / resume` | `.claude/skills/workroom/SKILL.md` |
| C | Workroom/role blocks in all 4 cross-model agents (fail-open without a `## Workroom` block); **Grok `research` role** = widened write-free `--tools` incl. `web_search` (documented egress expansion) | `.claude/agents/{grok,codex}-{worker,adversary}.md`, `.claude/rules/grok-worker-safety.md` |
| E | Roster copy realigned: **Grok builds · Codex reviews/fixes · `--builder codex` explicit override** | skills + rules copy |
| G | `scripts/tri-model/preflight.mjs` — auth/identity/allowlist/version-pin gate (closes the advisory-gate gap). **Built BY Grok THROUGH the first real workroom** (`2026-07-11-tri-model-preflight`), graded by Codex booth, HIGH finding fixed in round 1 | `scripts/tri-model/preflight.mjs` (630 lines) |
| — | Operator docs: cockpit guide (also on Notion page `39a76fd7ac82817abc0bffdfeaec1c54`), system-overview HTML | `docs/tri-model/cockpit-guide.html`, `system-overview.html` |

**Dogfood proved the doctrine:** Codex booth returned a thin approve (2 of 3 invocations fork-stormed) → the supplemental Claude critic caught a real HIGH (JSON.parse error path echoing `auth.json` secret bytes) → Codex fixed it (fix-round 1/2) → hub verified with a canary-secret probe. Builder ≠ grader caught what self-grading would have shipped.

## Probe-backed facts added during governance dogfood (trust these)

1. **Codex `--sandbox read-only` on Windows can FORK-STORM** on subprocess denial (~40 orphaned `codex.exe`). Prompt-shape-dependent: rich checklists trigger it, compact prompts don't. Keep adversary prompts compact; after a timeout check `tasklist | findstr codex`; treat a 0-findings pass after storms as thin evidence and add a Claude-critic lens. Evidence: `docs/codex-integration/DESIGN-RESEARCH.md` §14.
2. **`$CLAUDE_PROJECT_DIR` can be EMPTY in agent shells** — workroom dispatch blocks must pass ABSOLUTE paths.
3. **Grok cold start hit ~11–12 min once** (far past the documented 120s and even the 300s guidance) — on timeout, poll for the output file; do NOT re-invoke.
4. **`sync-to-active.sh` deliberately excludes `hooks/src`** (dist-only by design) — active `~/.claude/hooks/src` drifts; never `npm run build` there without first mirroring `src/shared/` from the repo.

## Standing facts from the connection layer (unchanged, evidence in DESIGN-RESEARCH docs)

- Grok read-only = `--tools "read_file,list_dir,grep"` ONLY (`--sandbox` decorative; `--permission-mode plan` doesn't block writes headless). `-w` ignored headless → `../.grok-worktrees/`. Identity pin = `auth.json .email`. CLI auto-updates.
- Codex 0.144.1; models `gpt-5.5` (default) + `gpt-5.6-sol/terra/luna` + `gpt-5.4/-mini`; no approval dial — sandbox is the boundary; `thread_id` resume.
- Any model/CLI change goes through `/harness-update` (edit-point registries; two-probe rule; rollback pins).

## Reading order for a fresh session

1. This file.
2. `docs/tri-model/SESSION-REVIEW-2026-07-11.md` — combined build order + corrections (Tracks A/B/C/E/G now DONE per above; remaining: merge, Track F, Track D).
3. `docs/tri-model/COLLABORATION-PLAN.md` — full governance design (roster doctrine §3.1, phase machine §3.4, open decisions §7).
4. `.workroom/PROTOCOL.md` (on the governance branch) — the live message/phase schema.
5. Safety rules: `.claude/rules/{grok,codex}-worker-safety.md`, `harness-update.md`.

## Open items (in order)

1. **Gate 2:** Dave reviews/merges `feature/game-plan-governance` → main.
2. Post-merge: fresh-session smoke of `/workroom` + rostered agents; run `node scripts/tri-model/preflight.mjs`.
3. Track F: Notion "Cross-Model Workers" roster rewrite (confirm-first) + HTML artifact chip flip (`claude.ai/code/artifact/edadfc5f-fa44-4952-a299-23f586d1c435` — "in build" chips → live).
4. Track D: `/game-plan` orchestrator (only now that dogfood passed).
5. Watch items: fork-storm recurrence (compact prompts), Grok cold-start outliers, `codex-worker` telemetry-row discipline.
