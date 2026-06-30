# Self-Improvement Loop — "CCv3 evolves CCv3"

A recurring research loop: every morning a bounded, headless CCv3 session takes **one component** of
this system as a baseline, researches how the field has evolved that capability, and writes a **cited
proposal** for whether and how CCv3 should evolve it. Proposals accumulate into a corpus that feeds the
next update phase. It mirrors how the Fable-5 deep review already worked: research → proposals → **you
ratify** → `docs/system-update/BACKLOG.md` → execution.

## How it runs

- **Schedule:** Windows Task Scheduler job `CCv3-Self-Improvement-Research`, daily **7:30 AM**.
- **Entry point:** `scripts/self-improvement/run-research.ps1`.
- **Per run:** `select-component.mjs` picks the next component round-robin (state in `state.json`),
  renders `research-goal.md` with that component, and hands it to `claude -p` (headless). The session
  reads our baseline (`docs/system-update/CURRENT-STATE.md`, `docs/architecture/INDEX.md`, the code),
  researches the frontier (oracle + web + nia/context7), and writes the proposal. `record-index.mjs`
  then appends a row to `INDEX.md`.
- **Output:** `proposals/YYYY-MM-DD-<component>.md` (one per run) + an `INDEX.md` row + a best-effort
  Notion Bridge digest (falls back to `PENDING-DIGEST.md` when the headless run cannot reach the Notion
  MCP — sweep it on your next interactive session).
- **Logs:** `.claude/logs/self-improvement/YYYY-MM-DD.log` (not committed).

## Guardrails (why it is safe to run unattended)

- **Research + propose ONLY.** The headless session runs with an explicit `--allowedTools` allowlist
  (Read, Grep, Glob, Write, Bash, WebSearch, WebFetch, Task, Skill). **`Edit` is excluded** — it cannot
  modify existing code. Destructive Bash is still blocked by the `destructive-command-guard` hook.
- **Writes fenced to `docs/self-improvement/`** by the prompt. No `git commit`/`push` — proposals land as
  untracked files; **you** commit the ones you ratify.
- **Append-only, never clobber:** new dated proposal per run; `INDEX.md` gets one appended row.
- **Bounded:** one component per run; the task has a 1-hour execution-time cap.

## Component coverage (round-robin, ~one/day → full sweep ~every 2 weeks)

Memory · Hooks · Agents · Workflows · Code Intelligence · Braintrust Observability · Doc-RAG (PageIndex)
· Skills System · CLI Integration · Self-Improvement/Learning-Extraction · Cross-Session Coordination ·
Browser Automation. The list lives in `scripts/self-improvement/components-manifest.json` — edit it to
add/reorder components.

## Operating it

| Action | Command |
|--------|---------|
| Run one iteration now | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\self-improvement\run-research.ps1` |
| See coverage / cursor | `cat scripts\self-improvement\state.json` |
| Pause the daily job | `Disable-ScheduledTask -TaskName CCv3-Self-Improvement-Research` |
| Resume it | `Enable-ScheduledTask -TaskName CCv3-Self-Improvement-Research` |
| Remove it | `Unregister-ScheduledTask -TaskName CCv3-Self-Improvement-Research -Confirm:$false` |

## Reviewing proposals

Read the day's proposal, then decide: **ratify** (move it into `docs/system-update/BACKLOG.md` as a real
arc), **watch** (leave it; revisit later), or **drop** it. The `verdict` in each proposal's frontmatter is
the research session's own recommendation, not a decision — you own that call.
