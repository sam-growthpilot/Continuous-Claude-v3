# Claude for Sales — Build Status

Build of `01-PACKAGE-DESIGN.md` executed 2026-07-13 (orchestrated, cross-verified). **All authorable artifacts are complete and committed** on branch `feature/claude-for-sales-build`. What remains is human-gated (platform access, people, live dry-run) — it cannot be authored, only run.

## Built + committed (14 docs)

| Build step | Artifact(s) | Status |
|---|---|---|
| 1 (gate prep) | `02-DAY1-PLATFORM-GATE.md`, `03-PILOT-LICENSE-REQUEST.md` | ✅ authored (gate itself is yours to run) |
| 2 | `skills/account-research/SKILL.md` | ✅ |
| 3 | `account-planning-kit/example-plan.md` (fixture + fallback pack) | ✅ |
| 4 | `account-planning-kit/`: COCKPIT + STARTER project instructions, account-context-template, salesforce-connector-runbook | ✅ |
| 5 | `skills/account-planner/SKILL.md` (3-gate orchestrator) | ✅ |
| 6 | `course/`: run-of-show, prompt-cards, facilitator-cheat-sheet, competition · `reinforcement/30-60-90.md` | ✅ |
| 7 (prep) | `account-planning-kit/pilot-ladder-runbook.md` | ✅ authored (the ladder itself is yours to run) |

**Consistency verified** across all 13 build files: identical gate names (Gate 1 Account Brief / Gate 2 Plan Outline / Gate 3 Qualification-Translation Quality Pass), identical approval-phrase list, run-of-show 0:00–1:00 timing matching the plan exactly, load-bearing verbatim strings present everywhere, hard caps consistent (3–4 plays, ≤5 close actions, 5 prompts, 5+5 cards, no 6th), every artifact validating against the `example-plan.md` fixture.

## What remains — human-gated (not authorable)

Ordered. Each is a real-world action only you (+ Sarah/Jay/IT) can take.

1. **Send the pilot-license request** — `03-PILOT-LICENSE-REQUEST.md` → Sarah (loop Jay). Resolves Gate D and the licenses-at-SKO contradiction. End-of-week deadline drives the SF-demotion fallback call.
2. **Run the Day-1 platform gate** — `02-DAY1-PLATFORM-GATE.md` in the Sales Claude Enterprise workspace: Gate A (skills install path — self-serve vs admin-push), Gate C (Salesforce object scope, esp. the UNVERIFIED Activities/Tasks row). *(Gate B web search = confirmed pass.)*
3. **Sync with Sarah** — run-of-show as a shared doc (sections already marked `[SARAH OWNS]` / `[SARAH CO-OWNS]`), and get the Sales survey results (they shape which of the 5 prompts to lead with).
4. **Run the pilot ladder** — `account-planning-kit/pilot-ladder-runbook.md`: (a) you solo end-to-end, (b) 5 pilot reps simultaneous on office wifi (auth + concurrency), (c) facilitator dry-run of cheat-sheet + degraded modes. Feeds results back into Gate D.
5. **Fallback decision (by day 3):** if pilot licenses are refused → demote Salesforce to facilitator-demo, hand-filled context becomes the primary Enterprise path; re-scope `salesforce-connector-runbook.md` + breakout Prompt 2.

## Deferred (post-v1, per locked decisions)

- Fourth-branded HTML "present to your manager" deck for the advanced lunch session — build only if runway allows after items 1–5.
- Emerging-advanced tier placement (full planner skill vs research + lighter stub) — decide after pilot.

## How to use these files at SKO

Every artifact is a markdown draft for direct **paste/upload into Claude.ai**. The two `SKILL.md` files are published as Claude App Skills; the two PROJECT-INSTRUCTIONS files paste into each tier's Claude Project; the course files print for facilitators/reps. The fixture (`example-plan.md`) doubles as the fallback pack a stuck rep reads and the gold standard the competition judges against.
