# Pilot Ladder Runbook — Claude for Sales

**Build step 7 of `01-PACKAGE-DESIGN.md`.** This is an **operator runbook for Dave**, not rep-facing
material — nobody hands this to a rep, and none of its wording ships into the course. It is the
last live checkpoint before SKO: three rungs of increasing scale that prove the kit works
mechanically (Rung A), under real concurrency and auth load (Rung B), and that the safety net
catches every way it can break (Rung C).

**Runs once the 5 pilot licenses land (Gate D of `02-DAY1-PLATFORM-GATE.md`).** Gate D got the
*licenses*; this runbook proves the licenses actually *work* end-to-end. Treat it as a second,
harder checkpoint on the same Salesforce-demotion decision — a pilot failure can flip that decision
even after Gate D itself passed.

## Prerequisites (do not start Rung A until all are true)

- Gates A, B, C of `02-DAY1-PLATFORM-GATE.md` are ✅ (skills installable, web search on, SF object
  scope known) — or their fallback decision is made and recorded.
- Gate D (`03-PILOT-LICENSE-REQUEST.md`) licenses are provisioned: 5 named pilots, full Enterprise,
  Salesforce connector enabled, at least one with real SF pipeline.
- Build steps 2–6 are complete and each has been validated against the fixture: `account-research/
  SKILL.md`, `account-planner/SKILL.md`, both PROJECT-INSTRUCTIONS + context templates, the SF
  runbook, and the course materials (run-of-show, prompt cards, facilitator cheat sheet,
  competition + answer-key packet spec).
- `example-plan.md` (Harbor & Vine) is final — it is the pass/fail yardstick for every rung below.

## How to read the rungs

Each rung has: **goal**, **exact steps**, **pass criteria**, **what to watch for**, and **what a
failure forces**. Do not advance to the next rung until the current one passes or its forced
action is complete. A rung can be re-run once after a fix; a second failure on the same rung
escalates to Dave + Sarah for a scope decision, not a third silent retry.

---

## Rung A — Dave solo, end-to-end

**Goal:** prove the mechanical path works for one skilled operator in a real Project against a real
(own-territory) account, before any rep sees it. This is the calibration run — it tells you whether
the instructions and skills are even coherent before you spend pilot-rep time on them.

**Steps:**
1. Create a real Project in the Fourth Sales Claude Enterprise workspace (not the Competition Arena
   pattern — a genuine Account Cockpit Project).
2. Install both skills (`account-research`, `account-planner`); paste
   `COCKPIT-PROJECT-INSTRUCTIONS.md`; fill the 6-field account-context template for one of Dave's
   own real accounts.
3. Authenticate the Salesforce connector; confirm the on-screen success check ("your account's
   opportunities appear").
4. Run the Enterprise breakout's 5 prompts in order, timing each against the run-of-show budget:
   setup → SF pull → web research → synthesize → qualification translation.
5. Diff the resulting plan section-by-section against `example-plan.md` Part B.

**Pass criteria:**
- All 8 sections present, in order, with the exact section names from the fixture.
- Play-by-Quarter capped at 3–4 plays; Mutual Close Plan capped at ≤5 actions.
- Every factual claim carries exactly one confidence tag; SF-sourced facts are tagged [VERIFIED]
  and attributed to Salesforce, not web search.
- Section 8 (Qualification Translation) reads as MEDDPICC-style narrative ("economic buyer not yet
  identified," "single-threaded") — **not** a field dump ("stage = Discovery"). This is the one
  section worth re-reading twice; it's the whole quality bar.
- No fabricated names — every person traces to a clickable source or is role-only with "title to
  verify on LinkedIn (rep's manual step)"; every true unknown reads "not found in public sources —
  verify manually" verbatim.
- Total elapsed time is in the neighborhood of the 60-minute breakout budget (this run calibrates
  the budget, it isn't graded against it).

**What to watch for:**
- Any point where Dave has to deviate from the written PROJECT-INSTRUCTIONS or improvise a prompt
  not in the 5-prompt script — that's an instructions gap, not an operator skill gap.
- Sparse or empty Activities/Tasks data from Salesforce — confirm this reads as "check your access"
  (Gate C's known caveat), not a broken pull.
- Any drift from the fixture's shape (missing section, wrong cap, an un-tagged claim) — note the
  exact line.

**Failure forces:** one edit-and-rerun cycle on the specific artifact that broke (skill, template,
or instructions) — not an open-ended debugging loop. If the failure traces back to unresolved Gate
C scope (an object genuinely isn't readable, not just sparse), **stop** — do not proceed to Rung B
until Gate C's decision is finalized, because Rung B tests concurrency on top of a mechanism that
isn't yet proven to work once.

---

## Rung B — 5 pilot reps, simultaneous, office wifi

**Goal:** the load test. Rung A proves the flow works once, for an expert, on Dave's network. Rung B
proves it survives 5 independent reps authenticating and pulling Salesforce data **at the same
time**, on ordinary office wifi — the two failure modes (auth flakiness, SF connector throttling
under concurrency) that a single solo run cannot surface.

**Steps:**
1. Schedule one 90-minute session with all 5 pilot reps in the same room, on office wifi (not VPN,
   not home broadband — the venue-network proxy).
2. Confirm all 5 licenses are active and SF-connector-enabled (Gate D2) before the clock starts.
3. Each rep works their own real, own-territory account — never someone else's pipeline (data
   handling rule holds even in the pilot).
4. **Deliberately synchronize the stress point:** have all 5 reps hit "authenticate the Salesforce
   connector" within the same ~2-minute window, then all 5 run breakout Prompt 2 (the SF pull) in
   the same ~2-minute window right after. This is where concurrency problems will show up first —
   don't let the group naturally stagger itself.
5. From there, let each rep run the remaining prompts (3–5) at their own pace, matching the normal
   60-minute run-of-show timing.
6. Dave floats and observes — helps only when a rep is truly stuck, mirroring the facilitator-float
   role at SKO. Do not pre-solve problems; the point is to see what breaks unassisted.
7. Log a timestamp for each rep at: auth success/fail, SF-pull success/fail (and any error text),
   and full-plan completion.

**Pass criteria:**
- All 5 reps authenticate successfully inside the synchronized window.
- No Salesforce throttling/rate-limit errors during the synchronized SF-pull window — **or**, if
  throttling appears, it is caught, reproduced, and characterized (which prompt, what error
  message, how many concurrent pulls triggered it) rather than just noted as "it broke."
- Web search does not visibly degrade for any rep under the shared-network load (a secondary
  concurrency risk worth watching, not just SF).
- At least the one pilot rep with real SF pipeline completes a full plan that passes the same
  fixture check as Rung A.
- All 5 reps finish (or come close to finishing) inside the 60-minute budget without facilitator
  hand-holding beyond normal floating.

**What to watch for:**
- **SF throttling at the concurrent-pull moment is the single most likely failure** — the package
  design already names this risk (`01-PACKAGE-DESIGN.md`, build step 7b) and pre-commits to a
  mitigation: if throttling appears, the SKO room plan staggers pulls by table instead of having
  every table hit Salesforce at once. This rung's job is to find the actual threshold (how many
  concurrent pulls is safe) so the stagger interval in the room plan is a real number, not a guess.
- Wifi bandwidth contention distinct from SF-specific throttling (check whether a slowdown is the
  connector or the network).
- Skill-install friction on rep-owned devices — Rung A only tested Dave's device/OS; this is the
  first test on a realistic device mix.
- A rep who can't finish in the budget — signals either the timing needs adjusting or that rep
  needs more Claude-101 grounding before SKO, not necessarily a kit problem.

**Failure forces:**
- SF throttling confirmed → the SKO room plan is amended with the observed stagger interval (e.g.
  "no more than N tables pull Salesforce within the same 2-minute window") before the event; this
  is a required edit to the run-of-show, not optional.
- Device/skill-install failure → confirms the IT-floater role and the Setup Block's flagging step
  are load-bearing, not decorative; if a rep's failure wasn't caught cleanly, tighten the Setup
  Block script (feeds back into `01-PACKAGE-DESIGN.md` §Session structure).
- Wifi itself chokes independent of SF/Claude → escalate to IT for an SKO-venue network-capacity
  check; this is outside the kit's control and needs its own ticket.

---

## Rung C — Facilitator dry-run of the cheat sheet + degraded modes

**Goal:** Rungs A and B test the happy path (and, incidentally, one real failure class). Rung C
deliberately breaks each dependency on purpose and proves the facilitator-side safety net —
the cheat sheet — actually gets a rep back into the exercise in real time, not just in theory.

**Steps:** with `facilitator-cheat-sheet.md` open, run three scripted breaks, each played out as if
a real rep hit it mid-breakout:

1. **SF-fails scenario** — simulate the Salesforce connector refusing to authenticate during the
   Setup Block. Follow the cheat sheet's script exactly: confirm it correctly routes the rep to the
   IT floater, and if unresolved in time, into `example-plan.md` as the fallback pack, without the
   facilitator having to invent language.
2. **Web-search-fails scenario** — simulate a real research query coming back empty or erroring.
   Confirm the skill's own guidance ("if a prospect has almost no public footprint, say so plainly
   and pivot to segment-level context") and the cheat sheet's matching facilitator language line up
   — the rep should get a coherent, honest brief, not a stall.
3. **Skill-won't-install scenario** — simulate a rep's device failing to install `account-research`
   during setup. Confirm the cheat sheet's flagging step, the IT-floater hand-off, and the fallback
   pack all connect smoothly and quickly enough that the rep isn't sitting idle mid-plenary.

**Pass criteria:**
- For all three scenarios, a rep who hits them can still meaningfully participate (via the fallback
  pack) inside roughly the same session window as everyone else.
- Every "when a rep asks X, say Y" line on the cheat sheet is usable **verbatim**, live, without the
  facilitator paraphrasing or padding it — if it needs paraphrasing to make sense, it needs a
  rewrite, not a mental note.
- The IT floater's trigger-to-action hand-off is unambiguous (they know exactly what "flagged" means
  and what to do next).

**What to watch for:**
- Any degraded-mode branch that Rung A or B actually surfaced but that has **no matching entry** on
  the cheat sheet yet — that's a real gap, not a hypothetical one.
- Cheat-sheet language that reads fine on paper but is slow or awkward to say out loud under time
  pressure.
- A fallback hand-off that technically "works" but leaves the rep visibly behind the room for the
  rest of the exercise (signals the fallback needs to be faster, not just eventually correct).

**Failure forces:** the specific cheat-sheet line or section gets amended before SKO (this is a
required edit to `course/facilitator-cheat-sheet.md`, build step 6's deliverable — not a new
document). If a Rung A/B failure mode surfaced with no scripted response, it gets added here first.

---

## Results-capture table

Fill in after each rung. This table is the artifact that feeds Gate D and the Salesforce-demotion
fallback decision — not a narrative summary.

| Rung | Date run | Result (✅ / 🟡 / ❌) | Key finding | Action forced | Owner | Re-run needed? |
|---|---|---|---|---|---|---|
| A — Dave solo | | | | | Dave | |
| B — 5 reps concurrent | | | | | Dave | |
| B — per-rep detail | auth success (n/5): __ · SF-pull throttled (Y/N, threshold: __ concurrent) · full-plan completions (n/5): __ | | | | Dave | |
| C — facilitator dry-run | | | | | Dave | |

## Feeds back into Gate D + the Salesforce-demotion decision

Gate D's original fallback trigger was *licenses refused*. The pilot ladder adds a second, later
trigger on the **same** decision: licenses granted but the mechanism doesn't hold up under real
conditions. Re-open the Salesforce-demotion fallback (Salesforce → facilitator-demo only,
hand-filled context becomes the primary Enterprise path) if **any** of the following is true after
the pilot ladder:

- Rung B shows SF throttling that can't be resolved by staggering pulls within a room-sized number
  of tables (i.e. the safe concurrency threshold is too low to run a full SKO room even staggered).
- Gate C's object-scope caveat (Activities/Tasks) is still genuinely unverified — not just sparse —
  as of the pilot, and the qualification-translation prompt depends on it.
- Rung A or B surfaces a fixture-shape failure (missing section, uncapped list, un-tagged claim)
  that can't be fixed with one edit-and-rerun cycle before SKO.

Record the final decision, with date, directly in `02-DAY1-PLATFORM-GATE.md` Gate D alongside the
original license outcome — one decision record, not two.
