## Scores table

| Criterion | A (pedagogy) | B (architecture) | C (adoption) |
|---|---|---|---|
| 1. Feasibility (Dave+CC before SKO) | 7 — full Kit + 2 skills + tight run-of-show; scoped by cutting PPTX | 6 — 3-skill chain + kit is the heaviest build | **9** — one project, one skill, five cards is the smallest surface |
| 2. Usability (median rep, unassisted, week after) | 7 — great hook, but "populate a real-account project" is heavy solo | 7 — compresses gates for weak operators; doc-first aids reuse | **9** — explicitly engineered for what a rep remembers without opening a doc |
| 3. Leverage (reuse EBR/fourth-playwright) | 8 — clones orchestrator, ports research skill | **9** — strongest port of EBR discipline (file/read-order, checkpoints, confidence) | 7 — reuses research asset, drops orchestrator (correctly, for beginners) |
| 4. Robustness (live failure modes) | 6 — names SF risk + fallback account, less granular | 7 — best on the technical/load risk + honest duplication | **9** — pre-baked results pack, failure table, tool-confusion firewall |
| 5. Energy (10-min competition) | **8** — "compete with the system you built today" narrative | 6 — mostly inherited Format B | 7 — fastest-valid sprint, but simpler artifact |
| **Total** | 36 | 35 | **41** |

C wins on the two criteria that decide whether this program survives contact with real reps (usability, robustness). But A owns the day's *narrative* and B owns the *architectural rigor*. The synthesis is C's spine with A's staging and B's engineering discipline.

## Merged blueprint — "One Account, Tiered: build it, keep it, compete with it"

The organizing principle is **A's one-real-account-all-day spine, split by C's tiers, built on B's honest architecture.** Every rep picks a real account at the door and carries it from 101 → breakout → competition. Beginners get a research brief; Enterprise gets a full plan. Same account, different depth.

### The package (artifact list)

- **Two-tier Claude Project template** (B duplication mechanic, C+A instruction split): "Account Research Starter" (beginner/SDR) and "Account Cockpit" (Enterprise/Emerging-adv). Reps *create a new Project + install the published skills + paste `PROJECT-INSTRUCTIONS.md` from a shared doc* — not a mythical one-click duplicate.
- **`PROJECT-INSTRUCTIONS.md`** (B, load-bearing): role, qualification-translation table, VERIFIED/REPORTED/INFERRED confidence tags, hard no-fabrication rule. Beginner version is the ~1-page front half (no translation table, no play-by-quarter).
- **Account-context fill-in** (B/C): 6 fields Enterprise, 7 fields beginner. The rep's only manual authoring step.
- **`account-research` skill** (C — the workhorse, ALL tiers): navigation-first, **Bing-only/never-Google/no-retry-on-empty**, curated hospitality source list, **LinkedIn explicitly OUT (manual step)**, per-rep page cap (~8/account).
- **`account-orchestrator` + `account-plan-writer` skills** (A/B — Enterprise + Emerging-adv ONLY): compressed to **3 gates**, doc-output not deck.
- **5-Prompt Wallet Card** (A physical constraint) — beginner cards C1–C5; Enterprise cards mapped to the 5 phase prompts.
- **The Tuesday Card / facilitator cheat sheet** (C) — tool-confusion firewall (Claude *does the work* / Encyclopedia *is reference* / Brain *is future*), degraded-mode table, "when a rep asks X say Y."
- **One finished example** (all three): anonymized hospitality account, full-worked, as the target reps copy tone/depth from.
- **Salesforce connector runbook** (all three): **admin pre-provisioned org-wide before SKO**, reps only click "authenticate." Off the beginner critical path.
- **Output = living Canvas/Markdown doc** (B's defense: an account plan is a working reference edited over weeks, and Canvas becomes the persistence layer the session-bound connector lacks). Optional 1-slide snapshot (KPI-Card-Grid) for the competition artifact only.

### Course structure (arc + Enterprise run-of-show)

**Arc:** Claude 101 plenary (all reps, real account loaded, run research prompt #1 live — A's "the tool did my job in front of me" hook) → tiered breakouts (Sarah/Megan/Fernando rooms; Enterprise = full plan, beginners+SDR = research brief) → 10-min competition (re-run your built system on a fresh surprise account) → optional Enterprise advanced lunch (Format C curveball iteration) → 30/60/90 reinforcement (day-30 manager check, day-60 least-used prompt, day-90 competition re-run as graduation).

**Enterprise breakout run-of-show (A, 60 min):**
- 0:00–0:05 — clone the Cockpit (new Project + install skills + paste instructions)
- 0:05–0:12 — authenticate Salesforce; success check *your account's opportunities appear*
- 0:12–0:20 — fill 6-field context template (only typing)
- 0:20–0:28 — Prompt #2 (SF pull → snapshot); **Checkpoint 1 compressed**
- 0:28–0:38 — Prompt #3 (fourth-playwright research); facilitator: "empty ≠ broken, it pivots to direct nav"
- 0:38–0:48 — Prompt #4 (synthesize → plan draft); **Checkpoint 2**
- 0:48–0:55 — Prompt #5 (qualification translation — the quality bar)
- 0:55–1:00 — save. "This Project is yours, it's on your phone tonight, it's what you compete with in 20 minutes."

Dave floats all rooms during the 0:20–0:48 failure-dense window.

### Build plan (ordered)

1. **Provision Salesforce org-wide + 5-rep OAuth dry-run** (IT + Dave) — *biggest external dependency, start now.* ~1 week lead, mostly waiting.
2. **Load-test fourth-playwright at 10–30 concurrent calls** against the live Railway instance (B/C — the one un-verified demo-breaker). ~0.5 day. Outcome gates the competition format (all-at-once vs staggered).
3. **Author `account-research` skill** on fourth-playwright (net-new; no sales skill exists) — Bing-only, curated sources, LinkedIn-out, page cap. ~1 day.
4. **Write both `PROJECT-INSTRUCTIONS.md` + context templates** (clone EBR structure, swap vocabulary, port translation table). ~1 day.
5. **Author Enterprise `account-orchestrator` + `account-plan-writer`** (clone EBR chain, compress to 3 gates, doc-output). ~1.5 days.
6. **Build one finished example plan** on a real anonymized account (also the fallback pack). ~0.5 day.
7. **Verify the duplication path in-browser** (B — don't assume it). ~1 hr.
8. **Facilitator cheat sheet + wallet cards + pre-baked results pack** for 3 demo + finale accounts. ~0.5 day.
9. **Freeze deploys + pre-test the exact finale accounts** 1–2 days prior. ~1 hr.

### Top 5 open decisions Dave must make

1. **Does the load test pass?** If the single shared browser stomps at 30 reps → competition goes **staggered by table**, not all-at-once. Decide the format *before* the room fills.
2. **Duplication mechanic** — confirm reps can self-serve "new Project + install skills" reliably, or pre-create Projects for them.
3. **Is Salesforce truly provisioned org-wide** in time, or does Enterprise fall back to hand-filled context templates?
4. **Competition artifact** — living doc judged in-Canvas, or the 1-slide snapshot? (Recommend snapshot for judgeability; doc is the durable win.)
5. **Emerging-advanced tier placement** — do they get the full orchestrator or the research skill + a lighter plan stub?

### Top 5 risks with mitigations

1. **Salesforce not provisioned / sparse-data-looks-like-failure** — the spine's single point of total failure. *Mitigate:* org-wide provisioning + 5-rep auth dry-run a week out; per-room pre-loaded fallback account (full data) so a broken-SF rep still builds and competes; facilitator line "sparse data = check your access, not Claude."
2. **30 reps hammer one Railway browser mid-competition** — highest-probability live failure. *Mitigate:* mandatory pre-SKO load test → stagger if it stomps; freeze deploys for the session; live-monitor Railway `/health`; message as "shared connector, expect an occasional retry."
3. **Reps overwhelmed / don't reuse after SKO** — *Mitigate:* 5-prompt hard cap (physical card), beginners get ONE skill zero orchestrator, 30/60/90 manager checks (a survey moves nothing).
4. **Tool confusion (Claude vs Encyclopedia vs Brain)** — *Mitigate:* the firewall on the cheat sheet, reps repeat it verbatim; Brain stays a 60-sec teaser, not content.
5. **$50/mo spend cap hit mid-competition** — *Mitigate:* facilitator flags near-cap reps *before* the finale; cert bar is "produced a valid brief," achievable pairing on a neighbor's screen.

**Cut from all versions:** PPTX/Phase 5 engine, LinkedIn live scraping, the separate "Processor" project, session save/load in research, Google as a selectable engine, any 6th prompt, orchestrator-for-beginners.