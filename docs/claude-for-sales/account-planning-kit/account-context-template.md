# Account Context Template — Claude for Sales

Fill this in **before** you run any prompt card or skill. It's the seed context every downstream
research brief or account plan builds on — the only typing you do in the first minutes of the
breakout. Pick **one real account from your own territory** and carry it all day.

Two versions below: **Enterprise (6 fields)** for the Account Cockpit, **Beginner (7 fields)** for
the Account Research Starter. Both are filled from the same fictional fixture account — **Harbor &
Vine Restaurant Group** — so you can see exactly what "good" looks like before you type your own.

> **If Salesforce data looks sparse or a field won't populate: that means check your access, not
> that something is broken.** Salesforce sharing rules are the boundary — this kit never asks you
> to widen your visibility. Flag it to the IT floater and keep going with what you have.

---

## Enterprise — 6-Field Account Context

*Used in the Account Cockpit Project. Fill these six fields only-typing (0:00–0:08 of the
breakout) — the Salesforce pull in Prompt 2 enriches everything after this.*

| # | Field | Why it matters | Example (Harbor & Vine) |
|---|-------|-----------------|--------------------------|
| 1 | **Account name** | Must match the Salesforce Account name exactly — this is the key the Salesforce pull (Prompt 2) and every downstream research query use to find the right company. A near-miss spelling pulls the wrong account or nothing. | Harbor & Vine Restaurant Group |
| 2 | **Segment / vertical** | Tells the research skill what kind of operator this is (QSR, fast-casual, full-service, hotel, multi-concept) — shapes which trade press, comps, and buying-signal sources are worth checking. | Multi-concept restaurant group (fast-casual + full-service) |
| 3 | **Deal stage / opportunity** | Anchors the plan to a real, named Salesforce Opportunity — not a generic "prospecting" exercise. Drives the qualification-translation language in Section 8 (a Discovery-stage deal reads very differently than a late-stage one). | "Harbor & Vine — Workforce Management" · Stage: Discovery |
| 4 | **Opportunity close date** | The real deadline the whole plan builds toward — not a renewal date (this is new-logo). Anchors the Play-by-Quarter (Section 6) and Mutual Close Plan (Section 7) to an actual timeline instead of a made-up one. | 2026-10-31 (per Salesforce Opportunity) |
| 5 | **Known stakeholder(s)** | Whatever name(s) or roles you already know — from a past call, a Salesforce Contact, or general awareness. Gives the buying-committee mapping (Section 2 / Prompt 3) a confirmed starting point instead of starting from zero. | COO / VP Operations — J. Marlow (also the Salesforce primary contact) |
| 6 | **Territory confirmation** | A one-line gut-check that this account is genuinely yours — Salesforce sharing rules are the access boundary, and confirming this up front avoids working an account you don't own. | Mid-Atlantic Enterprise — confirmed my territory |

---

## Beginner — 7-Field Account Context

*Used in the Account Research Starter Project. Fill all seven before running the `account-research`
skill. No Salesforce pull for this tier — built-in web search only — so field 7 (Research Goal)
gives the skill a target instead of running open-ended.*

| # | Field | Why it matters | Example (Harbor & Vine) |
|---|-------|-----------------|--------------------------|
| 1 | **Account name** | The exact company name the research skill searches for. Get this right — a vague or partial name (e.g. "Harbor Vine" or just "Vine & Sprout," one of its two brands) sends the search down the wrong path. | Harbor & Vine Restaurant Group |
| 2 | **Segment / vertical** | Points the skill at the right curated sources (QSR trade press vs. full-service vs. hotel) instead of a generic keyword search. | Multi-concept restaurant group (fast-casual + full-service) |
| 3 | **Deal stage / opportunity** | If there's an open opportunity, name it — it sharpens the C5 cold-call brief. If this account isn't in the pipeline yet, that's fine: say so plainly. | Not yet in pipeline — pure prospecting |
| 4 | **Opportunity close date** | Only fill this if an opportunity exists. If prospecting, write "N/A — no opportunity yet." Never guess a date to fill the box. | N/A — no opportunity yet |
| 5 | **Known stakeholder(s)** | Any name or role you already have, even a guess at a title. Gives C2 (Buying-Committee Map) a lead to confirm or correct rather than starting cold. | Believe there's a COO named Marlow — unconfirmed |
| 6 | **Territory confirmation** | Confirms this account is in your own territory before you spend research time on it. | Mid-Atlantic — confirmed my territory |
| 7 | **Research goal** | The one thing you actually need out of this session — sharpens which of the five cards gets the most attention and keeps the brief from becoming padding. | Get contact-ready before my first cold call — need an opener and a first-call target |

---

## Notes for both tiers

- **This is typing only** — no research happens until the template is filled. Resist the urge to
  look anything up yet; that's what the skill/prompt chain is for.
- **Unknown is a valid answer.** Every field can honestly say "not sure" or "verify manually" —
  never guess a name, date, or stage to make the box look complete. The no-fabrication rule that
  governs the research output starts here, with you.
- **One account, all day.** The same account you type in here is the one you carry through the
  breakout and (if selected) the fallback pack you'd fall back to if setup fails.

---

*Print-ready. Part of the Account Planning Kit — Claude for Sales Package, SKO 2026.*
