## Design: The Account Cockpit — a duplicatable Claude Project, one live-data research Skill, and a doc-first plan

## Core thesis (3 sentences)
The EBR pattern ports almost wholesale, but two sales-specific realities force deviation: reps are far weaker operators than CSMs (so the orchestrator must be near-invisible — one trigger phrase, merged checkpoints), and Salesforce arrives as *live in-session MCP data* rather than an uploaded package (so there is no separate "processor" project, and the connector *is* the intake layer). The account plan's primary artifact is a **living Markdown/Canvas document**, not a deck — a rep edits it over weeks before every call — with the presentation suite reserved only for the optional 10-minute-finale "snapshot." Everything else (navigation-first research, confidence scoring, translation-not-optional, no-fabrication gate) is a direct clone of proven EBR discipline.

## The blueprint (concrete: artifacts, structure, sequence)
One template Claude Project ("Account Cockpit — TEMPLATE") that reps **duplicate per account**. It contains:
- `PROJECT-INSTRUCTIONS.md` (role, inputs, checkpoints, output standards, translation table)
- 3 installable App Skills: `account-orchestrator`, `account-research` (adapted from playwright-competition), `account-plan-writer`
- Salesforce + fourth-playwright connectors enabled at the org level
- An `Onboarding-Guide.md` + a per-account fill-in `ACCOUNT-CONTEXT.md`

Sequence (compressed EBR phase machine, **3 gates instead of 4**):
```
Trigger: "Plan the <Account> account"
Phase 0   Assess + intake  → live Salesforce pull (Account/Opp/Contact/Activity)
          → CHECKPOINT 1: Account Brief ("right account, right data? add anything?")
Phase 1   Research         → fourth-playwright, navigation-first
          → CHECKPOINT 2: Intelligence Brief (merged into Brief 1 under time pressure)
Phase 2   Qualification translation + Plan Outline
          → CHECKPOINT 3: draft plan (approve / edit)
Phase 3   Write living plan doc (Canvas) — quality gate runs BEFORE showing rep
Phase 4  (optional) Snapshot slide via fourth-presentation-suite
```

## How #3 (Account Planning Kit) is built
**`PROJECT-INSTRUCTIONS.md`** — clone the EBR structure, swap the vocabulary:
- **Role:** "You help a Fourth AE build and maintain a living account plan." Reps are non-power-users → instructions must forbid the model from asking the rep to write SOQL or choose search engines.
- **Data inputs:** Source 1 = **Salesforce MCP live pull** (`sobject-reads`), not an uploaded JSON. State the load-bearing constraint verbatim: *"You see only what this rep can see in Salesforce. Sparse data = check your access, not a Claude failure."* Source 2 = Gong transcripts (direct EBR precedent). Source 3 = rep's typed notes in `ACCOUNT-CONTEXT.md`. Drop Zendesk logic entirely.
- **Checkpoints:** three gates, with explicit approval phrase-list ("looks good / approved / build it") ported from EBR — the anti-ambiguity discipline matters *more* for weak operators.
- **Output standards:** the **qualification-translation table** is the single most load-bearing port. Raw field → meaning: `stage=Proposal + no economic buyer contact` → "advancing on paper, but the person who signs isn't in the room yet." Plus the EBR **no-fabrication rule**: never invent a stakeholder name, budget, or competitor — flag the gap.
- **Confidence scoring:** keep VERIFIED (Salesforce) / REPORTED (Gong/notes) / INFERRED (web research) tags on every claim.

**`ACCOUNT-CONTEXT.md` fill-in template** — 6 fields the rep types once: account name, segment/vertical, deal stage, opportunity close date (replaces EBR renewal date; drives "close-plan framing"), named stakeholders, "what I already know / my hypothesis."

**Salesforce connector recipe** — critically, this is an **admin pre-provisioning runbook, not an at-the-table step**. IT stands up the External Client App + OAuth + enables `sobject-reads` org-wide *before* SKO. The recipe doc = the 5 steps + a "sparse-data troubleshooting" callout.

**One finished example plan** — a real (anonymized) hospitality prospect, fully worked through all phases, shipped as the reference reps copy tone/depth from.

## How #4 (installable Skills + connector) is built
Three App Skills mirroring the EBR suite's file/read-order discipline (the Build Directive naming exact files in exact order is *what makes chaining reliable* — port that wholesale):

1. **`account-orchestrator`** — stateless conductor, 3 hard gates, never writes content itself. Delegates via scripted directive blocks naming exact skills/files. Deviation from EBR: **fewer, merged checkpoints** and a "compressed mode" for the 10-min competition (Brief 1 + Brief 2 collapse into one review), because reps can't manage a 4-gate flow under a clock.

2. **`account-research`** — new skill authored on top of `fourth-playwright`'s existing generic tools (there is *no* sales skill to copy — this is genuinely new authoring). It encodes:
   - **navigation-first, search-last** (hard-code Bing; forbid Google; "if `web_search` returns empty = CAPTCHA, do NOT retry, pivot to direct URL")
   - a **curated hospitality-prospect source list** (newsrooms, trade press, PR wires) — the EBR's real edge, re-pointed at prospect-forward questions: expansion/funding/leadership news, incumbent-vendor signals, ops/IT job postings as buying signals
   - an **explicit LinkedIn scope decision: OUT.** Live LinkedIn scraping is documented-unreliable (datacenter IP gating, non-persistent httpOnly sessions). Decision baked into the skill: LinkedIn = manual rep step; connector does public-web + Salesforce contacts only.
   - a **per-rep rate guard** in the prompt ("max N pages per account per exercise") — because per-user rate-limiting middleware is unshipped.

3. **`account-plan-writer`** — output skill. Inherits brand-essentials + Lucide-not-emoji + the quality-gate-before-showing pattern from the presentation suite, but produces a **structured doc**, not HTML/PPTX by default.

**What to hone in fourth-playwright before SKO (ship-or-mitigate):**
- **Verify Railway replica count + load-test 10–30 concurrent calls.** The single shared browser instance is the #1 live-demo risk — one rep's `navigate` can yank the page from another's `extract`. If it's truly one browser: either scale replicas with sticky routing, or **stagger the competition** (not all-at-once). This is a pre-SKO gating test, not an assumption.
- Ship the P0 audit/rate-limit middleware, OR enforce the client-side cap in the skill.
- **Freeze deployments** during SKO (redeploy wipes sessions/tabs). Pre-test the *actual competition companies* 1–2 days prior.
- Avoid session save/load entirely (unneeded for public research; removes a whole failure class).

## Output format decision (doc/canvas/HTML/slides) — and defense
**Primary: a living document (Claude Canvas / Markdown artifact inside the Project). Not slides.**

Defense: an account plan and an EBR deck have *opposite* design pressures. The presentation suite's grammar (144pt numbers, one-idea-per-slide, "explain to a CFO in 30s") is optimized for a *synchronous readout moment*. An account plan is a **dense working reference a rep edits over weeks and re-reads before every call** — diffable, iterative, closer to a PRD than a QBR. Canvas specifically wins because it's editable-in-place across sessions, which is exactly the "watch the account over time" behavior the Salesforce connector *can't* do (session-bound, no memory) — the Canvas doc becomes the persistence layer the connector lacks. Sections: Account Snapshot / Stakeholder Map / Pain Points & Triggers / Value Hypothesis / Competitive Position / Play-by-Quarter / Mutual Close Plan, with a hard cap (≤5 next-step actions) to prevent data-dump creep.

**Secondary (optional, finale only): a 1–2 slide "account snapshot"** reusing the suite's KPI Card Grid + Comparison Table + Scorecard layouts — for the judgeable competition artifact. Skip full PPTX (`fourth_pptx_core.py`, 160KB) entirely — it solves an email-a-deck distribution problem sales account planning doesn't have.

## Course structure/presentation implications
- **Duplication mechanic (be honest about the real capability):** Claude.ai Projects don't have a first-class "duplicate to my workspace" button reps can self-serve reliably at scale. The safest mechanic: reps **create a new Project and add the 3 published App Skills + connectors** (Skills are installable/shareable org-wide; that's the reusable unit), pasting the `PROJECT-INSTRUCTIONS.md` from a shared doc. Treat "Project per account" as "new Project + install the kit," and **pre-verify the exact duplication path in-browser before SKO** — this is worth a live check, not an assumption.
- **Claude 101 baseline** teaches Projects + one connector + the "five prompts."
- **Tiered breakouts map to Format A** (rotation heats per sub-skill) for practice; the room-wide finale = **Format B** (fastest *valid* plan, with a minimum-section quality gate so speed doesn't reward shallowness); **Format C** = optional Enterprise advanced lunch.
- **30/60/90 reinforcement is non-optional** — a single post-event survey won't move adoption. Day-30 manager check ("built one real plan?"), day-60 refresher on the least-used prompt, day-90 re-run of the competition as "graduation."
- Bake **certification** into the finale (2026 SKO norm), not just fun.

## What I'd cut (explicitly)
- **PPTX conversion (Phase 5) — cut.** Heavy EBR-specific OOXML engineering; no distribution problem here.
- **LinkedIn live scraping — cut.** Explicitly out of scope; manual rep step.
- **Session save/load in the research skill — cut.** Unneeded, whole failure class removed.
- **The separate "Processor" project — cut.** Salesforce MCP replaces it.
- **The 4th checkpoint (HTML-before-PPTX gate) — cut/merge.** Only 3 gates; compress to 2 under competition time.
- **Zendesk-style typed-source logic — cut.** No sales analog worth the weight.
- **Google as a selectable search engine — cut** from the rep-facing surface (hard-code Bing).

## Riskiest assumption
That **fourth-playwright's single shared Railway browser survives a room of 30 reps hitting it live during the timed finale.** This is the one un-verified, demo-breaking unknown (the capability map flags it as untested), and unlike everything else it can't be fixed by prompt discipline — it needs an actual concurrent load test against the deployed instance *before* SKO. If it fails and can't be scaled, the entire competition segment must be restructured to staggered/sequential research, which changes the finale's format. Second-order risk: that reps can cleanly "duplicate" a Project at all — the mechanic is assumed, not verified in-browser.