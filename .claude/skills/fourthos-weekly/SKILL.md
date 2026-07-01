---
name: fourthos-weekly
description: Generate the weekly FourthOS sponsor update package for Carly (VP) and Christian (CTO). Pulls live portfolio data from the FourthOS Notion cockpit, refreshes the Notion Update Package page, renders a progressive-disclosure HTML artifact set (Tier 1 briefing dashboard, Tier 2 teaching deep-dive), stages it UNLISTED to the ai-enablement-decks GitHub Pages site, and notifies Dave to review before promoting it live. Use when asked to generate, build, preview, or promote the FourthOS weekly sponsor update, or when the CCv3-FourthOS-Weekly scheduled task runs. Triggers on "fourthos weekly", "sponsor update", "Carly update", "Christian update", "weekly portfolio update".
---

# FourthOS Weekly Sponsor Update Pipeline

Operationalizes the existing Notion "Update Package Generator" intent into a scheduled,
multi-tier, **draft-and-notify** artifact pipeline for sponsors **Carly** (VP Enterprise
Transformation & Technology) and **Christian** (CTO, dotted line).

**Mental model:** Dave stays editor-in-chief. The pipeline auto-builds everything to an
*unlisted* preview each Friday morning and pings Dave; nothing reaches sponsors until Dave
promotes it. The "teach what we build/research" mandate is carried by the Tier 2 **Concept
Spotlight** module.

---

## The two commands

| Intent | What runs | Who triggers |
|---|---|---|
| **Generate** (default) | Read Notion → refresh Tier 3 package → render Tier 1+2 → stage to `fourthos/preview/` (unlisted) → notify Dave | `CCv3-FourthOS-Weekly` task (Fri 07:00) OR Dave interactively |
| **Promote** | `fourthos/preview/` → stable `fourthos/` + archive snapshot + add `decks.json` card → push | Dave, after reviewing the preview |

- **Generate** headless path (unattended, Friday 07:00): `scripts/fourthos-weekly/scheduled-fourthos-weekly.bat`
  pipes `scripts/fourthos-weekly/generate-prompt.md` into `claude -p`.
- **Promote**: `node scripts/fourthos-weekly/promote.mjs` (run from anywhere; it targets the decks repo).
  Options: `--date=YYYY-MM-DD`, `--dry-run`, `--no-push`.

### Interactive companion (this skill IS the pairing skill)

The scheduled task and this skill are two faces of the same pipeline. When invoked interactively
(`/fourthos-weekly`, "generate the fourthos update", "review the sponsor preview", "promote it"):
- **Generate now** — execute the `generate-prompt.md` steps directly using the session's Notion / git /
  Slack tools (cleaner than spawning a nested `claude -p`); stage to `fourthos/preview/` + `card.json`.
- **Review** — open/probe the preview URLs and spot-check brand + content before promotion.
- **Promote** — run `promote.mjs` to publish the dated card once Dave approves.
This is the human-in-the-loop path; the `.bat` is the same flow on a timer.

---

## Data sources (Notion — read via the claude.ai Notion MCP)

| Source | ID / URL |
|---|---|
| FourthOS Daily Cockpit (control plane) | `34076fd7-ac82-805d-ac89-dd26476e2c47` |
| Leadership Portfolio Dashboard (5 live DBs) | `e29dd1c4-e6a6-4e39-a454-73525a765e5e` |
| Update Package Generator — Saved Prompt (the Tier-3 spec) | `82c202b8-2b66-4953-a87d-0177eee58172` |
| Connector Ecosystem — Master Plan (flagship for Tier 2) | `38776fd7-ac82-81c7-a286-ce6ae478b6be` |

The Tier-3 **Update Package** is the structured source of truth (incl. a JSON data model in §9).
Tiers 1 and 2 are rendered **from that package** — never invent status/outputs not present in it.

> Headless reachability is proven: the `CCv3-Health-Check` task already writes Notion via
> `claude -p`. The same OAuth/MCP path is used here.

---

## Portfolio structure — TWO projects (as of 2026-06-30)

The connector work is tracked as **two distinct projects** in the FourthOS Projects DB
(`852a60e1`), each with its own dependency/task/development streams. The report must treat
them separately — this is what makes velocity / stall-watch meaningful (you need >1 project):

- **Salesforce Connector** (the *product*; this repo `salesforce-fastmcp`) — connector
  correctness/UX, security hardening, pilot onboarding + feedback, schema coverage.
  Currently **Green · live in ALPHA** (ACA rev 0000020).
- **Connector Ecosystem** (the *program*) — framework/template extraction, reporting
  distribution (gated SWA + ACA Job), Zendesk connector #2 green-light, composability,
  dev-portal surface. Currently **Yellow** (reporting blocked on IT/Danny for Entra groups).

The Tier-2 flagship deep-dive rotates between them; the Salesforce Connector is the natural
flagship while it is the live proof point. Fail-loud guard #2 (empty-DB = failure) now
expects **≥2 active projects**.

---

## Progressive-disclosure ladder (v1 = Tiers 1, 2, 3)

| Tier | Artifact | Built with |
|---|---|---|
| **0 — Pulse** (hero of Tier 1) | RAG status · flagship · biggest decision · biggest risk · next proof point · "what changed" | html-engine hero block |
| **1 — Briefing** | Interactive dashboard: Portfolio Live Look cards + Sponsor Action Required + Risk Radar + Outcomes/Evidence | `.claude/skills/fourth-presentation-suite/html-engine/` + brand tokens |
| **2 — Deep Dive** | Scrollytelling teaching site for the flagship + **Concept Spotlight** explainer + Excalidraw architecture SVG | `.claude/skills/frontend-slides/` + committed SVG |
| **3 — Archive** | Notion "FourthOS Update Package — YYYY-MM-DD" child page (structured, incl. JSON data model) | Notion MCP write, per saved prompt `82c202b8…` |

**Content bar (load-bearing):** Published Tiers 1–2 are **status-grade only** (RAG, current focus,
milestones, outcomes) — the same public bar as the existing `governed-ai-access` VP briefing.
Genuinely sensitive risk/decision detail lives ONLY in the Notion Tier-3 archive and is never
rendered into the published HTML. **GitHub Pages is public; the preview slug is unlisted, not private.**

---

## Site chrome & navigation (v2 — shared shell)

Every tier uses the shared shell `templates/shell.html` (+ `templates/README.md`): custom inline-SVG
FourthOS mark, a sticky **top bar** (breadcrumb `Sponsor Updates › <date> › <page>` + tier tabs
Hub·Briefing·Deep-Dive + a data-driven **week-switcher** that reads `decks.json`), and a shared footer.
- **Hub hero is headline-driven:** H1 = the week's biggest news (`headline`), not "Weekly Sponsor
  Update"; supporting `subheadline`; a **Recently shipped** chip row (`shipped[]`); **no RAG/health
  pill** (health lives on the Briefing's portfolio cards). Glance = sponsor-lens **Needs you / What
  moved / Watch**.
- **Links are root-absolute** (`/ai-enablement-decks/fourthos/<date>/…`) — bare relative links 404 on
  Pages without a trailing slash. Deep-link anchors: briefing `#sponsor-actions`/`#outcomes`/`#risk-radar`,
  deep-dive `#outputs`/`#concept`/`#architecture`/`#reporting`/`#feedback`.

## Honesty / 3-state badge system (v3 — MANDATORY)

Public site to a VP/CTO — **never overstate**. Tag every capability: **LIVE** (running now, teal) ·
**BUILT IN-REPO** (code-complete/proven, not yet hosted, sky) · **DESIGNED · NEXT** (designed, not
built, dashed). The Salesforce connector is **"live in ALPHA"** (released for alpha testing — NOT GA;
never "live in production"). Reporting hosted distribution + the feedback auto-alert are DESIGNED·NEXT;
the report engine + feedback capture/store/pull are BUILT IN-REPO. **No real person names** (HMAC
pseudonyms / counts only). The HTML is grep-audited for these rules before publish. Showcase patterns
(reusable, proven in `fourthos/2026-06-24/`): the interactive 3-view governed-report toggle and the
inheritance diagram ("build the mold once; every connector inherits the governance").

## Render constraints (reuse, do not rebuild)

- **Brand:** load `.claude/skills/fourth-brand-guidelines/` for copy/tone. Deep Blue `#0C4A7D`,
  Teal `#00B69F` (CTA/accent only), Poppins, `iQ` (lowercase i / uppercase Q), "Powered by iQ".
- **HTML engine:** `.claude/skills/fourth-presentation-suite/html-engine/themes/fourth-executive.html`
  (CSS-variable source of truth) + `components/midnight-components.html` (reusable blocks).
- **Deep-dive motion:** `.claude/skills/frontend-slides/` scrollytelling patterns.
- **Diagrams:** `.claude/skills/excalidraw-mcp/` — build ONCE interactively, export SVG to
  `fourthos/assets/`. The canvas server can't run headless, so the weekly task embeds the committed
  SVG and only regenerates when the architecture changes.
- Each tier is a **single self-contained HTML file** (zero external network requests), matching the
  rest of the decks repo.

---

## Publish target — `ai-enablement-decks` (read its CLAUDE.md before touching)

- Local: `C:\Users\david.hayes\Projects\ai-enablement-decks` · remote `Rev4nchist/ai-enablement-decks`
  (PUBLIC) · auto-deploys on push to `main` via `.github/workflows/pages.yml`.
- A deck = a `<slug>/index.html` folder **plus** an entry in `decks.json` (the hub renders from the
  manifest, not from static cards). **A folder without a manifest entry is live-but-unlisted** — that
  is exactly the draft/preview mechanism.
- **Dedicated hub section:** a `sponsor-updates` section sits FIRST on the hub (above all others),
  rendered newest-first with **one row visible** and the rest behind a "Show N earlier updates" toggle
  (the renderer measures `offsetTop` so "one row" stays true at any width). Section + collapse logic
  live in the repo's `index.html`; the section is declared in `decks.json` `sections[0]`.
- **Each week = its own dated card.** Promotion publishes `fourthos/<YYYY-MM-DD>/` and adds a
  `fourthos-<date>` card to `sponsor-updates` (only the newest is `featured`). Bookmark the hub
  (`https://rev4nchist.github.io/ai-enablement-decks/#sponsor-updates`); the top card is always newest.
- Layout:
  ```
  fourthos/
  ├── preview/                ← weekly staging (UNLISTED — never added to decks.json)
  │   ├── index.html          ← mini-hub (links briefing + deep-dive)
  │   ├── briefing.html       ← Tier 1 dashboard (Pulse hero + portfolio/actions/risk/outcomes)
  │   ├── deep-dive.html      ← Tier 2 teaching deep-dive (+ Concept Spotlight, inline SVG)
  │   └── card.json           ← hub-card metadata for promote.mjs (tag/title/description/meta/date)
  └── <YYYY-MM-DD>/           ← each promoted week's standalone report (the dated cards)
  ```

---

## Fail-loud guards (never publish empty/stale over good content)

1. If the Notion MCP is unreachable or returns an auth error → write `fourthos/preview/_ERROR.md`
   with the reason, notify Dave "generation FAILED", and **do not** overwrite the stable `fourthos/`.
2. If the FourthOS Projects DB reads empty/missing → treat as failure (same as above), not as a
   valid "nothing to report".
3. `promote.mjs` validates `decks.json` parses before committing — a broken manifest blanks the whole hub.
4. Single-session only; no subagents in the headless run. Time budget ~6 min; bail with a clear
   status line if any single MCP call exceeds 60s.

---

## Notify (the internal "ready for review" ping — NOT the sponsors)

On a successful generate, notify Dave via **both**:
- **Slack DM** to Dave (`slack_send_message`) with the preview URL + a ≤5-bullet change summary.
- **Notion comment** on the cockpit's "Sponsor Update Workspace" section with the same.

End the headless run with exactly one stdout line:
`fourthos-weekly: OK preview=<url> changed=<n>` — or `fourthos-weekly: FAILED reason=<short>` (exit 1)
— or `fourthos-weekly: SKIP reason=mcp-unavailable` (exit 0).

---

## Verification (after generate / promote)

- `gh run list --repo Rev4nchist/ai-enablement-decks --limit 3` → `success`.
- Preview URL loads, brand-correct, SVG visible; hub root does NOT show a FourthOS card (correct while unlisted).
- After promote: stable URL updated, `archive/<date>/` snapshot exists, hub card now visible, `decks.json` valid.

## v4 — planned report enhancements (agreed with Dave, 2026-06-30)

Direction for the next iteration of the Tier-1 Briefing — synthesized from a 4-lens design
panel (decision-first, narrative-translation, velocity-metrics, novel-visual), which converged
strongly. **Extends** this pipeline; not yet built. Honesty bar and 3-state badges still apply.

**One new infra dependency:** persist a **weekly cockpit snapshot** (Projects + Decisions &
Outputs JSON) into the Tier-3 archive each run, so week-over-week diff + aging are computable.
Everything else reads existing cockpit data.

1. **Velocity — "Ship Rate" + "Trajectory."** Per project: impact-weighted count of Decisions
   & Outputs rows (High=3 / Med=2 / Low=0) over trailing 4wk (Ship Rate), a colored trend vs the
   project's OWN prior-4wk baseline (▲/▬/▼ Trajectory), and a 6-week sparkline. Count SHIPPED
   OUTPUTS, never "Latest Update" edits (anti-vanity). Honesty catch: high motion + zero High/Med
   output → a "busy, not shipping" tell. Show raw counts + a trailing Health dot beside the bar.
2. **What Moved + Stall Watch.** Top-of-briefing **diff ribbon** = this week's snapshot vs last
   week's, ordered by attention: risk-degradations → wins/milestones → status changes → ships. Its
   mirror **Stall Watch** = days-since-movement per project (max of Latest-Update / output date /
   status·health·milestone change / task done), classified: **Waiting** (blocked on a *named*
   external dep → auto-promotes to the Ask Box), **Aging** (no blocker → needs a decision),
   **Parked** (by design → muted, never counted as failure). Empty state: "All active projects
   moved this week."
3. **The Ask Box (the spine).** Literal top of the artifact: "What I need from you this week" —
   0–3 decision cards, each = the ask + why + cost-of-not-deciding + a RECOMMENDED default + a
   forcing function ("if I don't hear by Fri, I proceed with X"). Honest empty state: "Nothing
   needed — FYI read." Every sensor (stalls, spinning tells, health drops) auto-promotes into it,
   so the report becomes a decision instrument, not a status broadcast.
4. **So-What Ladder (the narrative method — solves "too technical → why it matters").** Climb
   every technical item 4 rungs: **Raw** (version/test/bug — never shown) → **Capability** (plain
   verb) → **Value** (pick ONE axis: Trust/Usefulness/Risk-retired/Readiness) → **Sponsor
   sentence** (≤25 words, one evidence anchor, honesty badge). **Carly reads rung 4; CB reads rung
   3 + a soundness number** — same ladder, different stop, so this ONE engine powers both the
   dual-audience split and the translation. Honesty rubric (all must pass): evidence-trace (no
   D&O row → no claim), jargon-zero (banlist: ACA, SOQL, revision, OBO, serializer…),
   so-what test, no-overstatement (verbs "demonstrated" not "secure"; badge = LIVE/BUILT/NEXT),
   grandparent-readable. Worked example — "W1/W2/W3+F1, rev 0000020, 16/16 boundary test" →
   Carly: *"We pressure-tested the connector's security — 16 deliberate attempts to leak one
   user's data to another, all blocked — and fixed the empty/wrong answers, so it's safer and more
   useful ahead of widening the pilot."*
5. **CB confidence chip + Decision Latency.** One CTO-lens soundness signal (e.g. "isolation
   16/16 · 1055 tests green"). **Decision Latency** = days an Ask has waited ON the sponsor
   (symmetric — holds Carly/CB accountable, not just Dave). Other honest indicators to consider:
   blocked-days ledger, weeks-in-red, proof-point countdown, first-time-right/rework.

**Build order when green-lit:** snapshot persistence → add `whatMoved[] / stallWatch[] /
velocity[] / asks[] / cbConfidence` to the Update-Package §9 data model → Tier-1 render blocks →
So-What Ladder (banlist + rubric) as a `generate` build-step over Latest-Update + D&O rows.

---

## Related
- Scheduling pattern: `scripts/scheduled-health-check.bat` + `scripts/notion-health-prompt.md`.
- Task inventory: `.claude/docs/architecture/cheatsheet.md` (`CCv3-FourthOS-Weekly`).
- Plan of record: `~/.claude/plans/i-need-to-set-piped-minsky.md`.
