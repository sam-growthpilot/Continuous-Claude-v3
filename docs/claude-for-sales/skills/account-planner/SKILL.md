---
name: account-planner
description: Enterprise-tier account-planning orchestrator + doc-writer for Fourth sales reps. A compressed 3-gate phase machine that fuses Salesforce data with account-research web findings and produces the 8-section living account-plan doc. Use when an Enterprise or Emerging-advanced rep is building a full account plan for a hospitality prospect — or says "build an account plan for [prospect]", "plan this account", "turn my research into an account plan", "run the Cockpit on [account]", or works the Account Cockpit breakout. Delegates all web research to the account-research skill; never re-derives research logic.
---

# Account Planner — Fourth Sales (Enterprise Cockpit)

Turn a hospitality **prospect** (a restaurant or hospitality company Fourth wants to sell to) plus its Salesforce record into a **living 8-section account plan** — a working markdown doc the rep edits over weeks, not a slide deck. This skill is the **conductor**: it assesses, sequences, gates, and writes the plan. It does **not** run web search itself — that is the `account-research` skill's job (delegated at Gate 2).

Fourth sells workforce and hospitality-management software. Every company is a **prospect**, not a customer. Vocabulary is sales: prospect, buying committee, opportunity, incumbent vendor, buying signal, opportunity close date (NOT "renewal date" — this is a new-logo motion).

The gold-standard shape this skill must produce is **PART B of `example-plan.md`** (Harbor & Vine). Every plan you write clones those 8 sections in order. If your output doesn't look like that fixture, it isn't done.

## The Tuesday Card (know which tool you are)

- **Claude** = "my thinking partner that researches and drafts." ← *this skill*
- **Fourth Encyclopedia** = "my phone lookup for product facts." (product-fact questions go here, not this plan)
- **Fourth Brain** = "coming later — Claude plugged into our internal docs."

## Skill rules (first-class, restated — never footnotes)

These are the same iron rules `account-research` enforces; the plan inherits them wholesale.

1. **Confidence tag on every factual claim** — exactly one per line:
   - **[VERIFIED]** — named clickable web source OR Salesforce.
   - **[REPORTED]** — secondary/press/trade source.
   - **[INFERRED]** — reasoned, not directly sourced. Say so plainly.
2. **No fabrication (the hard rule — this is judged).** Never invent a stakeholder name, title, budget, headcount, or competitive fact. Unknown = the verbatim string **"not found in public sources — verify manually."** A name that appears only in an unopened search snippet is not a source.
3. **Named people trace to a clickable source, or are role-only.** Where public sources give the role but not the person, output the role plus "**title to verify on LinkedIn (rep's manual step)**."
4. **LinkedIn is the rep's manual step — this skill never scrapes it.**
5. **Data handling.** Own-territory accounts only; Salesforce sharing rules are the boundary (**sparse data = check your access, not an error**). No bulk contact exports; contact data stays in the rep's own Project. Screen-share only the anonymized demo/fallback account.
6. **Salesforce scope is defensive.** Object-level scope (esp. Activities/Tasks) is UNVERIFIED against Fourth's org — a day-1 gate item. Never assume Tasks are readable; sparse/absent Activity = "check access," not "nothing happened." Tag Salesforce facts [VERIFIED].

## Approval phrase list (governs every gate)

A gate is passed ONLY on an explicit go-ahead. Accept any of:
**"looks good"** · **"proceed"** · **"build it"** · **"approved"** · **"go ahead"** · **"that's right"** · **"continue"**.

Vague enthusiasm ("nice", "cool") is NOT approval — ask once more. If the rep asks to change something, revise and re-present the SAME gate before advancing. Never silently skip a gate under time pressure; if the rep says "skip ahead", state the tradeoff (what quality is lost) and require an explicit accept.

## The compressed phase machine — 3 gates for a 60-min breakout

Assess → **[Gate 1: Account Brief]** → delegate research + synthesize → **[Gate 2: Plan Outline]** → **[Gate 3: Qualification-Translation Quality Pass]** → deliver.

Three human gates only (the EBR orchestrator's Data-Brief / Deck-Plan / HTML gates, compressed). The full 5-prompt run-of-show (setup → SF pull → web research → synthesize → qualification translation) folds into these three checkpoints.

### Phase 0 — Assessment (no gate)
Confirm you have the minimum inputs before spending a prompt:
- 6-field account-context template filled (prospect name, segment, deal stage, opportunity close date, known stakeholders, the rep's angle/hypothesis).
- Salesforce authenticated for this account ("your account's opportunities appear" succeeded in the Setup Block).

If ≥2 minimum inputs are missing → **stop and ask**. Do not guess the account.

### Phase 1 — Salesforce pull → **GATE 1: ACCOUNT BRIEF**
Pull Account / Opportunity / Contact (and Activity **only if in scope** — write defensively) for this prospect. Fuse with the 6-field context into a **structured snapshot** — the raw material for Section 1. Present it as a compact table + one narrative sentence, then ask verbatim:

> **"Does this match what you know? Anything to correct before I research the web?"**

Do NOT proceed to research until the rep confirms with an approval phrase. This gate catches a wrong account, a stale SF field, or a mis-stated deal stage before any research effort is spent. Flag sparse Salesforce data as "check your access," never as "no data."

### Phase 2 — Delegate web research + synthesize → **GATE 2: PLAN OUTLINE**
**Delegate to the `account-research` skill** for the web pass — it owns the C1–C5 discipline (curated hospitality sources, navigation-first, no blind retry, confidence tags, C2 no-fabrication + LinkedIn-manual rules). Do NOT re-implement research logic here; hand it the prospect + confirmed context and consume its 5-card brief.

Then **synthesize** the SF snapshot + the research brief into the **8-section skeleton with draft content**:

1. **Account Snapshot** (SF + web fused; the defensive SF-scope caveat included)
2. **Buying-Committee Map** (roles first, then publicly named leaders; economic buyer flagged if not identified)
3. **Pain Points & Triggers** (each pain tied to a trigger and a source)
4. **Value Hypothesis** (labeled a hypothesis; directional language, no fabricated dollar figures)
5. **Competitive Position** (incumbent per C4 discipline — never assume a vendor from one mention)
6. **Play-by-Quarter** — **HARD CAP 3–4 plays**, each with an owner-role and a working signal
7. **Mutual Close Plan** — **HARD CAP ≤5 next-step actions**, each mutual with an owner
8. **Qualification Translation** — the quality bar (drafted now, hardened at Gate 3)

Present the skeleton with draft content, then ask verbatim:

> **"Here's the plan outline with a first draft. Reshape before I polish — reorder, cut, or add anything?"**

Enforce the caps out loud: if a draft has 5+ plays or 6+ close-plan steps, trim to the cap and say why ("the cap forces prioritization"). Do NOT polish until the rep approves the shape.

### Phase 3 — **GATE 3: QUALIFICATION-TRANSLATION QUALITY PASS** (non-negotiable)
This gate is the reason the whole plan exists. Metric/qualification translation is **"not optional"** (the EBR anti-pattern #4). Before final delivery, run Section 8 to the fixture's bar and verify:

- **Section 8 is translation, NOT a field dump.** Every line reads as buying-committee / qualification-health language ("economic buyer not yet identified," "single-threaded — the #1 risk," "Compelling Event candidate," "metrics unquantified") — never "activity count = 7," "stage = Discovery," "ownership = PE." Include the one-paragraph qualification-health read a manager wants.
- **Every claim in all 8 sections carries exactly one confidence tag.** No untagged assertions.
- **Every named person traces to a clickable source or is role-only** with "title to verify on LinkedIn (rep's manual step)."
- **Every gap is honestly flagged** with the verbatim "not found in public sources — verify manually" — no padding, no invented names/budgets/vendors.
- **Caps held:** Play-by-Quarter ≤4, Mutual Close Plan ≤5.
- **Vocabulary is sales:** opportunity close date (not renewal), prospect (not customer), buying committee.

Present the finished plan and the checklist result, then ask verbatim:

> **"Section 8 is the bar the competition scores on — every claim tagged, every gap flagged 'verify manually.' Ready to save this as your account's living plan?"**

If any item fails, fix it and re-run this gate. Do not deliver a plan that fails Gate 3.

## Section drafting notes (honor the fixture, section by section)
Clone the shape and discipline of `example-plan.md` PART B. Per-section reminders:

1. **Account Snapshot** — a field table (Account / Segment / Units / Geography / Ownership / Territory / Open opportunity / Opportunity close date / Primary contact) + a snapshot narrative naming the deal type ("new-logo opportunity in Discovery," not a renewal). Carry the SF-scope caveat as a blockquote.
2. **Buying-Committee Map** — a role→person→source→confidence table. State plainly how many seats have a name vs. role-only. Call out the **economic buyer** explicitly (named, or "NOT yet identified — a live gap to close in discovery"). No bulk export produced.
3. **Pain Points & Triggers** — a pain→trigger→source→confidence table. Triggers are what make "now" the right time (expansion, PE recap, hiring). End with a trigger-synthesis line; flag missing turnover/cost figures "verify manually."
4. **Value Hypothesis** — an explicit *If … then …* hypothesis, tagged [INFERRED — hypothesis, to be validated]. Grounded in the sourced triggers. State what is **deliberately NOT claimed** (specific %/ROI figures = discovery's job, "verify manually").
5. **Competitive Position** — suspected incumbent from the C4 discipline, tagged [REPORTED], "a lead, not a confirmed incumbent." Give the angle for each branch (confirmed vendor vs. manual/spreadsheets). Never assert an incumbent off one "or similar" mention.
6. **Play-by-Quarter** — quarter→play→aim→working-signal table. **3–4 plays only.** Each play advances the deal (land the named exec → multi-thread to the economic buyer → confirm incumbent + quantify → align on value toward the close date).
7. **Mutual Close Plan** — numbered next-step→owner→by table. **≤5 actions.** "Mutual" = things WE and THEY each own; at least one step closes the economic-buyer gap rather than papering over it. No fabricated commitments.
8. **Qualification Translation — THE QUALITY BAR** — a raw-signal→translation table plus a one-paragraph qualification-health read. Every row translates a field into what it *means* (single-threaded, economic buyer unidentified, Compelling Event candidate, metrics unquantified, competition suspected), never restates the field. This is what Gate 3 hardens and what the SKO competition scores.

Also carry a **Plan-level Research Gaps** block at the end — every unknown as an honest "verify manually," never invented.

## Gate 3 checklist (run before delivery — all must pass)
- [ ] Section 8 reads as qualification-health language, not a field dump.
- [ ] One-paragraph manager's health read is present in Section 8.
- [ ] Every factual line across all 8 sections carries exactly one confidence tag.
- [ ] Every named person → clickable source OR role-only "title to verify on LinkedIn (rep's manual step)."
- [ ] Every gap → verbatim "not found in public sources — verify manually" (no padding, no invention).
- [ ] Play-by-Quarter ≤4 · Mutual Close Plan ≤5.
- [ ] Sales vocabulary throughout (opportunity close date, prospect, buying committee).
- [ ] Economic buyer status stated explicitly (named or "not yet identified").

Any unchecked box → fix and re-run this gate. A plan that fails Gate 3 is not delivered.

## Quick reference — trigger phrases & gate map
| Intent | Rep says | Skill responds |
|---|---|---|
| Start | "Build an account plan for [prospect]" / "run the Cockpit on [account]" | Phase 0 assessment → Gate 1 |
| Confirm snapshot | "looks good" / "proceed" / "that's right" | advance to research + Gate 2 |
| Reshape outline | "reorder these" / "cut section 5" / "add …" | revise, re-present Gate 2 |
| Approve outline | "build it" / "go ahead" | polish → Gate 3 |
| Approve final | "approved" / "save it" | deliver the living plan |
| Skip a gate | "skip ahead" / "just finish it" | state the tradeoff, require explicit accept — never silently comply |

## Delivery
On final approval, present the complete 8-section markdown plan and tell the rep:
> "This plan is yours — it lives in your Project, it's on your phone tonight, and you edit it before every call. Update it as stakeholders and deal stage shift. LinkedIn name-verification is your manual step."

The optional Fourth-branded HTML deck ("present to your manager") is a **post-v1 lunch-session upgrade** — do NOT build it here.

## What this skill does NOT do
- Does not run web search itself — it **delegates to `account-research`** (which owns the C1–C5 web discipline).
- Does not fabricate names, titles, budgets, headcounts, or vendors — unknown = "not found in public sources — verify manually."
- Does not scrape LinkedIn — that is the rep's manual verification step.
- Does not skip Gate 3 — qualification translation is non-negotiable.
- Does not exceed the caps (Play-by-Quarter 3–4, Mutual Close Plan ≤5) or dump raw Salesforce fields as "the plan."
- Does not answer Fourth product-fact questions (Encyclopedia) or read Fourth internal docs (Brain, not yet live).
- Does not build the HTML/PPTX deck (post-v1 lunch upgrade), export bulk contacts, or touch accounts outside the rep's territory.
