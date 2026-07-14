# EBR Builder Deep-Dive: Orchestrator Phase Machine, Zip Manifest, and the Reusable "Fourth AI Builder Pattern"

## 1. The Orchestrator's Exact Phase Machine

`ebr-orchestrator-skill.md` is the master control skill — it never generates content itself; it assesses, sequences, and directs two subordinate skills (`playwright-competition` for research, `fourth-presentation-suite` for build).

### Phase sequence (as declared in the skill header)

```
Phase 0:   Assessment       — what did the CSM provide?
Phase 0.5: Data Intake      — process all provided data sources, produce Data Brief
Phase 1:   Research Brief   — via playwright-competition + fourth-playwright connector
Phase 1.5: Benchmarking     — optional, targeted research when gaps present
Phase 2:   Narrative Planning — deck plan using Data Brief + Research Brief
Phase 3:   Metric Translation — business outcome language for all metrics
Phase 4:   Build            — HTML via fourth-presentation-suite
Phase 5:   PPTX             — conversion after HTML approval
```

### Phase-by-phase mechanics

| Phase | What it does | Checkpoint / gate |
|---|---|---|
| **0 Assessment** | Checks for customer name/segment, location count, review period, data sources present, CSM notes, **renewal date** (renewal <6mo flags "strategic planning" framing). | If 1-3 minimum inputs missing → **stop, ask before proceeding**. |
| **0.5 Data Intake** | Detects and parses up to 5 source types by content-sniffing (JSON keys, filename heuristics, CSV headers with alias-mapping, e.g. `Ticket_id`/`Id`/`Ticket ID`). Each source has its own extraction rules (Zendesk has the most elaborate — inclusion/exclusion rules, sentinel-value handling, email-channel-deprecation-date logic). | **Checkpoint 1: Data Brief** — a structured summary template presented verbatim to the CSM, ending in "Anything to adjust before I run research?" Does not proceed until confirmed. |
| **1 Research Brief** | Hands off to `playwright-competition`, which uses the `fourth-playwright` MCP connector. Explicit tool-priority rule: direct URL navigation (`web_navigate_and_wait`) and article extraction (`web_extract_article`) are primary; `web_search` is last-resort only (documented CAPTCHA-blocking on Railway datacenter IPs) and **must not be retried** if it returns empty — pivot immediately to direct navigation. | **Checkpoint 2: Intelligence Brief** — playwright-competition prompts "anything to add, correct, or flag as sensitive?" Orchestrator will not proceed to Phase 2 until CSM confirms. |
| **1.5 Benchmarking (optional)** | Only offered if the JSON contains gap/outlier data. Runs playwright-competition in "Benchmarking Mode" — a narrower, gap-targeted pass vs. the full 4-step research sequence. | Offered, not gated — skip is a valid path. |
| **2 Narrative Planning** | Produces a **Deck Plan**: one-sentence narrative thread, a slide-by-slide table (# / Layout / Title / Key Content) with section-break dividers baked in, a proposed narrative arc, and an explicit appendix list. | **Checkpoint 3: Deck Plan** — "Await CSM confirmation or adjustment before proceeding to build." |
| **3 Metric Translation** | Per-source-type translation logic (JSON → outcome language using a translation standard from PROJECT-INSTRUCTIONS; Gong → quotes drive slide 2/8, not just metrics; SkyPrep → "capability adoption velocity"; Zendesk → "support partnership efficiency," zero-minute resolutions reframed as a *positive* signal, not a gap). Explicitly not optional — "a slide showing 78% adoption without business context is the old EBR format." | No standalone checkpoint — folds into the Deck Plan approval. |
| **4 Build (HTML)** | Issues a fully-scripted **Build Directive** to `fourth-presentation-suite` — a copy-paste block naming exact files to read in order, per-slide layout assignments from an 8-layout catalog, and two hard constraints repeated verbatim ("No slide should contain more than one key idea," "couldn't be explained to a CFO in 30 seconds"). | **Quality Gate** — an explicit 12-item checklist (customer-first opening, outcome language only, CSS/SVG viz not paragraphs, gaps-as-table, `data-fc-id` present, source-conditional checks for SkyPrep/Zendesk) run BEFORE presenting to CSM. Gate failure → revise and flag what changed. |
| **5 PPTX** | Only fires on an explicit approval signal set: `"approved"`, `"looks good"`, `"convert it"`, `"build the PPTX"`, `"go ahead"`. Orchestrator's stated job here is solely to **verify the approval signal is genuine** before invoking Phase 2 of the presentation suite. | **Checkpoint 4: HTML approval** — hard gate; "does not trigger PPTX conversion before the CSM has reviewed and approved the HTML" is listed under "What This Orchestrator Does Not Do." |

### Trigger phrases (from the onboarding guide, ties directly to the phase machine)

| Intent | Phrase |
|---|---|
| Start | "Build an EBR for [Customer]" / "QBR for [Customer]" |
| Run research | "Run research for [Customer]" (usually automatic post-intake) |
| Run benchmarking | "Yes, run benchmarking" |
| Approve deck plan | "Looks good, proceed" / "Approved" / "Build it" |
| Request HTML revision | "Change slide 3 to..." |
| Approve for PPTX | "Approved" / "Looks good" / "Convert it" / "Build the PPTX" / "Go ahead" |
| Skip a phase | "Skip research" / "Skip benchmarking" — orchestrator flags the tradeoff explicitly rather than silently complying |

### Routing pattern (the reusable shape)

The orchestrator is a **stateless conductor with 3 hard gates**: Data Brief → Deck Plan → HTML-before-PPTX. It never writes slide content and never runs the browser itself — those are delegated to named sibling skills via an explicit, scripted directive block (not a vague "go do research"). Each directive names exact files to read, in order, and exact output paths. This is the cloneable control-flow: **assess → checkpoint → research → checkpoint → plan → checkpoint → build → quality-gate → checkpoint → convert.**

---

## 2. Reusable "Fourth AI Builder Pattern" — Generic Template

```
[Claude.ai Project: "<Domain> Builder"]
 ├── PROJECT-INSTRUCTIONS.md      (role, response standards, translation table)
 ├── <domain>-orchestrator-skill  (phase machine + checkpoints — THIS is the reusable spine)
 ├── <domain>-research-skill      (delegates to an MCP connector; navigation-first strategy)
 ├── <domain>-output-skill        (the actual artifact generator; brand rules; quality gate)
 └── Onboarding-Guide.md          (trigger phrases, troubleshooting, quick-ref card)

[Separate Claude.ai Project: "<Domain> Processor"]   <-- see Anti-Pattern #1 below
 └── Pre-processes raw source data into a clean JSON package, kept OUT of the builder project
     specifically to avoid context-window pressure.
```

### Mapping to a Sales Account-Planning variant

| EBR element | Keep as-is | Change for Account Planning |
|---|---|---|
| Phase 0 Assessment | Same shape — minimum-inputs gate before proceeding | Inputs become: account name, segment/vertical, deal stage, renewal→**opportunity close date**, named stakeholders. Renewal-framing logic → "opportunity-stage framing" (e.g., "closing in 45 days — recommend the deck prioritize a mutual close plan, not general discovery"). |
| Phase 0.5 Data Intake (5 typed sources + alias-mapping + Data Brief checkpoint) | **Directly reusable pattern** — typed-source detection with per-source extraction rules is exactly the shape needed | **Source 1 (JSON data package) → Salesforce connector.** This is the single biggest structural swap. Instead of a *separate pre-processor project* dumping a JSON file, Anthropic's Salesforce MCP connector (`mcp__claude_ai_Salesforce__authenticate` / live query tools once loaded) pulls Account, Opportunity, Contact, and Activity objects **live, in-session** — no separate project needed for this source. Other sources (Gong transcripts — direct precedent, sales calls; manually typed notes) port over unchanged. Zendesk-style ticket logic isn't relevant to sales; could be replaced by **email/Slack thread ingestion** or dropped. |
| Phase 1 Research Brief (fourth-playwright, navigation-first, curated hospitality source list, CAPTCHA-fallback rule) | **Fully reusable, and *more* relevant here** — Fourth's sales prospects are hospitality companies, same vertical as the EBR customers | Reframe the 4 research questions from "recent business news / segment pressures / competitor activity / tech-workforce statements" (retrospective, customer-voice) to **prospect-forward**: recent expansion/funding/leadership news, segment pressures relevant to a *pitch* not a *review*, competitive/incumbent vendor signals, any public statements suggesting workforce/tech pain points to open with. |
| Phase 1.5 Benchmarking | Reusable as-is | Same — "would live competitive benchmarking help" is equally valid pre-call. |
| Phase 2 Narrative Planning (Deck Plan table, narrative-thread sentence, section breaks, appendix list) | **Directly reusable structure** | For account planning the "deck" is arguably NOT slides (see §3) — so this becomes a **Plan Outline** with sections instead of a slide table: Account Snapshot / Stakeholder Map / Pain Points & Triggers / Value Hypothesis / Competitive Position / Play-by-Quarter / Mutual Close Plan. Same narrative-thread-first discipline. |
| Phase 3 Metric Translation | Reusable concept (raw → outcome language) | Sales equivalent: raw Salesforce fields (stage, amount, close date, activity count) → **qualification/relationship-health language** ("3 stakeholders engaged, economic buyer not yet identified" rather than raw activity counts). |
| Phase 4 Build + Quality Gate | Reusable *mechanism* (scripted directive + explicit pre-delivery checklist) | Swap the checklist items for account-plan-specific ones (see §4 anti-patterns) — but the "run a checklist before showing the CSM/rep" pattern transfers wholesale. |
| Phase 5 approval-gated conversion | Reusable if a second-format output is produced (e.g., plan doc → 1-pager for leadership) | Optional for v1 — a Claude Project account plan may not need a PPTX/HTML conversion step at all. |
| Onboarding Guide (trigger phrases, troubleshooting table, quick-ref card) | **Reusable format wholesale** | Same document shape, sales vocabulary. |
| Separate "Processor" project (context-isolation) | **The core anti-pattern lesson — see §4** | For a Salesforce-connector-based version, this need is **reduced but not eliminated** — see below. |

**Key insight for the sales variant:** because Salesforce data arrives live via MCP connector rather than a pre-processed JSON dump, the EBR's two-project split (motivated purely by context pressure from a *third-party pre-processing step*) is less necessary architecturally — the connector *is* the processing layer, hosted outside the conversation. But the underlying principle (don't let one project's context window carry both heavy reference material — component libraries, brand rules, layout catalogs — AND live data wrangling) still argues for keeping the **research/output skill libraries** lean and possibly still splitting "account research" from "plan drafting" if a rep is doing both in one session with a lot of Salesforce data pulled in.

---

## 3. What's Reusable From the Presentation Suite for Account-Plan OUTPUT — and Do Account Plans Even Need Slides?

### Zip manifest (45 files, `fourth-presentation-suite.zip`)

```
SKILL.md                                          (22.7 KB — the master skill)
assets/backgrounds/*.png                          (13 background images — vignettes, gradients, glows)
assets/logos/*.png                                (4 Fourth logo variants: icon, mono, standard, white)
html-engine/themes/fourth-executive.html           (35.2 KB — v5 base theme, CSS vars source-of-truth)
html-engine/themes/midnight-executive.html         (27.3 KB — v6 Midnight palette theme)
html-engine/components/midnight-components.html    (71.0 KB — Alpine.js UI components: tabs, accordion, modal, tooltip, carousel, dropdown)
html-engine/components/README.md
html-engine/README.md
html-engine/STYLE_PRESETS.md                       (14.0 KB)
references/brand-essentials.md                     (12.5 KB)
references/fourth-html-template.md                  (34.0 KB — largest reference doc)
references/icon-catalog.md                          (Lucide SVG icon mapping, no emoji allowed)
references/interactive-components.md
references/layout-catalog.md                        (19.9 KB — the 8+ named layout blueprints)
references/layout-grid-specs.md                     (12.1 KB)
references/logo-data-uris.md                         (167.1 KB — base64 logo data, "read only when copying into <img>")
references/script-api-reference.md
scripts/fourth_ooxml.py                              (37.5 KB)
scripts/fourth_pptx_core.py                          (160.9 KB — largest script, the PPTX-generation engine)
scripts/fourth_pptx_data.py                          (45.5 KB)
scripts/generate_mock_deck.py                        (13.0 KB)
```

### Does an account plan need slides?

**No — not as the primary artifact.** The suite's own design philosophy (`SKILL.md §1`) is explicit that its visual grammar — 72-144pt numbers, one-idea-per-slide, "explainable to a CFO in 30 seconds," section-break dividers — is optimized for a **synchronous presentation moment** (an EBR meeting, a QBR readout). An account plan is a **working reference document a rep edits over weeks**, re-reads before every call, and updates as stakeholders and deal stage shift. Those are opposite design pressures: dense-reference vs. sparse-presentation.

**Recommended output format(s) for the Account Planning Project Kit:**

1. **Primary: a structured Markdown/doc artifact** (not HTML/PPTX) — living inside the Claude Project as the account's working document, organized by the outline in §2 (Snapshot / Stakeholders / Pain Points / Value Hypothesis / Competitive / Play-by-Quarter / Close Plan). This is what gets *edited iteratively*, is diffable, and is what the rep actually references before a call — closer to a PRD than a QBR deck.
2. **Secondary, optional, presentation-moment output**: a **1-2 slide "account plan snapshot"** reusing the presentation suite's Full-Slide KPI / KPI Card Grid / Comparison Table layouts — e.g., for the SKO finale competition ("best account plan in 10 minutes") where a visual, judgeable artifact matters more than depth. This is where the zip's HTML engine genuinely earns its keep: **KPI Card Grid** (stakeholder engagement score, deal stage, days-to-close), **Comparison/Gaps table** layout (repurposed from "value being left" → "incumbent vendor gaps"), and the **Scorecard** layout (repurposed as a "relationship health" scorecard) map cleanly.
3. **Not recommended for v1**: full PPTX conversion (`fourth_pptx_core.py`, 160KB) — that's a heavy, EBR-specific engineering investment (OOXML generation) that solves a distribution problem ("email a deck to an exec") sales account planning doesn't have in the same way. Skip Phase 5 entirely for the sales variant; keep Phase 4 optional/light.

**What's directly reusable regardless of format choice:**
- The **brand rules** (`brand-essentials.md`, logo files, color tokens) — any Fourth-branded artifact, doc or deck, should inherit these.
- The **icon-catalog.md** Lucide-SVG-not-emoji rule — good hygiene for any generated artifact.
- The **quality-gate pattern itself** (a checklist run before showing the human) — reusable as a doc-quality gate even without slides.
- The **Alpine.js component library** — only relevant if the output stays HTML (e.g., an interactive account-plan dashboard artifact, tabs for "by quarter" views).

---

## 4. Anti-Patterns to Avoid (from the EBR docs)

1. **Context-window pressure → don't cram data-processing AND presentation-generation into one project.** Confirmed directly in the onboarding guide (line 63): *"The EBR Builder's context window is already filled with presentation skills (component libraries, themes, PPTX scripts). Keeping data parsing in a separate project prevents context pressure and keeps each project focused."* → the EBR system runs data ingestion in a **separate Claude.ai project** ("Fourth EBR Processor") that hands off a clean JSON package. **For the sales variant**: the Salesforce MCP connector substitutes for the separate-project pre-processor for *that* source, but if the Account Planning project also bundles a heavy research-skill library (playwright/fourth-playwright equivalent) plus a heavy output-skill library (presentation suite level of reference docs), the same pressure returns — watch total reference-doc weight (the EBR output skill alone is ~230KB of reference markdown before code/assets) and split further if account research + plan drafting can't coexist.

2. **Never skip the human checkpoints, even under pressure to move fast.** The orchestrator explicitly refuses to silently comply with "skip research" or "PPTX without HTML review" — it **states the tradeoff and requires acceptance** rather than either blocking outright or complying silently. Anti-pattern to avoid: building an autonomous pipeline with no stated cost of skipping steps. For SKO's 10-minute competition format, this matters — decide *in advance* which checkpoints are compressed (e.g., merge Data Brief + Deck Plan into one review) vs. which stay hard gates, rather than discovering under time pressure that a rep silently skipped stakeholder-mapping to save time.

3. **Don't let `web_search`-style tools retry blindly against a known-bad path.** The research skill hard-codes "if `web_search` returns empty (CAPTCHA), do NOT retry — pivot to direct navigation" — a documented, previously-learned failure mode baked into skill logic rather than left to runtime discovery. For the sales variant's research skill, capture the equivalent known-bad-path lessons (e.g., which Salesforce fields are commonly blank/stale and shouldn't be over-trusted, which prospect research sources CAPTCHA the same way) explicitly rather than relying on the model to rediscover them each run.

4. **Metric translation (or here, qualification-signal translation) is declared "not optional."** The EBR skill states flatly: *"A slide showing '78% auto-scheduler adoption' without business context is the old EBR format."* Anti-pattern: shipping raw Salesforce field dumps (stage=Proposal, amount=$40k) as the "account plan" without translating to what it means for next steps (who's missing from the conversation, what risk the stage implies). This is the single most load-bearing quality bar in the whole system and should be ported as a first-class rule, not an afterthought.

5. **Ban on fabricating gaps when data is absent.** "Does not fabricate metric translations when data is absent — flags the gap" is listed under "What This Orchestrator Does Not Do." For account planning this maps directly to a known LLM failure mode: inventing plausible-sounding stakeholder names, budget figures, or competitive intel when Salesforce/research turns up nothing. Must flag explicitly, never infer confidently.

6. **Hard slide/section-count ceiling exists for a reason — resist scope creep.** The EBR enforces 8-12 main slides with everything else routed to appendix. An account-plan equivalent (e.g., a hard cap on Play-by-Quarter items, or "no more than 5 next-step actions") prevents the artifact from becoming an unreadable data dump — directly serves the "five prompts only" philosophy already baked into the SKO program design.

7. **Approval-signal ambiguity is explicitly enumerated, not left implicit.** The exact phrase list ("approved", "looks good", "convert it", "build the PPTX", "go ahead") for a genuine go-ahead is spelled out twice (skill + onboarding guide) rather than trusting the model to infer intent from vague enthusiasm. Any confirm-gated step in the sales variant (e.g., "send this plan to the account team," "log to Salesforce") should carry the same explicit phrase-list discipline — this is a good practice already present in Dave's own CLAUDE.md rules ecosystem (confirm-first patterns) and validates using it here too.

---

## Bottom Line for the Two Deliverables

- **#3 Account Planning Project Kit**: clone the orchestrator's phase machine (assessment → data intake w/ Data Brief checkpoint → research w/ Intelligence Brief checkpoint → plan outline w/ approval checkpoint → qualification-translation → optional light output), swap Source 1 from JSON-pre-processor to live Salesforce MCP pull, keep fourth-playwright research reusable near-verbatim (same hospitality vertical), and make the primary output a structured living document, not a deck.
- **#4 Installable Claude Skills**: the EBR suite is the direct template for "orchestrator skill + research skill + output skill" as three installable App Skills with one onboarding guide — port the file/read-order discipline (the Build Directive names exact files in exact order) since that's what makes multi-skill chaining reliable rather than improvised.