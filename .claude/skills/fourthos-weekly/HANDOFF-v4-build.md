# Handoff — fourthos-weekly: branch note + v4 build package (2026-06-30)

Authored from a `fourth-salesforce-mcp` session that made isolated additions to the
`snapshot/ccv3-system-update` branch of `continuous-claude`.

## A. Branch note — for the session pushing + merging `snapshot/ccv3-system-update`

This external session added **three commits**, ALL isolated under
`.claude/skills/fourthos-weekly/`. They do **not** touch the branch's other in-progress work
— `ROADMAP.md` and `docs/architecture/system-visualization/architecture.json` remain that
session's own uncommitted changes and were never staged here.

| Commit | What it adds |
|---|---|
| `0e81a0b` | `skill(fourthos-weekly): version-control the sponsor-weekly skill` — adds `SKILL.md` + `templates/` (the skill was previously **active-only, unversioned** in `~/.claude`). The `SKILL.md` already carries this session's two-project portfolio split + a v4 design section. |
| `138bf50` | `docs(fourthos-weekly): v4 report-enhancements implementation plan` — adds `v4-report-enhancements-plan.md`. |
| *(this commit)* | `docs(fourthos-weekly): v4 build handoff` — this file. |

**Safe to push + merge with the rest of the branch** — disjoint paths, no conflicts expected
with the other session's work. Nothing has been pushed from the external session.

## B. v4 build package — for the next session that executes the report enhancements

**Status:** design **APPROVED by Dave**; **NOT yet built.** Execute in a fresh session.

**Read, in order:**
1. **`v4-report-enhancements-plan.md`** (this dir) — the implementation plan. Key mechanism:
   reuse each weekly Update Package's **§9 JSON as the week-over-week snapshot** (no new store).
   Covers §9 data-model additions, `generate-prompt.md` changes, render changes, build order,
   verification.
2. **`SKILL.md` → "v4 — planned report enhancements"** — the design summary + the **So-What
   Ladder** narrative method + the 5-gate honesty rubric.
3. The pipeline it modifies: `continuous-claude/scripts/fourthos-weekly/generate-prompt.md`
   (the `claude -p` generate steps) + the render tiers in `Rev4nchist/ai-enablement-decks`
   (`fourthos/2026-06-24/` is the current HTML template to base new tiers on).

**Context to preserve:**
- Portfolio is now **TWO projects** in the FourthOS Projects DB (`852a60e1`): **Salesforce
  Connector** (product · Green · live-in-ALPHA) and **Connector Ecosystem** (program · Yellow ·
  reporting blocked on IT/Danny). The Decisions & Outputs "hardening" row is linked to the
  Salesforce Connector project.
- A Tier-3 source for 2026-06-30 already exists: Notion page **"FourthOS Update Package —
  2026-06-30"** (under the cockpit) with the §9 JSON shape to extend.

**Open choices to confirm with Dave before/at build (from the plan):**
- Velocity Low-impact weight — **0** (strict, recommended) vs 1.
- Aging thresholds — 7 / 14 / 21 days (tune to cadence).
- Ask-Box forcing function — "silence = I proceed Fri" (strong) vs "flag if you disagree" (soft).
- Flagship rotation — Salesforce Connector vs Connector Ecosystem per week.

**First steps:** resolve the 4 open choices → build-order step 1 (snapshot-diff read of the prior
week's §9 + cold-start handling) → step 2 (§9 fields + Step-2b compute) → step 3 (So-What Ladder
narration rule) → step 4 (render blocks: Ask Box + diff ribbon on the hub; velocity rail + stall
watch + CB chip + Carly/CB lens toggle on the briefing) → verify on an unlisted preview.

**Design provenance:** synthesized 2026-06-30 from a 4-lens design panel (decision-first,
narrative-translation, velocity-metrics, novel-visual) — strong convergence on
impact-weighted-output velocity, classified Stall Watch, the Ask Box spine, and the So-What Ladder.

**Also NOT done this session (deferred):** rendering + pushing the HTML preview tiles for the
2026-06-30 package. The Friday `CCv3-FourthOS-Weekly` scheduled run (now updated for the
two-project split) will render + stage the unlisted preview from the existing Tier-3 package.
