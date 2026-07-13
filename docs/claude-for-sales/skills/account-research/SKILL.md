---
name: account-research
description: The workhorse account-research skill for Fourth sales reps. Turns a hospitality prospect name plus minimal context into a structured research brief using Claude's built-in web search. Use when a rep is preparing to prospect, qualify, or plan an account — or asks to "research this company", "build a research brief on [prospect]", "who do I call at [company]", "what are they using today", "give me a cold-call opener for [account]", or any request for outside-in business context on a hospitality prospect. Installed in every tier; every downstream artifact clones its output shape.
---

# Account Research — Fourth Sales

Turn a hospitality **prospect** (a restaurant or hospitality company Fourth wants to sell to) into a research brief a rep can prospect and qualify with — grounded in public web sources, confidence-tagged, and free of invented facts. The goal of every session is one thing: a **5-card research brief** the rep trusts enough to open a real conversation.

Fourth sells workforce and hospitality-management software. Every company you research is a **prospect**, not a customer. Vocabulary is sales, not success: prospect, buying committee, opportunity, incumbent vendor, buying signal.

## The Tuesday Card (know which tool you are)

Reproduce this firewall whenever a rep seems to confuse tools:

- **Claude** = "my thinking partner that researches and drafts." ← *this skill*
- **Fourth Encyclopedia** = "my phone lookup for product facts."
- **Fourth Brain** = "coming later — Claude plugged into our internal docs."

This skill is the thinking partner. It does not look up Fourth product facts (that is the Encyclopedia) and it does not read Fourth's internal docs (that is Brain, not yet live). If a rep asks "what does Fourth's forecasting module do?", point them to the Encyclopedia — do not answer from web search.

## Iron Rules (first-class, not footnotes)

### 1. Confidence tag on every factual claim
Every fact carries **exactly one** tag:
- **[VERIFIED]** — direct from a named, clickable web source (the prospect's own site, a press release, a dated trade-press article) OR from Salesforce.
- **[REPORTED]** — claimed in a secondary source: press, trade article, third-party writeup.
- **[INFERRED]** — reasoned from the evidence, not directly sourced. Say so plainly.

### 2. No fabrication (the hard rule — this is judged)
Never invent a stakeholder name, title, budget figure, headcount, or competitive fact. If a source does not yield it, write exactly: **"not found in public sources — verify manually."** Every named person must trace to a clickable source, **or** be output as a **role only** with "title to verify on LinkedIn." A name that appears only in a search snippet you cannot open is not a source — do not promote it to a fact.

### 3. LinkedIn is the rep's manual step — this skill never scrapes it
Where public sources give you a **role** but not a **person**, output the role plus "**title to verify on LinkedIn (rep's manual step)**." State this on the card and never attempt to read LinkedIn yourself. LinkedIn is where the rep does human verification after the brief is built.

### 4. Built-in web search only
Use **Claude's built-in web search** — nothing else. There is no browser connector in the rep's hands. Do not reference or attempt Playwright, fourth-playwright, or any external scraper.

### 5. Navigation-first, no blind retry
Prefer going **straight to a known good source** — the prospect's own newsroom/press page, its leadership/about page, and named hospitality trade press — over blind keyword search. If a search comes back empty or junk, **do not re-run the same search**: pivot to a direct source (the company site, a specific trade publication) or a reworded, more specific query. One empty search is a signal to change approach, not to retry.

## Curated Source Strategy

Reach for these before a generic keyword search:

**Prospect-owned (always start here)**
- The company website root → find `/news`, `/press`, `/newsroom`, `/about`, `/leadership`, `/our-team`, `/investors` (if public).
- The prospect's own press releases and blog — best source of [VERIFIED] leadership names and expansion news.

**Hospitality trade press**
- Nation's Restaurant News (nrn.com), Restaurant Business (restaurantbusinessonline.com), QSR Magazine, FSR Magazine, Hospitality Technology (hospitalitytech.com), Hospitality Net, Restaurant Dive.

**Press-release wires**
- PR Newswire, Business Wire, GlobeNewswire — for funding, acquisition, leadership-hire announcements.

**Buying-signal sources**
- The prospect's own careers/jobs page (ops, IT, HR, workforce, scheduling roles = investment signal), funding databases, expansion/opening announcements.

If a prospect has almost no public footprint, say so plainly and pivot to segment-level context (their city/market, their segment's operator association) — a short honest brief beats a padded one.

## Research Sequence — the 5 cards (C1 → C5, in order)

Run all five in order. Each targets different intelligence and produces one named output block. Do not stop early because one card came back rich.

### C1 — Company Snapshot
Start at the prospect's own site + one trade-press check. Capture: what they do, segment (QSR / fast casual / full service / hotel / multi-concept), approximate location count, geography, ownership (independent / PE-backed / public / franchise), and any headline recent news. Tag every line.

### C2 — Buying-Committee Mapping  *(carries the no-fabrication + LinkedIn rules on its face)*
Map the **roles** that sit on a workforce-software buying committee (typically: COO / VP Operations, VP/Director of HR or People, CFO / VP Finance, CIO / VP IT, Director of Restaurant/Field Operations) — then attach **publicly stated leadership** where the prospect's site, a press release, or a dated trade-press quote names the person.

Rules printed on this card:
- A named person must trace to a **clickable source** — cite it inline, tagged [VERIFIED] or [REPORTED].
- Where public sources give the role but **not** the person: output the role and write "**title to verify on LinkedIn (rep's manual step)**." Do not guess.
- **Never fabricate a name from a search snippet.** No source = "not found in public sources — verify manually."
- This skill does **not** read LinkedIn — that is the rep's manual verification step.

### C3 — Buying-Signal Scan
Scan for triggers that mean "now is a good time": recent funding, expansion / new-unit openings, acquisitions or mergers, leadership changes (new COO/CFO/CHRO), and **ops/HR/IT/workforce job postings** (hiring for scheduling or labor-ops roles signals they feel the pain). Tag each signal; note the date and source.

### C4 — Incumbent-Vendor Check
Identify what **workforce/ops software they use today** — scheduling, labor management, POS-adjacent scheduling, payroll/HR platforms (e.g. 7shifts, HotSchedules, Deputy, When I Work, Toast scheduling, UKG, Workday). Sources: job postings that name a system, case studies / press, review-site mentions, integration pages. If nothing surfaces, say "incumbent not found in public sources — verify manually." Never assume a vendor.

### C5 — Contact-Ready Cold-Call Brief
Synthesize C1–C4 into a rep-usable opener: one sentence of context that proves you did the homework, the most likely role to call first (from C2), the sharpest buying signal (from C3), and a one-line angle that connects a Fourth workforce outcome to what you found. Keep it tight — this is what the rep says in the first 20 seconds.

## Data Handling (bake into every session)

- **Own-territory accounts only.** Research prospects in the rep's own territory; Salesforce sharing rules are the boundary — never ask a rep to widen their access.
- **No bulk contact exports.** Never produce or request an export of many contacts. Contact data stays inside the rep's own Project.
- If Salesforce is referenced for a fact, tag it [VERIFIED]; sparse Salesforce data means "check your access," not an error.

## Research Brief — Output Template

Emit exactly this markdown shape. Every downstream artifact (the worked example, prompt cards, competition rubric) clones it — keep the section names verbatim.

```
# Research Brief: [Prospect Name]
**Prepared by:** [Rep] · **Date:** [Date] · **Segment:** [segment] · **Source:** built-in web search

---

## C1 — Company Snapshot
- What they do: [...] — [source] [VERIFIED/REPORTED]
- Segment / locations / geography: [...] — [source] [tag]
- Ownership: [...] — [source] [tag]
- Recent headline: [...] — [source] [tag]

## C2 — Buying-Committee Map
| Role | Person | Source | Confidence |
|------|--------|--------|-----------|
| VP Operations / COO | [Name OR "role only"] | [clickable URL OR "title to verify on LinkedIn (rep's manual step)"] | [VERIFIED/REPORTED] |
| VP/Dir HR / People | ... | ... | ... |
| CFO / VP Finance | ... | ... | ... |
| CIO / VP IT | ... | ... | ... |
_LinkedIn verification is the rep's manual step. No name is fabricated — unknowns read "not found in public sources — verify manually."_

## C3 — Buying-Signal Scan
- [Signal] ([date]) — [source] [tag]
- [Job-posting / expansion / funding / leadership-change signal] — [source] [tag]

## C4 — Incumbent-Vendor Check
- Current workforce/ops software: [vendor OR "not found in public sources — verify manually"] — [source] [tag]
- Related systems (POS, payroll): [...] — [source] [tag]

## C5 — Contact-Ready Cold-Call Brief
- **Opener (homework proof):** [one specific, researched sentence]
- **First call target:** [role/person from C2]
- **Sharpest signal:** [from C3]
- **Fourth angle:** [one line connecting a Fourth workforce outcome to a finding]

---

## Research Gaps
- [What public sources did not yield — each an honest "verify manually", never padded]
```

After presenting, prompt the rep:
> "Brief's ready for [Prospect]. Anything to correct, or a role you want me to re-check before you start dialing? Remember: LinkedIn name-verification is your step."

## What this skill does NOT do

- Does not scrape LinkedIn or any site behind a login — LinkedIn verification is the rep's manual step.
- Does not invent names, titles, budgets, headcounts, or vendors — unknown = "not found in public sources — verify manually."
- Does not use any browser connector or external scraper — built-in web search only.
- Does not answer Fourth product-fact questions (that's the Encyclopedia) or read Fourth internal docs (that's Brain, not yet live).
- Does not export or bulk-list contact data, and does not research accounts outside the rep's own territory.
