## Design: The Tuesday Card — one project, one skill, five prompts, zero orchestrator

## Core thesis (3 sentences)
An SDR or Emerging beginner will reuse exactly what they can remember without opening a doc — so the beginner path must be a single Claude Project they can clone per account, ONE research skill that fires on a trigger phrase, and five laminated prompt cards, with everything else deleted. A phase-machine orchestrator with Data Brief / Intelligence Brief / Plan-Outline checkpoints is the right shape for Enterprise account planning but is actively harmful for beginners: it front-loads ceremony onto people who haven't yet felt the "oh, this saved me 40 minutes" hit that drives adoption. The finish line is not "reps understand the architecture" — it's "on Tuesday, a rep pastes prompt card #1 into their account project and gets a decision-maker list they'd have spent an hour building by hand."

## The blueprint (concrete: artifacts, structure, sequence)
Beginner/SDR path, end to end:

1. **ONE shared Project template** — "Account Research Starter" — that every beginner **duplicates** per account (Claude Projects support duplicate). Contains: a lean `PROJECT-INSTRUCTIONS` (role + response standards + the confidence tags VERIFIED/REPORTED/INFERRED + a hard "flag gaps, never invent names/titles/numbers" rule), the fourth-playwright connector attached, and an account-context fill-in stub (7 fields, see #3).
2. **ONE installed skill** — `account-research` — the *only* App Skill beginners get. It encodes navigation-first strategy + the curated hospitality source list + the LinkedIn scope decision + a per-rep page cap. No orchestrator, no chained skills.
3. **FIVE prompt cards** (physical, laminated, on the table):
   - **C1 Company snapshot** — "Research [Account]: what they do, # locations, segment, recent news."
   - **C2 Decision-maker discovery** — "Find likely decision-makers for a Fourth deal at [Account]: ops, finance, IT/tech leadership. Titles + public sources only. Tag each VERIFIED/REPORTED/INFERRED."
   - **C3 Buying-signal scan** — "Scan [Account] for buying signals: expansion, funding, new-location, leadership change, ops/IT job postings."
   - **C4 Incumbent-vendor check** — "What workforce/ops tech does [Account] appear to use today? Public signals only."
   - **C5 Contact-ready brief** — "Give me a one-screen brief to open a cold call with [Account]: who to reach, the hook, one smart question."
4. **The Tuesday Card** (the single most important artifact): a one-page laminate — the tool firewall (below), the five prompt names, and "if it breaks, do this" three-line degraded fallback. If a rep keeps one thing, it's this.

Sequence at SKO: Claude 101 → beginners duplicate the project (2 min) → run C1 on a demo account together → run C2–C5 solo → finale = fastest valid C1–C5 brief on a fresh account.

## How #3 (Account Planning Kit) is built
Beginners do **not** get the full Kit. They get the **Account Research Starter** — the Kit's front half only. Concretely:
- **Project instructions**: ~1 page. Role ("SDR researching a hospitality prospect"), the confidence-tag rule, the no-fabrication rule, and one line pointing at the five cards. No metric-translation table, no qualification-signal language, no play-by-quarter — that's Enterprise depth beginners will never open.
- **Account-context template**: 7 fields max — Account name, website, segment, # locations (est.), why we're calling, known contacts, Salesforce link. Fill-in-the-blank, not a form.
- **Salesforce connector**: **optional for beginners**, and NOT on the critical path for day one. Account *research* is public-web; Salesforce is internal-facts. If provisioning slips (it needs a Salesforce admin + OAuth app *before* SKO — this cannot be a live-at-the-table step), beginners lose nothing — C1–C5 run entirely on fourth-playwright. Enterprise/advanced tiers get the live Salesforce pull.
- **Example plan**: one finished research brief (not a full account plan) so beginners see the target output shape.

The full orchestrator + Deck Plan + Play-by-Quarter Kit is an **Enterprise-tier deliverable**. Ship it there; keep it out of the beginner room.

## How #4 (installable Skills + connector) is built
**One skill for beginners, not three.** The EBR suite's orchestrator→research→output chain is the correct pattern for Enterprise; for SDRs it's three failure points where you need zero. Build `account-research/SKILL.md` on top of the existing `fourth-playwright` connector, hard-coding the lessons the connector research already surfaced:
- **Navigation-first, Bing-only, never Google/`web_search` retry** — bake the "if search returns empty (CAPTCHA), pivot to direct URL, do NOT retry" rule in as skill logic, not runtime discovery.
- **Curated hospitality source list** — newsroom/leadership pages, trade press, PR wires (port the EBR pattern; same vertical).
- **LinkedIn = human step, explicitly.** The skill states LinkedIn scraping is out of scope (datacenter IPs get walled; sessions die on redeploy). Reps do LinkedIn themselves.
- **Per-rep page cap** — "max ~8 pages per account per exercise." This is the client-side guard for the room-full-of-reps risk, since the connector has no server-side rate limiting shipped.
- **Unique session naming avoided entirely** — no `web_save_session`/login in the beginner flow; public web only removes a whole failure class.

## Course structure/presentation implications
- **≥30% hands-on** (validated externally). Beginner room = mostly reps running their own cards on a real account, facilitator floating. Cut lecture to the 101 baseline + one live C1 demo.
- **Tier the rooms, not the intro.** Enterprise gets the orchestrator/planning depth; beginners+SDRs get research only. Don't teach one script to a mixed-skill room.
- **Certification moment** — the finale isn't just fun; make "produced a valid C1–C5 brief" the cert bar (a facilitator quality-veto prevents speed-over-accuracy).
- **Finale format = Fastest-Finger sprint WITH a minimum-quality gate** (brief must contain all five sections, confidence tags present, no fabricated names). Speed-only teaches the wrong lesson.
- **30/60/90 reinforcement or it decays 87% in 30 days.** Day-30 manager check ("built one real research brief?"), day-60 refresher on the least-used card, day-90 re-run of the competition. A one-shot survey moves nothing.

## What I'd cut (explicitly)
- **The orchestrator skill for beginners.** Overkill. Three chained skills = three break points for someone on day one.
- **All human checkpoints in the beginner flow.** Data Brief / Intelligence Brief / Deck Plan gates are for high-stakes Enterprise plans a rep edits over weeks. For a 10-minute research brief they're friction that kills momentum.
- **The Salesforce connector from the beginner critical path.** Make it advanced-tier / optional. It's admin-provisioned, sharing-rule-gated, and if it's not ready it strands the room.
- **PPTX / presentation-suite output** for research briefs. A research brief is a working doc, not a deck. Skip the 160KB PPTX engine entirely here.
- **LinkedIn as an assumed capability.** Explicitly scope it to a manual human step.
- **Prompt cards 6+.** Five, hard cap. The "five prompts" philosophy is externally validated anti-overwhelm guidance, not just a preference.

## Failure modes during the live session + degraded-mode plan
| Failure | Signal | Degraded mode (say this out loud) |
|---|---|---|
| **Connector auth fails** | fourth-playwright tool errors / not listed | "Skip the connector — run C1 as a normal Claude question. You lose live scraping, keep the reasoning." Facilitator has a **pre-baked results pack** (research on the 3 demo accounts, generated the day before) to paste so no rep is stuck. |
| **Salesforce not provisioned** | empty/blank pull | Beginners: **ignore it, not on your path today.** Enterprise: "use the account-context template you filled by hand." Never a blocker for research. |
| **Rep hits $50/mo spend limit** | usage-cap message mid-exercise | Pair them with a neighbor's screen for the finale; the cert is "produced a valid brief," achievable observing. Facilitator flags to Dave to note reps near cap *before* the competition. |
| **CAPTCHA storm — 30 reps hammer one Railway browser** | slow/failed extracts, one rep's page yanked mid-call | **Highest-probability live failure.** Mitigations, in order: (1) **stagger** — beginners run cards sequentially by table, not all-at-once; (2) pre-test the exact finale accounts 1–2 days prior; (3) message it as "shared connector, expect an occasional retry," not "your own browser"; (4) Dave/facilitator watch Railway `/health` + logs live; (5) **freeze deploys** for the whole session (a redeploy wipes state mid-competition). Load-test 10–30 concurrent calls against the live instance BEFORE SKO — the "one shared browser" hypothesis is unconfirmed and is the single biggest event risk. |

## What the facilitator cheat sheet must contain
1. **The tool-confusion firewall** — one sentence each, reps repeat verbatim: **Claude** = "my thinking partner that researches and drafts." **Fourth Encyclopedia** = "my phone lookup for what Fourth does / product facts." **Fourth Brain** = "coming later — Claude plugged into our internal docs." (Claude *does the work*; Encyclopedia *is a reference*; Brain *is future*.)
2. **The five card names + one demo account** everyone runs together.
3. **Duplicate-the-project** step (the #1 thing reps fumble).
4. **The degraded-mode table above**, plus the pre-baked results pack location.
5. **Live-monitor duties** — who watches Railway, who holds spend-limit list, freeze-deploys reminder.
6. **The quality veto** — the 4-item finale gate (all five sections / confidence tags / no fabrication / real account).
7. **"When a rep asks X, say Y"** — 5 anticipated questions (LinkedIn? "do it yourself." Data looks sparse? "check your Salesforce access.") so three facilitators give one answer.

## Riskiest assumption
That the single shared Railway browser survives 30 concurrent reps — it's **unverified**, has no server-side rate limiting shipped, and one rep's `navigate` can yank the page from another's `extract` mid-competition. If load-testing (mandatory, pre-SKO) shows it stomps, the entire live-research finale must fall back to staggered turns or the pre-baked results pack — decide that *before* the room fills, not under time pressure.