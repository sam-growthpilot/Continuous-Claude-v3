## Design: "One Account, Live" — the working-system-first SKO

## Core thesis (3 sentences)
Every rep must leave SKO with their own real account already loaded into a working Claude Project they built with their own hands, not a folder of prompts they'll never open again — so the entire day is architected as a single escalating build on ONE real account the rep picks at the door. The 5-prompt constraint is enforced as a physical artifact (a wallet-card of exactly 5 prompts), and facilitators run scripts, not expertise — every breakout is a numbered checklist a non-AI-expert can read aloud and troubleshoot from a two-column "if they see X, say Y" sheet. The competition is not a separate event; it is the rep's own account plan, timed — which means the finale doubles as the certification that the working system actually works.

## The blueprint (concrete: artifacts, structure, sequence)
The spine is **one real account, carried through the whole day**, escalating in capability:

1. **Claude 101 (all reps, plenary, 45 min)** — not generic. The single exercise is "paste your account name, ask Claude the 5-prompt card's prompt #1 (account research), watch it work." Every rep ends 101 with one real research output. This is the hook: *the tool did my job in front of me.*
2. **Tiered breakouts (rooms by Sarah/Megan/Fernando)** — reps deepen the SAME account from raw research → a structured plan (Enterprise) or a research dossier + contact map (Emerging-beginner/SDR). The Account Planning Project Kit (#3) is *installed and populated live* here, not demoed.
3. **10-min competition** — reps re-run their now-built system on a FRESH surprise account. Speed is possible only because the system already exists. This is Format B (fastest valid plan) with a hard minimum-quality gate (facilitator veto if the plan is missing required sections) — per research §3, speed-only judging teaches the wrong lesson.
4. **Optional advanced lunch (Enterprise)** — Format C escalating-curveball: prompt-iteration under moving requirements (the Anthropic-Cowork "bring D4 down a bit" muscle).
5. **30/60/90 reinforcement** — the account they built at SKO becomes the day-30 manager check-in artifact ("show me the plan you've updated since").

The three durable artifacts the rep walks out with: (a) a **populated Claude Project** for their real account, (b) the **5-Prompt Wallet Card**, (c) a **one-page onboarding/troubleshooting sheet** (ported from the EBR onboarding-guide format, sales vocabulary).

## How #3 (Account Planning Kit) is built
Clone the EBR orchestrator's phase machine but **compress the checkpoints for the room** (Anti-Pattern #2: decide compression in advance). The Kit ships as a **pre-built Project template reps clone**, not something they assemble:
- **PROJECT-INSTRUCTIONS.md** — role, the qualification-signal-translation table (raw Salesforce field → "economic buyer not yet identified"), the confidence rubric (VERIFIED/REPORTED/INFERRED), and the fabrication ban (Anti-Pattern #5 — never invent stakeholders/budgets).
- **Account-context fill-in template** — the rep's *only* manual authoring step. 6 fields: account, segment, deal stage, close date, named stakeholders, "what I already know."
- **Salesforce connector recipe** — this MUST be **pre-provisioned org-wide by IT before SKO** (research §2: admin-side External Client App/OAuth, not a live table setup). Reps only click "authenticate." The recipe doc is a one-screen "you should see your account's opportunities appear" success check.
- **One finished example plan** — a real (anonymized) hospitality account, so reps see the target before building.

Output is a **living Markdown document, not slides** (Input 2 §3). The optional 1-slide "snapshot" reuses the presentation suite's KPI-Card-Grid layout for the competition's judgeable artifact only.

## How #4 (installable Skills + connector) is built
Port the EBR three-skill shape as **installable Claude App Skills**, but ship a **tier-scaled subset**:
- **`account-research` skill** (ALL tiers) — the workhorse. Layers a curated hospitality-prospect source list + navigation-first strategy on top of `fourth-playwright` (Input 1 §3, gap #7 — this must be *authored new*; no sales skill exists in the repo). Hard-codes Bing/direct-navigation only (never let the model pick Google → live CAPTCHA fail mid-demo, Input 1 §4). **LinkedIn is explicitly out of scope** (gap #3) — framed to reps as "a manual step you do yourself," not a promised capability.
- **`account-planning` orchestrator skill** (Enterprise + Emerging-advanced) — the phase-gate conductor.
- Emerging-beginner/SDR get **only** the research skill (matches their tier's job: research/contact/decision-maker discovery).

**Non-negotiable pre-SKO engineering (Input 1 §4):** the "one shared browser instance / no rate limiting" risk is real and will visibly break in a 30-rep room. Either ship the P0 audit+rate-limit middleware and scale Railway replicas, OR structure the competition so research runs **staggered by tier**, not all-30-at-once. Pre-test the exact competition accounts 1–2 days prior.

## Course structure/presentation implications
**Enterprise account-planning breakout — minute-by-minute (60 min):**
- **0:00–0:05** — Facilitator reads the room-script opener: "Open the Project I'm about to share. Clone it. You'll build a plan for the account you chose this morning." (Everyone already has a research output from 101.)
- **0:05–0:12** — Clone the Kit Project. Click "authenticate Salesforce." Success check on screen: *your account's opportunities appear.* (Facilitator's troubleshoot sheet: "sparse data? → check your SF access, not Claude" — research §2.)
- **0:12–0:20** — Fill the 6-field account-context template. This is the only typing. Facilitator floats.
- **0:20–0:28** — Run Prompt #2 (Salesforce pull → account snapshot). **Checkpoint 1 (Data Brief), compressed** — rep eyeballs, confirms, moves.
- **0:28–0:38** — Run Prompt #3 (fourth-playwright research → external signals). Facilitator warns: "if research returns empty, it's not broken — it pivots to direct navigation" (Anti-Pattern #3).
- **0:38–0:48** — Run Prompt #4 (synthesize → plan draft: Stakeholder Map / Pain Points / Value Hypothesis / Competitive / Close Plan). **Checkpoint 2 (Plan Outline approval).**
- **0:48–0:55** — Run Prompt #5 (qualification-signal translation — "what's this stage/gap mean for next steps"). This is the load-bearing quality bar (Anti-Pattern #4).
- **0:55–1:00** — Rep saves. Facilitator: "This Project is yours. It's on your phone tonight. This is the system you compete with in 20 minutes." **The working-system-not-notes moment.**

Dave floats across all three rooms during 0:20–0:48 (the failure-dense window). Certification stamp = a completed plan with all 5 sections present, checked at the finale.

## What I'd cut (explicitly)
- **PPTX conversion / Phase 5 entirely** (Input 2 §3) — heavy EBR-specific OOXML engineering; account plans are living docs, not emailed decks. No `fourth_pptx_core.py`.
- **The separate "Processor" project** — the Salesforce connector *is* the processing layer (Input 2 §2); don't make reps juggle two projects.
- **LinkedIn live scraping** from all skills (gap #3) — unreliable, will embarrass a facilitator mid-room.
- **Fourth Brain / MCP-connector teaching** — keep it a 60-second teaser slide, not content; reps can't absorb it and it dilutes the 5-prompt discipline.
- **Any 6th prompt.** The wallet card is exactly 5. Enforce it physically.
- **Open-ended "explore Claude" time** — every minute is on-the-rails toward the artifact.

## Riskiest assumption
That **Salesforce is pre-provisioned and every rep's OAuth authenticates cleanly in the room**. This is the single point of total failure: if IT hasn't stood up the External Client App org-wide, or reps' sharing rules return empty pulls (research §2 — no error, just sparse data that *looks like* Claude failed), the entire "build a real plan on your real account" spine collapses into a demo. Mitigation: verify provisioning + run a 5-rep auth dry-run a week before SKO; have a **pre-loaded fallback account** (anonymized, full data) ready per room so a rep with broken SF access still completes the build and competes.

---
Files referenced (read-only, none modified): none written. Design derived entirely from the three research inputs and Input 1 repo path `C:/Users/david.hayes/Projects/fourth-playwright-mcp`.