# Pre-SKO Orientation — the runway phase

The pre-SKO phase is the runway between "the team has their Claude licenses" and SKO day. Its job is **different from SKO day**: SKO day teaches account planning; pre-SKO's only job is to make Claude feel like a reflex — and to teach reps to **build the infrastructure around the intelligence** (Projects, Custom Instructions, Docs, Skills) — so the account-planning day builds on comfort and setup, not first-contact.

**The one success metric:** *by SKO, every rep has (a) had at least one real win with Claude on their own work, and (b) built at least one Custom Work Area (Project).* Everything here serves that.

## Design decisions (from the structure brainstorm, 2026-07-14)

- **Content spine = load-bearing habits, not feature coverage.** Teach a few habits that carry everything — give context like briefing an SDR · show one example of "good" · make it cite + tag (it's confident even when wrong) · iterate in plain English. Habit 3 IS the SKO no-fabrication / confidence-tag rule, planted a week early → pre-SKO becomes the SKO handoff, not a separate thing.
- **Two tracks, tiered by appetite (mirrors the SKO tiering):**
  - **Everyone — the 90-second starter kit.** A self-personalizing onboarding prompt (Claude interviews the rep, generates their kit). Comfort + one real interaction. See `master-onboarding-prompt.md`.
  - **Account-workers — the Work-Area Playbook.** The deeper setup: build a Project with Custom Instructions + Docs + a Skill. This is the emphasized pre-SKO focus. See the artifacts + `main-assistant-project.md`, `skill-forge-kickoff.md`.
- **Native delivery — the guide teaches Claude *by using Claude*.** The starter kit is one paste-prompt Claude runs live; skills are built *with* Claude via interview (skill-forge Capture Intent). No passive PDF as the primary teacher; a polished HTML playbook is the reference home base.
- **Stick to claude.ai.** No Salesforce/connector complexity in pre-SKO — that's SKO-day Enterprise scope. Fundamentals = Projects, Custom Instructions, Docs (RAG), Skills, built-in web search.
- **Ownership drives retention.** Both tracks end with a self-authored artifact the rep carries into SKO (a "My Cheat Sheet" chat; a working Project).

## The four Project components taught (the playbook's spine)

1. **Custom Instructions** — the standing brief; spans every chat in the project.
2. **Project Docs** — uploaded reference material; a searchable RAG library that grounds the project **without consuming the chat's working memory** (upload once vs. paste every time).
3. **Skills** — installable repeatable moves; the Custom Instructions declare *when* to use each skill.
4. **Orchestrator** (advanced) — a conductor skill that sequences several skills with checkpoints, once the project is complex enough (Claude suggests it).

Build order taught: **Step 0 foundations (global instructions + a 'Main' assistant project) → 1 targeted project → 2 chat-to-build Custom Instructions → 3 load Docs → 4 pick a repeated task → 5 build the Skill with Claude (skill-forge) + wire it into the instructions → 6 let Claude suggest an orchestrator + keep honing.**

## Deliverables in this folder

| File | What it is | Track |
|---|---|---|
| `master-onboarding-prompt.md` | The 90-second self-personalizing starter-kit prompt + usage | Everyone |
| `main-assistant-project.md` | Step-0 foundation: global instructions + 'Main' assistant Project templates + build prompt | Account-workers |
| `skill-forge-kickoff.md` | Step-5 kickoff prompt (uses the shipped `skill-builder` skill) + a worked dry-run | Account-workers |
| `../skills/skill-builder/SKILL.md` | The shipped rep-facing skill-maker — jargon-free interview → draft → test → wire-in; honesty rules baked in as defaults | Account-workers |
| `../artifacts/pre-sko-starter-kit-sketch.html` | Interactive sketch of the starter-kit experience (3 taps → tailored kit) | Everyone |
| `../artifacts/pre-sko-projects-playbook.html` | The highly polished Work-Area Playbook (interactive anatomy, context-window visual, all build prompts) | Account-workers |
| `../artifacts/sko-package-overview.html` | Interactive overview of the whole SKO package (for reference/leadership) | Program |

## Handoff to SKO day

Pre-SKO ends where `../01-PACKAGE-DESIGN.md` begins. A rep who did the runway walks into the SKO Setup Block already owning a Project, a skill, and the cite-and-tag reflex — so the 60-minute account-planning breakout is *practice*, not *first contact*. The honesty rule is the explicit through-line: taught as a habit here, certified in the competition there.

## Open items

- **Runway length + channel** — confirm days between licenses-live and SKO, and whether the Slack learning channel is the drip surface (sets one-shot vs. daily cadence).
- **Mandatory vs. opt-in** — does this slot under the "Claude basics course, due July 15" from the source docs, or is it a softer nudge? (Changes completion mechanics.)
- **skill-builder availability** — confirm the `skill-builder` skill is publishable to the Sales workspace (it's the rep path; `skill-forge` stays the Claude Code power tool). The kickoff prompt degrades gracefully if it isn't installed, but the named-skill path is better.
