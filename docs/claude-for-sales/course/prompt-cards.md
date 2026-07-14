# Claude for Sales — Print-Ready Prompt Cards

**How to use these:** each card below is one laminated card. Paste the **PROMPT** text
into your Claude Project exactly as written, swapping in your own account where you see
`[Prospect Name]`. The `account-research` skill (both tiers) and `account-planner` skill
(Enterprise) are already installed in your Project — the prompts trigger them.

**The Tuesday Card (know which tool you are):** Claude = "my thinking partner that
researches and drafts." · Fourth Encyclopedia = "my phone lookup for product facts." ·
Fourth Brain = "coming later — Claude plugged into our internal docs."

**Confidence tags (one per fact):** `[VERIFIED]` named clickable source OR Salesforce ·
`[REPORTED]` secondary/press · `[INFERRED]` reasoned.

**The gold standard for every card is `example-plan.md` (Harbor & Vine).** If your output
doesn't look like that fixture, it isn't done.

---
---

# BEGINNER SET — Account Research Starter (C1–C5)

*Five cards, run in order. Beginners produce a 5-card research brief. Don't stop early
because one card came back rich. Built-in web search only — no LinkedIn scraping.*

---

## CARD C1 — Company Snapshot

**PROMPT (paste this):**
> Research the hospitality prospect **[Prospect Name]** and build the **C1 — Company
> Snapshot** section of my research brief using built-in web search only. Start at their
> own website (look for /news, /press, /about, /leadership) plus one hospitality
> trade-press check. Capture: what they do, segment (QSR / fast casual / full service /
> hotel / multi-concept), approximate location count, geography, ownership (independent /
> PE-backed / public / franchise), and any headline recent news. Put exactly one
> confidence tag on every line. Use the skill's Research Brief output shape.

**What good output looks like:** four tagged lines (what they do · segment/locations/
geography · ownership · recent headline), each ending in a clickable source + one tag —
see fixture **C1** (Harbor & Vine).

**On-card rule:** every line carries exactly one `[VERIFIED]/[REPORTED]/[INFERRED]` tag.
Unknown = "not found in public sources — verify manually." Never pad a thin footprint.

---

## CARD C2 — Buying-Committee Map

**PROMPT (paste this):**
> Build the **C2 — Buying-Committee Map** for **[Prospect Name]**. First map the *roles*
> that sit on a workforce-software buying committee (COO / VP Operations, VP/Director of
> HR or People, CFO / VP Finance, CIO / VP IT, Director of Restaurant/Field Operations).
> Then attach **publicly stated leadership** ONLY where their own site, a press release,
> or a dated trade-press quote names the person — cite the clickable source inline and
> tag it. Output the role→person→source→confidence table from the skill.

**What good output looks like:** the role→person→source→confidence table where usually
only 1 seat has a real name (traced to a clickable press release) and the rest read
role-only — see fixture **C2** (only the COO is named; everyone else is role-only).

**On-card rules (verbatim — this card carries the no-fabrication firewall):**
- A named person must trace to a **clickable source**, tagged `[VERIFIED]` or `[REPORTED]`.
- Where public sources give the role but **not** the person, output the role plus
  "**title to verify on LinkedIn (rep's manual step)**." Do not guess.
- **Never fabricate a name from a search snippet.** No source =
  "**not found in public sources — verify manually**."
- Claude does **not** read LinkedIn — LinkedIn verification is **the rep's manual step**.

---

## CARD C3 — Buying-Signal Scan

**PROMPT (paste this):**
> Run the **C3 — Buying-Signal Scan** for **[Prospect Name]**. Scan for triggers that mean
> "now is a good time": recent funding, expansion / new-unit openings, acquisitions or
> mergers, leadership changes (new COO/CFO/CHRO), and **ops/HR/IT/workforce job postings**
> (hiring for scheduling or labor-ops roles signals they feel the pain). Tag each signal
> and note its date and source. Flag the strongest signal.

**What good output looks like:** a short list of dated, sourced, tagged signals with the
strongest one called out (e.g. a dated expansion announcement) — see fixture **C3**, where
the 10–12 unit expansion is flagged as the strongest signal.

**On-card rule:** every signal gets a date, a source, and one tag. A missing signal =
"not found in public sources — verify manually," never invented.

---

## CARD C4 — Incumbent-Vendor Check

**PROMPT (paste this):**
> Do the **C4 — Incumbent-Vendor Check** for **[Prospect Name]**. Identify what
> workforce/ops software they use today — scheduling, labor management, payroll/HR
> platforms (e.g. 7shifts, HotSchedules, Deputy, When I Work, Toast scheduling, UKG,
> Workday). Sources: job postings that name a system, case studies/press, review-site
> mentions, integration pages. If nothing surfaces, say so plainly. Never assume a vendor.

**What good output looks like:** a current-software line + related-systems (POS/payroll)
line, each tagged; a single "or similar" job-posting mention is treated as a *lead, not a
confirmed incumbent* — see fixture **C4** (HotSchedules treated as a lead to verify).

**On-card rule:** never assume a vendor from one mention. Nothing found =
"incumbent not found in public sources — verify manually." Confirm in discovery.

---

## CARD C5 — Contact-Ready Cold-Call Brief

**PROMPT (paste this):**
> Synthesize C1–C4 into the **C5 — Contact-Ready Cold-Call Brief** for **[Prospect Name]**,
> using these four fixed sub-fields:
> **Opener** (one researched sentence that proves I did the homework) · **First call
> target** (most likely role/person to call first, from C2) · **Sharpest signal** (from
> C3) · **Fourth angle** (one line connecting a Fourth workforce outcome to what you
> found). Keep it tight — this is my first 20 seconds.

**What good output looks like:** the four sub-fields, tight and specific, opener anchored
to a real dated signal — see fixture **C5** (opener quotes the 10–12 unit expansion).

**On-card rules:** the four sub-fields are fixed: **Opener / First call target / Sharpest
signal / Fourth angle.** No fabricated numbers. Product-fact specifics belong in the
Fourth Encyclopedia, not the opener.

---
---

# ENTERPRISE SET — Account Cockpit (5 breakout prompts)

*Five prompts, in order: setup → Salesforce pull → web research → synthesize →
qualification translation. The `account-planner` skill gates this run (3 gates). Five is a
hard cap. Output = the living 8-section account-plan doc — clone fixture PART B.*

---

## ENTERPRISE CARD 1 — Setup: Account Context (the only typing)

**PROMPT (paste this):**
> I'm building an Enterprise account plan for **[Prospect Name]**. Here is my 6-field
> account context — read it and hold it, don't research yet:
> **Prospect name:** [ ] · **Segment:** [ ] · **Deal stage:** [ ] · **Opportunity close
> date:** [ ] · **Known stakeholders:** [ ] · **My angle / hypothesis:** [ ]
> Confirm you have all six, then wait for me to pull Salesforce.

**What good output looks like:** Claude confirms the 6 fields and stops — no research yet.
This is Phase 0 assessment (no gate). It corresponds to the fixture PART B setup.

**On-card rule:** this is the only typing step. Use "opportunity close date," NOT "renewal
date" — this is a new-logo motion. Own-territory account only.

---

## ENTERPRISE CARD 2 — Salesforce Pull → Account Snapshot (GATE 1)

**PROMPT (paste this):**
> Pull Salesforce for **[Prospect Name]** — Account, Opportunity, Contact (and Activity
> **only if in scope** — write defensively; sparse data means "check my access," not "no
> data"). Fuse it with my 6-field context into a compact **Section 1 — Account Snapshot**:
> a field table + one narrative sentence naming the deal type. Tag Salesforce facts
> `[VERIFIED]`. Then ask me the Gate 1 question and wait.

**What good output looks like:** the Section 1 field table (Account / Segment / Units /
Geography / Ownership / Territory / Open opportunity / Opportunity close date / Primary
contact) + a snapshot narrative, then the verbatim gate question
**"Does this match what you know? Anything to correct before I research the web?"** — see
fixture **§1**.

**On-card rule (GATE 1):** the plan does NOT advance to research until you reply with an
approval phrase — **"looks good" / "proceed" / "that's right" / "go ahead."** Sparse
Salesforce = check your access, not an error.

---

## ENTERPRISE CARD 3 — Web Research (delegates to account-research)

**PROMPT (paste this):**
> Now run the web research pass for **[Prospect Name]** using the **account-research**
> skill (built-in web search only, curated hospitality sources, navigation-first, no blind
> retry). Produce the full C1–C5 brief with confidence tags, the C2 no-fabrication +
> LinkedIn-manual discipline, and honest research gaps. Don't build the plan yet — I want
> the 5-card brief first.

**What good output looks like:** the complete C1–C5 research brief (same shape as the
Beginner set), every fact tagged, C2 role-only where names aren't public — see fixture
**PART A** (C1–C5).

**On-card rule:** the planner **delegates** research to account-research — it never invents
its own research logic. Named people trace to a clickable source or read
"title to verify on LinkedIn (rep's manual step)." Unknown =
"not found in public sources — verify manually."

---

## ENTERPRISE CARD 4 — Synthesize → Plan Outline (GATE 2)

**PROMPT (paste this):**
> Synthesize the Salesforce snapshot + the C1–C5 brief into the **8-section plan outline
> with draft content**, in order: 1 Account Snapshot · 2 Buying-Committee Map · 3 Pain
> Points & Triggers · 4 Value Hypothesis · 5 Competitive Position · 6 Play-by-Quarter
> (**cap 3–4**) · 7 Mutual Close Plan (**cap ≤5**) · 8 Qualification Translation. Enforce
> the caps out loud. Then ask me the Gate 2 question and wait.

**What good output looks like:** all 8 sections drafted in order, caps held (≤4 plays, ≤5
close-plan steps), economic buyer flagged if not identified, then the verbatim gate
question **"Here's the plan outline with a first draft. Reshape before I polish — reorder,
cut, or add anything?"** — see fixture **§§1–8**.

**On-card rule (GATE 2):** reshape at the outline, not after polishing. The planner trims
5+ plays or 6+ close steps to the cap and says why ("the cap forces prioritization").
Advance only on **"build it" / "go ahead."**

---

## ENTERPRISE CARD 5 — Qualification Translation (GATE 3 — THE QUALITY BAR)

**PROMPT (paste this):**
> Run **Section 8 — Qualification Translation** to the bar and Gate-3-check the whole plan.
> Section 8 must be **translation, not a field dump**: every row turns a raw SF/research
> signal into buying-committee / qualification-health language (e.g. "economic buyer not
> yet identified," "single-threaded — the #1 risk," "Compelling Event candidate," "metrics
> unquantified"), plus the one-paragraph qualification-health read a manager wants. Verify
> every claim is tagged, every named person traces to a source or is role-only, every gap
> reads "not found in public sources — verify manually," and the caps held. Then ask me the
> Gate 3 question.

**What good output looks like:** a raw-signal→translation table + the manager's
one-paragraph health read, reading as MEDDPICC-style relationship health — NOT
"activity count = 7" / "stage = Discovery." **This is fixture §8 — the exact bar the SKO
competition scores on.** End with the verbatim gate question
**"Section 8 is the bar the competition scores on — every claim tagged, every gap flagged
'verify manually.' Ready to save this as your account's living plan?"**

**On-card rule (GATE 3 — non-negotiable):** if any check fails, fix and re-run — a plan
that fails Gate 3 is not delivered. Save on **"approved" / "save it."** This is what wins
the competition.

---

*End of cards. 5 beginner (C1–C5) + 5 Enterprise = 10 total, hard cap. Validate every
output against `example-plan.md` (Harbor & Vine). Product facts → Fourth Encyclopedia;
internal-doc lookup (Fourth Brain) → coming later.*
