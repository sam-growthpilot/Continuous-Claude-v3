# Research Findings: Claude for Sales SKO Design

## 1. Findings That Should Shape Course Design

**F1. The "30% practice rule" is the dominant 2026 SKO design discipline.** At least 30% of total agenda time should be active practice — role-play, live objection handling, hands-on tool building — not lecture/keynote. This directly validates a lab-heavy structure over a demo-heavy one. [Insivia — AI Sales Corporate Events Guide](https://www.insivia.com/ai-sales-corporate-events-the-definitive-guide-for-2026/)

**F2. AI-tool certification is now a mandatory 2026 SKO content category, not an optional add-on.** The SKOs producing measurable field-behavior change pair hands-on AI usage labs with manager-level coaching training AND rep-level certification on the specific AI tools reps are expected to use daily. This supports building an explicit "certification" moment into the finale competition rather than treating it as pure fun. [Shawn Kanungo — 2026 SKO Agenda](https://shawnkanungo.com/blog/what-to-put-on-your-sales-kickoff-agenda-in-2026-and-why-ai-has-to-be-part-of-it)

**F3. Adult learners retain via experience, not exposure.** Roughly 70% of learning retention research attributed to hands-on/experiential practice vs. ~10% to formal instruction (70-20-10 model), which argues strongly for minimizing lecture time in the tiered breakouts and maximizing "build your own account project live" time. [Whatfix — Adult Learning Theory](https://whatfix.com/blog/adult-learning-theory/); [Ellit Groups — Software Training + Adult Learning](https://ellitgroups.com/bridging-theory-and-practice-software-training-best-practices-grounded-in-adult-learning-theory/)

**F4. Tiered/adaptive learning paths by prior-experience level is the standard mitigation for mixed-skill-level rooms** — differentiate curriculum for "prior experience" vs. "new to the tool" cohorts rather than running one script for everyone. This directly validates the Enterprise/Emerging-advanced/Emerging-beginner+SDR tiering already planned. [Docebo — Adult Learning Theory](https://www.docebo.com/learning-network/blog/adult-learning-theory/)

**F5. A minimal, curated prompt set ("start with 5 high-impact prompts") is an explicitly recommended anti-overwhelm pattern in AI sales-rollout guidance**, not just an internal Fourth preference — it appears independently as guidance for teams facing prompt-overload during AI rollout. This is direct external validation of the "five prompts only" philosophy. [Sandler — 5 AI Prompts That Actually Work for B2B Sellers](https://go.sandler.com/stp/insights/blog/categories/prospecting-and-qualifying/the-5-ai-prompts-that-are-actually-moving-the-ne/)

**F6. Real enterprise AI-sales rollouts allocate ~30% of total project budget to training/change-management, not tooling** — treating rollout as a workflow-transformation program, with a pilot cohort (top sellers) getting dedicated attention before wider rollout. This is a useful budget/effort-ratio benchmark to cite when scoping SKO prep time vs. the "just hand out licenses" temptation. [MindStudio — Enterprise Sales AI Rollout Case Study](https://www.mindstudio.ai/blog/enterprise-sales-rollout)

**F7. The proven in-house precedent (EBR Builder) generalizes cleanly to sales because Anthropic's own flagship sales workflow is architecturally identical**: a Head-of-GTM at Anthropic runs live account work through Claude Cowork with (a) a defined per-account/per-territory scoring rubric, (b) plain-English (non-technical) prompt iteration ("bring D4 down a bit"), and (c) Salesforce + BigQuery + calendar data fused into one brief — the same "checkpoint → refine → output" shape as the EBR orchestrator chain. This is strong validation that Account Planning Kit's orchestrator→research→output pattern is the right shape, not a Fourth-specific invention. [Claude Blog — Anthropic Sales Leader / Claude Cowork 4,000-Account Book](https://claude.com/blog/how-an-anthropic-sales-leader-uses-claude-cowork-to-run-a-4-000-account-book)

**F8. Anthropic's own published sales use-case library is thin and does NOT include a dedicated "account planning" or "account research" tutorial** as of this search — the official `/resources/use-cases-category/sales` page lists only proposal decks, deal-prep CRM pulls, sales reports, and battlecards. [Claude.com — Sales Use Cases](https://claude.com/resources/use-cases-category/sales) This means the Account Planning Project Kit would be filling a real gap in Anthropic's own materials, not duplicating an existing asset — good positioning for the deliverable, but also means Dave can't lean on an official Anthropic template and should build from the EBR-Builder precedent instead. **[INFERRED note: WebFetch on the specific `claude-for-sales` tutorial page returned only generic "Write" category prompts, not sales-specific content — the page may render more content dynamically than WebFetch captured; verify directly in-browser before relying on the absence of account-planning material.]**

---

## 2. Salesforce Connector: What It Can and Cannot Do (Constrains the Account Planning Kit)

**Architecture (verified):** Salesforce ships this as **Hosted MCP Servers** (GA April 2026), connected to Claude as a custom connector via OAuth against a Salesforce External Client App. Every call executes as the *authenticated user* — profile, permission-set, and sharing-rule restrictions all apply exactly as they would in the Salesforce UI. If a rep can't see a record in Salesforce, Claude can't see it for them either. [Salesforce Developers Blog](https://developer.salesforce.com/blogs/2026/05/connect-claude-with-salesforce-hosted-mcp-servers) · [Salesforce Developers Docs — Configure Claude](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/claude.html)

**Named MCP servers exposed (verified):**
| Server | What it does |
|---|---|
| `sobject-all` | Full read/query access to Salesforce objects + metadata via SOQL |
| `sobject-reads` | Read-only record access (no write/delete) |
| `sobject-mutations` | Update existing records |
| `sobject-deletes` | Delete records |
| `invocable-actions` | Calls `@InvocableMethod`-annotated Apex — i.e., can trigger custom Salesforce business logic |
| `flows` | Triggers autolaunched Lightning Flows |
| `api-catalog` | Discovers available REST/Apex endpoints |
| `prompt-builder` | Calls parametrized Salesforce Flex prompt templates as agent commands |
| Plus Data 360, Heroku, MuleSoft, mobile-codegen servers (specialized, not core to a rep workflow) |

**What a rep CAN pull for account planning:** accounts, opportunities/pipeline, contacts, activity history, forecast/commit data — via natural language instead of hand-written SOQL — and can draft record updates back into Salesforce within the same conversation. [usecarly.com](https://www.usecarly.com/blog/claude-salesforce-integration/) · [Salesforce News](https://www.salesforce.com/news/stories/salesforce-anthropic-trusted-context-ai-actions-on-claude/)

**What it CANNOT do — the load-bearing constraint for the Kit's design:**
- **No triggers, no background automation.** It only works *inside a conversation the rep actively starts*. Nothing fires on a Salesforce event (new lead, stage change) while the rep is away. [usecarly.com](https://www.usecarly.com/blog/claude-salesforce-integration/)
- **Session-bound, no persistent memory.** Each conversation is effectively a fresh pull — the connector doesn't "watch" the account over time.
- **Requires admin-side setup**: a Salesforce admin must stand up the External Client App/OAuth config and enable the specific MCP server(s); this is not a rep self-service toggle. **Design implication:** the Account Planning Kit's "Salesforce connector recipe" must assume IT/Salesforce-admin involvement *before* SKO, not a live at-the-table setup step — recommend this be pre-provisioned org-wide ahead of the event.
- **Read access respects existing sharing rules** — a rep planning an account they don't have visibility into (e.g., another territory) will get an incomplete or empty pull, not an error explaining why. Worth a callout in the account-context template ("if data looks sparse, check your Salesforce access before assuming Claude failed").

**[INFERRED / needs live verification before SKO]:** The exact object-level default scope (e.g., whether Activities/Tasks and Opportunity Line Items are included by default in `sobject-reads` vs. requiring explicit permission-set grants) was not confirmed in these sources and should be verified directly against Fourth's actual Salesforce org configuration, since permission sets vary org-to-org.

---

## 3. Three Competition/Gamification Formats for a 10-Minute Account-Plan Contest

**Format A — "Speed Solving" rotation heats.** Small groups rotate through timed rounds (e.g., 10 min per round) each focused on one account-planning sub-skill (research, contact mapping, plan synthesis), with a live scoring rubric per round. [DJ Will Gill — Sales Kickoff Games](https://djwillgill.com/the-best-sales-kickoff-games-12-formats-that-energize-teams/)
- *Pros:* Matches the tiered-breakout structure naturally (each room can run its own heat); keeps energy high; judges (frontline leadership/CS) score against inspectable categories the same way real deal-review coaching does.
- *Cons:* Needs enough judges to score in real time across rooms simultaneously; harder to produce one single "best account plan" winner across facilitator rooms without a cross-room finale round.

**Format B — "Fastest Finger First" single-elimination sprint.** Reps race to complete a full account plan from a fresh account brief; the fastest *valid* (judge-checked) submission wins, prizes scaled by speed. [Social Point — SKO Gamification](https://www.socialpoint.io/cheat-sheet-national-sales-meeting-event-gamification/)
- *Pros:* Directly matches the stated finale format ("best account plan in 10 min / fastest account research"); simple to explain, high spectacle value for a room-wide finale; produces a clean leaderboard.
- *Cons:* Speed-only judging risks rewarding shallow plans over accurate ones — needs a minimum-quality gate (a facilitator/judge veto for plans missing required sections) or it teaches the wrong lesson about what "good" looks like.

**Format C — Team-based "Pitch Perfect"-style challenge with escalating difficulty.** Teams collaborate on an account plan, then must handle an escalating series of curveball objections/data gaps live, judged for adaptability rather than raw speed. [Social Point — National Sales Meeting Gamification](https://www.socialpoint.io/cheat-sheet-national-sales-meeting-event-gamification/)
- *Pros:* Best fit for the Enterprise tier (account-planning is inherently collaborative/strategic there); rewards judgment and prompt-iteration skill, not just speed — closer to how Bryant's real Anthropic workflow actually works (iterative rubric refinement, not one-shot).
- *Cons:* Runs long for a 10-minute slot; better suited as the optional advanced-lunch session than the room-wide finale.

**Recommendation (synthesis, not sourced):** Run Format B as the room-wide spectacle finale (matches the stated "10 min" framing and is easiest to broadcast/judge live), and reserve Format C for the optional advanced Enterprise lunch session where more time and higher-stakes judgment fit better. Format A is the strongest structural fit for the tiered breakout *practice* time itself, ahead of any finale.

---

## 4. Post-SKO Reinforcement Patterns That Actually Stick (30/60/90-Day)

**The core threat is fast, quantified decay:** without reinforcement, participants lose ~87% of training content within 30 days, and unreinforced sales-training ROI runs 5-7% vs. 22-45% with structured reinforcement. [Ascent Trainings — Post-Training Reinforcement](https://feeds.ascenttrainings.com/blog/post-training-reinforcement-program)

**The proven 30/60/90 structure (cited across multiple independent sources):**
- **Days 1-30 — Habit formation.** Foundation-building, goal-setting, early low-stakes practice on the new tool. Manager coaching check-in #1 at day 30.
- **Days 31-60 — Consistency.** Structured knowledge checks/assessments identify gaps; short refresher sessions (not full re-training) plug them. Manager coaching check-in #2 at day 60.
- **Days 61-90 — Mastery.** Shift from "learning" to "doing" — live roleplay, peer collaboration, real-account application. Manager coaching check-in #3 at day 90.

[Trellus — 30-60-90 Sales Rep Training Program](https://www.trellus.ai/post/how-to-train-sales-reps) · [Sales Enablement Collective — 90-Day Onboarding Framework](https://www.salesenablementcollective.com/90-day-sales-onboarding-plan-framework/)

**What makes it stick, specifically:** scheduled manager coaching reviews at each of the three checkpoints (not a single post-mortem), plus short weekly refreshers rather than long retraining blocks — reinforcement needs to run a **minimum of 60-90 days** to produce durable behavior change; anything stopping at 30 days "rarely produces lasting change." [Funnel Clarity — Sales Training Reinforcement](https://www.funnelclarity.com/sales-training/reinforcement)

**Design implication for the Fourth SKO:** a single post-event "did you use Claude?" survey will not move adoption. The reinforcement plan should mirror the 30/60/90 cadence — e.g., a day-30 manager check-in tied to "has your rep built at least one real account plan in their Project," a day-60 refresher micro-session on whichever of the five prompts is least-used, and a day-90 "graduation" moment (possibly reusing the competition format from §3 as a live re-check). **[INFERRED: exact Fourth manager-cadence mechanics — 1:1s, team standups, etc. — were not researched externally; this is a generic best-practice pattern to adapt to Fourth's actual manager rhythm, not a sourced Fourth-specific plan.]**

---

## Sources

- [Vantage Point — Anthropic MCP + Salesforce](https://vantagepoint.io/blog/sf/anthropic/mcp-salesforce-protocol-connects-claude-crm)
- [Salesforce Developers Blog — Connect Claude with Salesforce Hosted MCP Servers](https://developer.salesforce.com/blogs/2026/05/connect-claude-with-salesforce-hosted-mcp-servers)
- [Salesforce News — Salesforce and Anthropic Bring Trusted Business Context to Claude](https://www.salesforce.com/news/stories/salesforce-anthropic-trusted-context-ai-actions-on-claude/)
- [usecarly.com — Claude + Salesforce: What the Integration Can (and Can't) Do in 2026](https://www.usecarly.com/blog/claude-salesforce-integration/)
- [Salesforce Developers Docs — Configure Claude / Hosted MCP Servers](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/claude.html)
- [Claude.com — Claude for Sales tutorial](https://claude.com/resources/tutorials/claude-for-sales)
- [Claude.com — Sales Use Cases category](https://claude.com/resources/use-cases-category/sales)
- [Claude Blog — How an Anthropic Sales Leader Uses Claude Cowork to Run a 4,000-Account Book](https://claude.com/blog/how-an-anthropic-sales-leader-uses-claude-cowork-to-run-a-4-000-account-book)
- [Anthropic — Collaborate with Claude on Projects](https://www.anthropic.com/news/projects)
- [Claude Platform Docs — Skills for Enterprise](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/enterprise)
- [Claude Help Center — How to Create Custom Skills](https://support.claude.com/en/articles/12512198-how-to-create-custom-skills)
- [Claude Help Center — Use Skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude)
- [Insivia — AI Sales Corporate Events: The Definitive Guide for 2026](https://www.insivia.com/ai-sales-corporate-events-the-definitive-guide-for-2026/)
- [Shawn Kanungo — What to Put on Your 2026 SKO Agenda](https://shawnkanungo.com/blog/what-to-put-on-your-sales-kickoff-agenda-in-2026-and-why-ai-has-to-be-part-of-it)
- [Whatfix — Adult Learning Theory: 7 Principles of Andragogy](https://whatfix.com/blog/adult-learning-theory/)
- [Ellit Groups — Software Training Best Practices Grounded in Adult Learning Theory](https://ellitgroups.com/bridging-theory-and-practice-software-training-best-practices-grounded-in-adult-learning-theory/)
- [Docebo — Adult Learning Theory: Principles, Methods & Application](https://www.docebo.com/learning-network/blog/adult-learning-theory/)
- [DJ Will Gill — The Best Sales Kickoff Games: 12 Formats That Energize Teams](https://djwillgill.com/the-best-sales-kickoff-games-12-formats-that-energize-teams/)
- [Social Point — Cheat Sheet: National Sales Meeting Event Gamification](https://www.socialpoint.io/cheat-sheet-national-sales-meeting-event-gamification/)
- [Ascent Trainings — Post-Training Reinforcement: Why and How to Use It](https://feeds.ascenttrainings.com/blog/post-training-reinforcement-program)
- [Trellus — How to Train Sales Reps: A Complete 30-60-90 Day Program](https://www.trellus.ai/post/how-to-train-sales-reps)
- [Sales Enablement Collective — 90-Day Sales Onboarding Plan Framework](https://www.salesenablementcollective.com/90-day-sales-onboarding-plan-framework/)
- [Funnel Clarity — Sales Training Reinforcement](https://www.funnelclarity.com/sales-training/reinforcement)
- [MindStudio — How an Enterprise Rolled Out AI Agents to Sales Teams](https://www.mindstudio.ai/blog/enterprise-sales-rollout)
- [Sandler — 5 AI Prompts That Actually Work for B2B Sellers](https://go.sandler.com/stp/insights/blog/categories/prospecting-and-qualifying/the-5-ai-prompts-that-are-actually-moving-the-ne/)