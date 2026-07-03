# AI Enablement Weekly Report Generator

Automated system that collects metrics and generates VP-level weekly status reports.

## What This Does

Every Friday at 6am CST (or on demand), this system:
1. Scans git repos for commit activity and contributor data
2. Counts hooks, agents, skills, and connectors from the file system
3. Queries the PostgreSQL memory system for recent learnings/decisions
4. Sends metrics to Claude API for narrative summaries
5. Generates a polished Word document report
6. Generates an HTML presentation (Midnight Executive v3.0 theme)
7. Deploys presentation to GitHub Pages
8. Archives everything with weekly snapshots

## Report Structure

**Word Report (report.docx):**
- Title page with Fourth branding (teal #3fb9a2, amber #f0883e, purple #a78bfa)
- Executive Summary with key metrics
- This Week's Highlights (AI-generated delta vs last week)
- Per-project status (Continuous Claude, Spark, Marketing Brain, AI Arch Guide, RFP Builder)
- Metrics Dashboard
- Roadmap & Next Steps
- Decisions Needed

**HTML Presentation (presentation.html):**
- 15 slides: Title, This Week's Highlights (NEW), Executive Summary, Portfolio, CC Deep-Dive, Spark, Marketing Brain, Asana Project, AI Arch Guide, Integrations, Impact, Metrics, Adoption, Roadmap, Decisions
- All metrics injected from weekly data collection
- Midnight Executive v3.0 theme with glass morphism, animated mesh orbs, scroll-snap

## Data Sources & VP Translation

Raw data is collected from technical sources but **always translated** for VP consumption:

| Source | Script | Raw Data | VP Framing |
|--------|--------|----------|------------|
| Git repos | `collectors/git_metrics.py` | Commits, contributors | Capabilities delivered, team velocity |
| File system | `collectors/system_counts.py` | Hooks, agents, skills | Automated safeguards, AI workflows, specialized assistants |
| PostgreSQL | `collectors/memory_insights.py` | Learnings, decisions | Organizational insights, institutional knowledge |

### Vocabulary Guide

| Internal Term | VP-Facing Term | Why |
|---------------|----------------|-----|
| Hooks | Automated safeguards | Quality checks that prevent errors |
| Skills | AI workflows | Reusable processes that save time |
| Agents | Specialized assistants | AI workers that handle specific tasks |
| Commits | Capabilities delivered | Incremental platform improvements |
| Connectors | Enterprise integrations | Connections to business tools |
| Learnings | Organizational insights | Institutional knowledge preserved |

## Running

```bash
# Full run (collect + generate + deploy)
python scripts/weekly_run.py

# Collect only (no generation)
python scripts/weekly_run.py --collect-only

# Generate only (uses latest snapshot)
python scripts/weekly_run.py --generate-only

# Skip deploy (no git push)
python scripts/weekly_run.py --no-deploy
```

## Manual Inputs

Before sending, optionally fill `templates/manual_inputs.yaml` with:
- Executive narrative overrides
- Decisions needed updates
- Project status overrides
- Roadmap changes

If empty/absent, AI-generated defaults are used.

## Style Guidelines

- **Audience:** Carly Hodges, VP Enterprise Transformation & Technology
- **Tone:** Professional, impressive, outcome-driven. Show business impact and momentum.
- **Brand:** Fourth colors (teal, amber, purple on dark backgrounds)
- **Quality bar:** Every metric should answer: "What business outcome does this enable?" If a slide requires David to explain a technical term, revise it.
- **Framing rule:** Lead with capabilities and outcomes, not activity counts. Raw numbers (commits, files) are supporting evidence only.

## Weekly Workflow

| Time | Action | Who |
|------|--------|-----|
| Friday 6:00 AM | Auto-collect + generate + deploy | Scheduled Task |
| Friday morning | Review output/latest/, fill manual_inputs if needed | David |
| Friday morning | Re-run or send as-is | David |

## Dependencies

- `python-docx` - Word document generation
- `anthropic` - Claude API for AI narratives
- `gitpython` - Git repo scanning
- `pyyaml` - Configuration
- `jinja2` - HTML template rendering
- `psycopg2` - PostgreSQL memory queries

## Environment Variables

- `ANTHROPIC_API_KEY` - Required for AI narrative generation (falls back to template text)
