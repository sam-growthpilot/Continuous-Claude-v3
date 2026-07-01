# FourthOS Weekly Report — v4 Enhancements: Implementation Plan

**Status:** PLAN — awaiting Dave's approval before build. Design synthesized 2026-06-30 (4-lens panel;
strong convergence). **Extends** the `fourthos-weekly` pipeline; does not replace it. Every existing
rule still applies: 3-state honesty badges (LIVE / BUILT IN-REPO / DESIGNED·NEXT), status-grade-only
public HTML, no real person names, inline-SVG + CSS only (zero external requests), single-session
headless run.

## Goal
Turn the weekly report from a *status broadcast* into a *decision instrument* — surfacing project
velocity, week-over-week movement + stalls, a decision-first Ask Box, and a repeatable
technical→narrative translation — across the now-**two** projects (Salesforce Connector *product* +
Connector Ecosystem *program*).

## The enabling mechanism — weekly snapshot diff (reuse the archive, NO new store)
Each week's Tier-3 "FourthOS Update Package — YYYY-MM-DD" page already carries a §9 JSON data model.
**That IS the weekly snapshot.** v4 adds: at generate time, read the most recent *prior* Update Package
§9 JSON and diff it against this week's fresh cockpit pull. No new database — the archive is the history.
- **Cold start** (no prior package): velocity sparklines render partial with a "history starts here"
  marker; `whatMoved` = "first tracked week — baseline set"; `stallWatch` computed from D&O / Latest-Update
  dates only.

## §9 data-model additions (the contract — also document in saved-prompt `82c202b8…`)
```json
{
  "velocity":  [{"project":"Salesforce Connector","shipRate":5,"highMed":2,"trajectory":"accelerating|steady|cooling|stalled","spark":[0,1,0,2,1,3],"spinning":false}],
  "whatMoved": [{"project":"...","kind":"risk|win|status|ship","dir":"up|down|flat","text":"...","anchor":"briefing.html#risk-radar"}],
  "stallWatch":[{"project":"...","daysSinceMovement":23,"state":"waiting|aging|parked","blocker":"Danny (Entra groups)"}],
  "asks":      [{"ask":"...","why":"...","cost":"...","recommended":"...","byWhen":"YYYY-MM-DD","source":"stall|spinning|health|manual","anchor":"briefing.html#sponsor-actions"}],
  "cbConfidence": {"signal":"isolation 16/16 · 1055 tests green","anchor":"deep-dive.html#architecture"}
}
```
**Computation (all from cockpit + prior snapshot):**
- `velocity.shipRate` = Σ Decisions&Outputs rows (project, trailing 28d) weighted **High=3 / Med=2 / Low=0**.
  `highMed` = count of High+Med. `spark` = 6 trailing weekly weighted sums (from the archive).
  `trajectory` = thisWeek vs mean(prior 3–4 wk): >1.25 accelerating · 0.75–1.25 steady · <0.75 cooling ·
  0-with-positive-baseline stalled. `spinning` = (Latest-Update edits + tasks-done ≥3 trailing 4wk) AND highMed==0.
- `whatMoved` = per-project field diffs (health / status / nextMilestone / output-count / latestUpdate)
  vs last week; ORDER risk-degradations → wins → status changes → ships.
- `stallWatch.daysSinceMovement` = today − max(latestUpdate change, last output date, status/health/milestone
  change, task done). state: **waiting** (a "blocked on/waiting on <name>" marker present) · **aging**
  (past threshold, no blocker) · **parked** (Status = Waiting/On-hold by design). Thresholds: quiet 7–13,
  stalled 14–20, aging 21+.
- `asks` auto-promoted from sensors: stallWatch state=waiting AND ≥21d → ask; velocity.spinning → a
  "narrow scope?" ask; a health degrade needing a call → ask. Plus manual asks from Sponsor Action Required.
  `recommended` + `byWhen` required. Empty asks[] → the honest "Nothing needed — FYI read" state.

## generate-prompt.md changes
- **New Step 2b — Compute deltas:** after refreshing §9, fetch the prior week's package §9, diff, and
  populate velocity / whatMoved / stallWatch / asks / cbConfidence per the rules above.
- **New narration rule — the So-What Ladder** (see `SKILL.md` v4 §4): every sponsor sentence in the
  package is produced by climbing Raw → Capability → Value(one axis) → Sponsor sentence. **Carly text =
  rung 4; CB text = rung 3 + a soundness number.** Enforce the 5-gate honesty rubric + jargon banlist
  (ACA, SOQL, revision, OBO, serializer, …). Applies to Latest-Update + D&O narration.
- **Update G2** to expect ≥2 active projects.

## Render changes (inline-SVG + CSS only; reuse `templates/shell.html` + the html-engine)
- **Hub (`index.html`):** add the **Ask Box** at the very top ("What I need from you this week" from
  `asks[]`; recommended default + "silence = I proceed Fri"; honest empty state) and the **What-Moved
  diff ribbon** (`whatMoved[]` chips, direction-colored: teal win / amber-red risk / accent neutral).
  Keep the headline hero below.
- **Briefing (`briefing.html`):** lead with movement (diff ribbon) then a **collapsed** steady portfolio
  grid; add the **Velocity Rail** (per-project impact-segmented bar + 6-week inline-SVG sparkline +
  trajectory glyph + trailing health dot, sorted by shipRate); add the **Stall Watch** panel
  (waiting/aging/parked, oldest-first; waiting rows deep-link to `#sponsor-actions`); add the **CB
  confidence chip** near the top (`cbConfidence`).
- **Carly / CB lens toggle:** reuse the proven 3-view governed-report toggle (`fourthos/2026-06-24/`) —
  Carly default = rung-4 outcomes/asks; CB default = rung-3 + soundness. Same data, different stop-rung.

## Build order
1. Snapshot-diff read (prior §9) + cold-start handling.
2. §9 data-model fields + Step 2b computation.
3. So-What Ladder narration rule in the prompt.
4. Render blocks (Ask Box + ribbon on hub; velocity rail + stall watch + CB chip + lens toggle on briefing).
5. Verify against a real preview generate; eyeball; then it flows into Friday's scheduled run.

## Verification
Generate a preview and confirm: Ask Box renders (or the honest empty state); diff ribbon shows real
deltas vs last week; velocity rail sorts by shipRate with sparklines + trajectory; stall watch classifies
correctly; CB chip present; grep-audit passes (no banned jargon in sponsor lines, badges correct, no real
names). Test the cold-start path (ignore the prior snapshot).

## Open choices for Dave (tune before/at build)
- **Velocity Low-impact weight:** 0 (strict — recommended, panel consensus) vs 1 (softer).
- **Aging thresholds** (7 / 14 / 21 days) — tune to your cadence.
- **Ask Box forcing function** — "silence = I proceed Fri" (strong) vs "flag if you disagree by Fri" (soft).
- **Flagship rotation** — Salesforce Connector vs Connector Ecosystem for the Tier-2 deep-dive each week.
