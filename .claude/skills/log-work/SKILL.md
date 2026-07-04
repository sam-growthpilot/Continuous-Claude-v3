---
name: log-work
description: Log a row to the AI Enablement Weekly Work Tracker (Notion) when work doesn't go through a formal Bridge writeback. Complements notion-bridge auto-mirror. Use when the user says "log work", "log this ship", "add to tracker", "tracker entry", "/log-work", or describes a design decision, meeting, research spike, or small fix worth recording for the weekly report.
---

# Log-Work Skill
## v1.0 | 2026-04-22 | AI Enablement Weekly Work Tracker — Direct Entry

This skill adds a row to the AI Enablement Weekly Work Tracker database in Notion for work that does not go through a formal Bridge writeback. Use it for design decisions, meetings, research spikes, experiments, and small ships. The `notion-bridge` skill handles formal writebacks and can auto-mirror entries into the same Tracker; this skill covers everything else.

---

## Hardcoded IDs — Never Deviate

| Resource | ID |
|----------|----|
| **Tracker database** | `3d7f2afd6c5046748408e4412a5552b2` |
| **Tracker data_source_id** (for creates) | `6e8d9b17-f8ef-4d56-9f13-00344650ac03` |
| **Default project row** (AI Enablement generic) | `34b76fd7-ac82-8104-82ca-df3e801695c0` |

---

## Workflow

1. **Parse input** — extract required fields (Title, Type, Impact) and optional fields (Date override, Commits, Writeback URL, body text). See Parameter Parsing section below.

2. **Dedup check** — if a Writeback URL was provided, query the Tracker for an existing row with that URL before creating. If found, report the existing row URL to the user and stop — do not create a duplicate.

3. **Auto-fill defaults:**
   - Date: today (UTC, YYYY-MM-DD format)
   - Source: `Code` when invoked autonomously by Claude Code; `Dave` when the user describes their own work in first person ("I decided", "I shipped", "I met with"); `Team` for team activity
   - Dashboard Section: `None` unless the user specifies
   - Project: default generic row (`34b76fd7-ac82-8104-82ca-df3e801695c0`)
   - Published in Report: `false` (never true on creation)

4. **Create the row** — call `notion-create-pages` with:
   - `parent.type = "data_source_id"` and `parent.database_id = "6e8d9b17-f8ef-4d56-9f13-00344650ac03"`
   - All properties mapped to schema (see API Notes section)

5. **Report to user** — return the new Tracker row URL and a one-line summary: Title | Type | Impact | Source | Dashboard Section, so the user can spot-check the values.

6. **Refresh the living card (FourthOS work only)** — if the logged work is on a FourthOS project that has a living status card, run `/project-card refresh "<project>"` so its Notion card stays current (or let the daily `CCv3-Project-Cards` sweep pick it up). Change the source data, not the card embed.

---

## Parameter Parsing

Extract fields from natural-language invocations:

```
"log work: fix the playwright MCP, type=Fix, impact=High"
  → Title="fix the playwright MCP", Type=Fix, Impact=High

"tracker entry: new /log-work skill shipped"
  → Title="new /log-work skill shipped", Type=Ship (inferred from "shipped"), Impact=Mid (default)

"log this decision: picked Railway over Fly.io for ECG deploy"
  → Title="picked Railway over Fly.io for ECG deploy", Type=Decision (inferred), Impact=Mid
```

If a required field (Title, Type, or Impact) is missing after inference, ask the user using the available select option values:

- **Type options:** `Ship`, `Fix`, `Feature`, `Integration`, `Deploy`, `Decision`, `Research`, `Design`, `Meeting`
- **Impact options:** `High`, `Mid`, `Low`

If the user's description is more than one sentence, put the full description in the page body (not just in the title).

---

## Inference Rules

**Title keywords to Type:**

| Keywords in title | Inferred Type |
|------------------|---------------|
| fix / bug / broken / patch | `Fix` |
| ship / shipped / released / launched | `Ship` |
| add / new / build / create / implement | `Feature` or `Ship` (use `Ship` if past tense) |
| decide / chose / picked / selected | `Decision` |
| research / explore / spike / investigate | `Research` |
| design / mockup / wireframe / prototype | `Design` |
| meeting / sync / standup / call / retro | `Meeting` |
| deploy / release / rollout | `Deploy` |
| integrate / wire / connect / plug in | `Integration` |

**Source detection:**

- First-person past tense ("I shipped", "I decided", "I met with") → `Dave`
- Team activity ("we shipped", "team shipped") → `Team`
- Everything else in a Claude Code session → `Code`

---

## API Notes

### Create call structure

```
notion-create-pages:
  parent:
    type: "data_source_id"
    database_id: "6e8d9b17-f8ef-4d56-9f13-00344650ac03"
  properties:
    Title (title):         plain text string, required
    Date (date):           "date:Date:start": "YYYY-MM-DD"
    Type (select):         "Fix" | "Ship" | "Feature" | "Integration" | "Deploy" | "Decision" | "Research" | "Design" | "Meeting"
    Impact (select):       "High" | "Mid" | "Low"
    Source (select):       "Code" | "Dave" | "Team"
    Dashboard Section (select): "Deep Dive" | "Integration" | "Metric" | "Adoption" | "Roadmap" | "Decision" | "Highlight" | "None"
    Project (relation):    JSON array string of page URLs: "[\"https://www.notion.so/<page-id>\"]"
    Commits (rich_text):   comma-separated SHA strings, optional
    Writeback URL (url):   URL string, optional
    Published in Report (checkbox): "__NO__"
```

### Key formatting rules

- **Select properties:** plain string matching the option name exactly (e.g., `"Fix"`, not `{name: "Fix"}`)
- **Relation properties:** JSON array string of full Notion page URLs, e.g., `"[\"https://www.notion.so/34b76fd7ac82810482cadf3e801695c0\"]"`
- **Checkbox false:** use `"__NO__"` (Notion MCP expansion for false)
- **Date:** `"date:Date:start": "YYYY-MM-DD"` expanded property key format
- **Do not set Published in Report to true** on creation — that is the weekly-report workflow's job

---

## Dedup Pattern

Before creating, if the user provided a Writeback URL:

1. Query the Tracker database filtered on `Writeback URL == <value>` using `notion-query-database` (or search the database).
2. If a matching row is found, return: "A Tracker row for this URL already exists: [row URL]. Skipping create to avoid duplicate."
3. If no match, proceed to step 4 of the Workflow.

Title-based dedup is optional — only check URL. The notion-bridge auto-mirror uses Writeback URL as the dedup key; matching on that is sufficient.

Reference: the server-side equivalent lives at `ai-reporting-mcp/collectors/tracker_collector.py` — `find_existing_by_writeback_url()`.

---

## Examples

### 1. Ship entry

```
User: "log work: shipped /log-work skill, type=Ship, impact=Mid, commits=abc1234"

Claude parses:
  Title = "shipped /log-work skill"
  Type  = Ship
  Impact = Mid
  Source = Code (autonomous Claude Code invocation)
  Commits = "abc1234"
  Date = today

Claude creates row, returns:
  "Logged: 'shipped /log-work skill' | Ship | Mid | Code | None
   Tracker row: https://www.notion.so/<new-row-id>"
```

### 2. Design decision entry (no commits, long body)

```
User: "log this decision: picked Railway over Fly.io for the ECG deploy.
       Railway has better log streaming and the team already has credits.
       Fly was cheaper but the DX wasn't worth the savings at this stage."

Claude infers:
  Title = "picked Railway over Fly.io for the ECG deploy"
  Type  = Decision (inferred from "picked")
  Impact = Mid (default — Claude asks if High is more appropriate)
  Source = Dave (first-person "we" or context; if ambiguous, ask)
  Body  = full multi-sentence description → written into page body

Claude creates row with body content, returns:
  "Logged: 'picked Railway over Fly.io for the ECG deploy' | Decision | Mid | Dave | None
   Tracker row: https://www.notion.so/<new-row-id>"
```

### 3. Duplicate detected

```
User: "log work: Ralph scale hardening shipped, writeback=https://notion.so/abc123"

Claude queries Tracker for rows with Writeback URL = "https://notion.so/abc123"
→ Finds existing row created by notion-bridge auto-mirror

Claude responds:
  "A Tracker row for this writeback already exists (created by Bridge auto-mirror):
   https://www.notion.so/<existing-row-id>
   Skipping create to avoid duplicate. Want me to update the existing row instead?"
```

---

## Non-Goals

This skill does NOT:

- Push entries to the weekly dashboard or report (that is the `/weekly-report` workflow)
- Write to Bridge HQ or update handoff queues (use `notion-bridge` for that)
- Mark rows as "Published in Report" (handled by `/weekly-report` Phase 5)
- Edit or delete existing Tracker rows (call the skill again and reference the row URL for manual edits in Notion)

---

*log-work v1.0 | 2026-04-22 | Tracker: 3d7f2afd6c5046748408e4412a5552b2*
