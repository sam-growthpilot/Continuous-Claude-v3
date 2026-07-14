# Claude for Sales Package — Source Review

Reviewed 2026-07-12. Sources:
- Notion project page: **Sales Kickoff AI Training Program** (`fcf3b8cbb8a14a098f765f1a49a31cb3`)
- Notion meeting notes: **Sales Kickoff AI Training Planning**, 2026-06-05 (`37676fd7ac828064a650ef5eb39b76bb`)

## What the program is

Design and deliver a Claude 101 / AI enablement training program for the Sales team at Sales
Kickoff (SKO), pairing a practical training session with the Fourth Brain / Fourth Encyclopedia
ecosystem. Timeline on the project card: **2026-06-22 → 2026-07-15** (Claude basics course due
July 15). Status at review time: Planned, 11/11 tasks open.

## Core team & ownership

| Person | Owns |
|---|---|
| David Hayes | AI tooling + training design; SharePoint source files; Product Brain stability; advanced prompting support (floats during breakouts) |
| Sarah Kirkland | Sales training owner; license request (via Jay), survey, training foundation |
| Megan Klein | Fourth Encyclopedia — the immediate SKO deliverable |
| Fernando | Loading Sales Brain content (from SharePoint) |
| Josh Wright / Jay | License assignment support / approval path |

## Key decisions (from the project card)

- **Program frame:** Claude 101 baseline for *everyone* first — common vocabulary, tool setup, practical confidence — even for reps who think they already know it.
- **Launch timing:** Licenses land AT SKO, not before, so adoption is guided in the room.
- **License model:** Enterprise plan, **$50/month per-user spending limit** (raised from $10) so reps can do real work incl. uploads and PowerPoint workflows.
- **Fourth Brain** (future-state teaser): interactive AI across Sales/Product/Marketing via MCP connectors bridging Seismic, SharePoint, Confluence. Works with Claude, Copilot, ChatGPT. Connectors carry pre-loaded instructions (account planning, competitive research, market research) so vague prompts still work. Desktop + mobile.
- **Fourth Encyclopedia** (immediate SKO deliverable, Megan): static, simplified, mobile-friendly sales reference app — no prompting required. Modeled on the competitive-intel / National Restaurant Show apps.
- **Positioning:** Encyclopedia = now (mobile quick reference); Brain = future teaser; Claude desktop = sit-down detailed planning work. Avoid tool-overlap confusion.
- **Breakouts by role + AI maturity:**
  - Enterprise → account planning (highest-value, longest workflow), advanced prompting with David's support
  - Emerging (advanced) → elevated AI assignment
  - Emerging (beginners) + SDRs → account research, contact discovery, LinkedIn / decision-maker research
  - Sarah, Megan, Fernando each lead a group; David floats.
- **Five-prompt approach:** give Sales exactly 5 high-value prompts for common workflows — do not overwhelm.
- **Account planning workflow:** a **Claude Project per account** — reps fill in account context, use project instructions, and build the plan with the **Salesforce connector**.
- **Hands-on finale:** competition — best account plan in 10 minutes / fastest account research.
- **Advanced track:** optional lunch session ("level 3 skills") for proficient users; Cowork taught after basics (better for Salesforce integration + automated plan creation).

## Training-outline items (source doc notes)

- Pre-SKO Slack learning channel
- Claude downloaded before/during setup; connect to CoWork before SKO
- Licenses assigned the week before (Josh Wright supports)
- Claude basics course assigned, due July 15
- Connectors put in place on-site; walk the room to verify Excel/PowerPoint/etc. connections
- **Create a skills prompt for Sales to install/use in Claude on-site**
- Claude Projects for repeated account-planning workflows

## Blockers & risks (from the card)

- 🔴 License approval + provisioning (training depends on access at SKO)
- 🟡 Content readiness — Sales Brain needs Fernando's doc load + David's SharePoint raw-file folder (PDF/markdown preferred)
- 🟡 Product Brain container disconnects daily — needs scaling
- 🟡 Tool-confusion risk — Claude desktop vs. Encyclopedia mobile must be clearly separated
- 🟡 Content fragmentation — SharePoint search weak, Seismic blocks outside AI, Confluence has the best connector

## Open inputs still pending

- Sales team survey (current Claude usage + desired AI help) — results shape the taught use cases
- Breakout room plans review (team reconvene)
