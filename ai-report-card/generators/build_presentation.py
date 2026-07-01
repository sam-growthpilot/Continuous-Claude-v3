"""Generate HTML presentation from Jinja2 template."""

import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from jinja2 import Environment, FileSystemLoader


def build_presentation(
    snapshot: dict,
    narratives: dict,
    manual_inputs: dict,
    config: dict,
    output_path: str,
) -> str:
    """Build the HTML presentation from the Jinja2 template."""
    template_dir = Path(__file__).parent.parent / "templates"
    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        autoescape=False,  # HTML template, we control the content
    )
    template = env.get_template("presentation.html.j2")

    git = snapshot.get("git", {})
    totals = git.get("totals", {})
    system = snapshot.get("system", {})
    memory = snapshot.get("memory", {})
    recipients = config.get("recipients", {})
    connectors = config.get("connectors", {})
    vocabulary = config.get("vocabulary", {})

    week_num = datetime.now().isocalendar()[1]
    report_date = datetime.now().strftime("%B %Y")
    full_date = datetime.now().strftime("%B %d, %Y")

    # Build template context
    context = {
        "report_date": report_date,
        "full_date": full_date,
        "week_num": week_num,
        "author": recipients.get("author", "David Hayes"),
        "author_email": recipients.get("author_email", "david.hayes@fourth.com"),
        "author_title": recipients.get("author_title", "AI Enablement Lead"),
        "recipient": recipients.get("primary", ""),
        # Metrics
        "metrics": {
            "active_projects": 5,
            "total_commits": totals.get("total_commits", 0),
            "week_commits": totals.get("week_commits", 0),
            "hooks": system.get("hooks", 0),
            "skills": system.get("skills", 0),
            "agents": system.get("agents", 0),
            "connectors_live": system.get("connectors_live", 0),
            "connectors_coming": system.get("connectors_coming", 0),
            "total_learnings": memory.get("total_learnings", 0),
            "teams_adopted": 3,
            "contributor_count": totals.get("contributor_count", 0),
            "files_changed": totals.get("files_changed", 0),
        },
        # AI narratives
        "narratives": narratives,
        # Per-project data
        "projects": {},
        # Connectors
        "connectors_live": connectors.get("live", []),
        "connectors_coming": connectors.get("coming", []),
        # Manual inputs
        "manual": manual_inputs,
        # Vocabulary mapping
        "vocabulary": vocabulary,
    }

    # Add per-project data
    for name, repo in git.get("repos", {}).items():
        if repo.get("exists"):
            context["projects"][name] = {
                "label": repo.get("label", name),
                "week_commits": repo.get("week_commits", 0),
                "total_commits": repo.get("total_commits", 0),
                "files_changed": repo.get("files_changed", 0),
                "contributors": repo.get("contributors", []),
            }

    # Render
    html = template.render(**context)

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(html)

    return str(output_file)


def _week_slug() -> dict:
    """Archive slug + hub-card fields for the current ISO week (matches the reports/<week>/ scheme)."""
    now = datetime.now()
    week = now.isocalendar()[1]
    year = now.year
    month_full = now.strftime("%B")
    month_abbr = now.strftime("%b")
    return {
        "slug": f"{year}-w{week}-{month_full.lower()}",
        "badge_week": f"W{week}",
        "badge_year": f"{month_abbr} {year}",
        "title": f"AI Enablement Status · Week {week} · {month_full} {year}",
        "latest_label": f"Week {week} · {month_full} {year}",
    }


def _update_hub(hub_path: Path, meta: dict, summary: str) -> None:
    """Insert/refresh this week's card in the archive hub index.html, demoting the previous latest.

    The ai-enablement-status repo was restructured from single-report to a multi-week archive
    (index.html = hub, reports/<week>/index.html = each report). Idempotent for same-week re-runs.
    """
    if not hub_path.exists():
        return
    html = hub_path.read_text(encoding="utf-8")
    slug = meta["slug"]
    # Idempotent: drop any existing card for this week before re-inserting.
    html = re.sub(
        r'\s*<a class="report-card[^"]*" href="reports/' + re.escape(slug) + r'/">.*?</a>',
        "", html, flags=re.DOTALL,
    )
    # Demote the current latest card to a regular card.
    html = html.replace('class="report-card latest"', 'class="report-card"', 1)
    summary = (summary or "").strip().replace("<", "&lt;").replace(">", "&gt;")
    if len(summary) > 180:
        summary = summary[:177].rstrip() + "..."
    arrow = ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
             'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
             '<line x1="5" y1="12" x2="19" y2="12"></line>'
             '<polyline points="12 5 19 12 12 19"></polyline></svg>')
    card = (
        f'\n        <a class="report-card latest" href="reports/{slug}/">\n'
        f'          <div class="report-date">\n'
        f'            <div class="week">{meta["badge_week"]}</div>\n'
        f'            <div class="year">{meta["badge_year"]}</div>\n'
        f'          </div>\n'
        f'          <div class="report-body">\n'
        f'            <h3>{meta["title"]}</h3>\n'
        f'            <p>{summary}</p>\n'
        f'          </div>\n'
        f'          <div class="report-cta">\n'
        f'            Open\n'
        f'            {arrow}\n'
        f'          </div>\n'
        f'        </a>\n'
    )
    html = html.replace('<div class="reports">', '<div class="reports">' + card, 1)
    # Refresh the header "Latest" pointer to the current week (was hardcoded/stale).
    latest = meta.get("latest_label", "")
    if latest:
        html = re.sub(r'(<strong>Latest</strong>)[^<]*', lambda m: m.group(1) + latest, html, count=1)
    # Collapse runs of blank lines to a single blank line — idempotent same-week
    # re-runs otherwise accumulate whitespace between cards each time.
    html = re.sub(r'\n[ \t]*\n[ \t]*\n+', '\n\n', html)
    hub_path.write_text(html, encoding="utf-8")


def build(snapshot: dict, narratives: dict, manual_inputs: dict, config: dict) -> str:
    """Main entry point for presentation generation."""
    output_dir = Path(__file__).parent.parent / "output" / "latest"
    output_path = output_dir / "presentation.html"

    result_path = build_presentation(
        snapshot, narratives, manual_inputs, config, str(output_path)
    )

    # Deploy into the multi-week archive: reports/<week>/index.html + a hub card
    # (the ai-enablement-status repo is now an archive; do NOT overwrite index.html).
    pres_repo = config.get("output", {}).get("presentation_repo")
    if pres_repo and Path(pres_repo).exists():
        meta = _week_slug()
        week_dir = Path(pres_repo) / "reports" / meta["slug"]
        week_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(result_path, str(week_dir / "index.html"))
        _update_hub(Path(pres_repo) / "index.html", meta, (narratives or {}).get("executive_summary", ""))

    return result_path


if __name__ == "__main__":
    import yaml

    config_path = Path(__file__).parent.parent / "config.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    snapshot = {"git": {"totals": {}, "repos": {}}, "system": {}, "memory": {}}
    narratives = {"executive_summary": "Test.", "this_week_highlights": ["Test item"]}
    manual = {}

    path = build(snapshot, narratives, manual, config)
    print(f"Presentation generated: {path}")
