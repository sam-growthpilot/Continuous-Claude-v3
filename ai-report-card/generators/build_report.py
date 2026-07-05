"""Generate Word document report using python-docx."""

import json
import shutil
from datetime import datetime
from pathlib import Path

from docx import Document
from docx.shared import Inches, Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn


# Fourth brand colors
TEAL = RGBColor(0x3F, 0xB9, 0xA2)
AMBER = RGBColor(0xF0, 0x88, 0x3E)
PURPLE = RGBColor(0xA7, 0x8B, 0xFA)
DARK_BG = RGBColor(0x1A, 0x23, 0x32)
TEXT_PRIMARY = RGBColor(0x2D, 0x37, 0x48)
TEXT_SECONDARY = RGBColor(0x4A, 0x55, 0x68)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)


def set_cell_shading(cell, color_hex: str):
    """Set background color of a table cell."""
    shading = cell._element.get_or_add_tcPr()
    shading_elm = shading.makeelement(qn("w:shd"), {
        qn("w:val"): "clear",
        qn("w:color"): "auto",
        qn("w:fill"): color_hex,
    })
    shading.append(shading_elm)


def add_styled_heading(doc, text: str, level: int = 1, color: RGBColor = TEAL):
    """Add a heading with brand color."""
    heading = doc.add_heading(text, level=level)
    for run in heading.runs:
        run.font.color.rgb = color
    return heading


def add_metric_row(table, label: str, value: str, delta: str = ""):
    """Add a row to a metrics table."""
    row = table.add_row()
    row.cells[0].text = label
    row.cells[1].text = str(value)
    if len(row.cells) > 2:
        row.cells[2].text = delta

    for cell in row.cells:
        for paragraph in cell.paragraphs:
            paragraph.style.font.size = Pt(10)


def build_report(
    snapshot: dict,
    narratives: dict,
    manual_inputs: dict,
    config: dict,
    output_path: str,
    degraded_banner: str | None = None,
) -> str:
    """Build the weekly Word document report."""
    doc = Document()

    # Configure default styles
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10)
    style.font.color.rgb = TEXT_PRIMARY

    # mit #6: visible degraded banner at the very top of the report artifact, so a template
    # (non-AI) report is obvious to the VP — not just a line in the run log.
    if degraded_banner:
        banner_p = doc.add_paragraph()
        banner_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = banner_p.add_run(degraded_banner)
        run.font.bold = True
        run.font.size = Pt(12)
        run.font.color.rgb = RGBColor(0xF8, 0x71, 0x71)

    recipients = config.get("recipients", {})
    author = recipients.get("author", "David Hayes")
    author_title = recipients.get("author_title", "AI Enablement Lead")
    primary = recipients.get("primary", "")

    git = snapshot.get("git", {})
    totals = git.get("totals", {})
    system = snapshot.get("system", {})
    memory = snapshot.get("memory", {})

    week_num = datetime.now().isocalendar()[1]
    report_date = datetime.now().strftime("%B %d, %Y")

    # ─── TITLE PAGE ───
    doc.add_paragraph("")  # spacer
    doc.add_paragraph("")
    doc.add_paragraph("")

    title = doc.add_heading("AI Enablement", level=0)
    for run in title.runs:
        run.font.color.rgb = TEAL
        run.font.size = Pt(36)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    subtitle = doc.add_heading("Weekly Status Report", level=1)
    for run in subtitle.runs:
        run.font.color.rgb = TEXT_SECONDARY
        run.font.size = Pt(20)
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER

    meta = doc.add_paragraph()
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = meta.add_run(f"Week {week_num} - {report_date}")
    run.font.size = Pt(12)
    run.font.color.rgb = TEXT_SECONDARY

    meta2 = doc.add_paragraph()
    meta2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = meta2.add_run(f"{author} | {author_title}")
    run.font.size = Pt(11)
    run.font.color.rgb = TEXT_SECONDARY

    if primary:
        meta3 = doc.add_paragraph()
        meta3.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = meta3.add_run(f"Prepared for {primary}")
        run.font.size = Pt(10)
        run.font.color.rgb = TEXT_SECONDARY
        run.font.italic = True

    doc.add_page_break()

    # ─── EXECUTIVE SUMMARY ───
    add_styled_heading(doc, "Executive Summary", level=1, color=TEAL)

    exec_note = manual_inputs.get("executive_note") or narratives.get("executive_summary", "")
    if exec_note:
        p = doc.add_paragraph(exec_note)
        p.style.font.size = Pt(11)

    # Key metrics bar
    table = doc.add_table(rows=1, cols=5)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    headers = ["Projects", "Capabilities", "AI Workflows", "Assistants", "Integrations"]
    values = [
        "5",
        f"{totals.get('total_commits', 0)}+",
        f"{system.get('skills', 0)}+",
        f"{system.get('agents', 0)}+",
        f"{system.get('connectors_live', 0)}",
    ]

    for i, (header, value) in enumerate(zip(headers, values)):
        cell = table.rows[0].cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER

        run_val = p.add_run(f"{value}\n")
        run_val.font.size = Pt(16)
        run_val.font.bold = True
        run_val.font.color.rgb = TEAL

        run_label = p.add_run(header)
        run_label.font.size = Pt(8)
        run_label.font.color.rgb = TEXT_SECONDARY

    doc.add_paragraph("")  # spacer

    # ─── THIS WEEK'S HIGHLIGHTS ───
    add_styled_heading(doc, "This Week's Highlights", level=1, color=AMBER)

    highlights = narratives.get("this_week_highlights", [])
    if highlights:
        for item in highlights:
            p = doc.add_paragraph(style="List Bullet")
            p.text = item
    else:
        doc.add_paragraph(
            f"{totals.get('week_commits', 0)} commits across all repositories this week.",
            style="List Bullet"
        )

    doc.add_paragraph("")

    # ─── PROJECT STATUS ───
    add_styled_heading(doc, "Project Status", level=1, color=PURPLE)

    project_deltas = narratives.get("per_project", {})
    status_overrides = manual_inputs.get("project_status_overrides", {})

    projects_info = [
        ("Continuous Claude", "continuous-claude", "Production",
         "Core AI development infrastructure. Semantic memory, autonomous orchestrators, cross-session coordination."),
        ("Spark Platform", "spark-platform", "In Progress",
         "Cross-departmental AI hub connecting resources, intelligence, and departments."),
        ("Fourth Marketing Brain", "fourth-marketing-brain", "Complete",
         "MCP server connecting Claude, ChatGPT, Copilot to SharePoint marketing content."),
        ("AI Architectural Guide", "ai-arch-guide", "Mostly Complete",
         "Meeting intelligence, proposals, budget tracking, Agent Factory."),
        ("RFP Builder", "rfp-builder", "Awaiting Data",
         "95% time reduction (40 hrs to ~2 hrs). Feature-complete, waiting on team data."),
    ]

    for label, key, status, description in projects_info:
        add_styled_heading(doc, label, level=2, color=TEAL)

        # Status badge
        status_p = doc.add_paragraph()
        run = status_p.add_run(f"Status: {status}")
        run.font.bold = True
        run.font.size = Pt(10)
        if status == "Production":
            run.font.color.rgb = RGBColor(0x34, 0xD3, 0x99)
        elif status == "In Progress":
            run.font.color.rgb = AMBER
        elif status == "Complete":
            run.font.color.rgb = RGBColor(0x34, 0xD3, 0x99)
        else:
            run.font.color.rgb = TEXT_SECONDARY

        # Description
        override = status_overrides.get(key)
        doc.add_paragraph(override or description)

        # Delta from AI
        delta = project_deltas.get(key, {})
        delta_text = delta if isinstance(delta, str) else delta.get("delta", "")
        if delta_text:
            p = doc.add_paragraph()
            run = p.add_run("This week: ")
            run.font.bold = True
            run.font.color.rgb = AMBER
            p.add_run(delta_text)

        # Repo metrics if available
        repo = git.get("repos", {}).get(key, {})
        if repo.get("exists") and repo.get("week_commits", 0) > 0:
            p = doc.add_paragraph()
            run = p.add_run(
                f"  {repo['week_commits']} commits | "
                f"{repo.get('files_changed', 0)} files changed | "
                f"{repo['total_commits']} total commits"
            )
            run.font.size = Pt(9)
            run.font.color.rgb = TEXT_SECONDARY

    doc.add_paragraph("")

    # ─── METRICS DASHBOARD ───
    add_styled_heading(doc, "Metrics Dashboard", level=1, color=TEAL)

    table = doc.add_table(rows=1, cols=3)
    table.style = "Light Shading Accent 1"
    table.rows[0].cells[0].text = "Metric"
    table.rows[0].cells[1].text = "Value"
    table.rows[0].cells[2].text = "This Week"

    metrics = [
        ("Capabilities Delivered", str(totals.get("total_commits", 0)), f"+{totals.get('week_commits', 0)} this week"),
        ("Automated Safeguards", f"{system.get('hooks', 0)}+", ""),
        ("AI Workflows", f"{system.get('skills', 0)}+", ""),
        ("Specialized Assistants", f"{system.get('agents', 0)}+", ""),
        ("Enterprise Integrations", str(system.get("connectors_live", 0)), ""),
        ("Organizational Insights", str(memory.get("total_learnings", 0)), f"+{memory.get('recent_count', 0)} this week"),
        ("Teams Adopted", "3", "Eng, Arch, Marketing"),
        ("Active Contributors", str(totals.get("contributor_count", 0)), ""),
    ]

    for label, value, delta in metrics:
        add_metric_row(table, label, value, delta)

    doc.add_paragraph("")

    # ─── ROADMAP & NEXT STEPS ───
    add_styled_heading(doc, "Roadmap & Next Steps", level=1, color=PURPLE)

    roadmap_updates = manual_inputs.get("roadmap_updates", [])
    if roadmap_updates:
        for item in roadmap_updates:
            doc.add_paragraph(item, style="List Bullet")
    else:
        outlook = narratives.get("outlook", "")
        if outlook:
            doc.add_paragraph(outlook)

        default_roadmap = [
            "Salesforce Connector - AI-powered CRM with natural language queries",
            "PowerBI Connector - Automated insight generation from dashboards",
            "Spark Platform Launch - Department leads drive custom connectors",
            "Team Training Programme - Structured onboarding for skill creation",
        ]
        for item in default_roadmap:
            doc.add_paragraph(item, style="List Bullet")

    doc.add_paragraph("")

    # ─── DECISIONS NEEDED ───
    decisions = manual_inputs.get("decisions_needed", [])
    if decisions:
        add_styled_heading(doc, "Decisions Needed", level=1, color=RGBColor(0xF8, 0x71, 0x71))

        for decision in decisions:
            if isinstance(decision, dict):
                title = decision.get("title", "")
                priority = decision.get("priority", "")
                detail = decision.get("detail", "")

                p = doc.add_paragraph()
                run = p.add_run(f"{title}")
                run.font.bold = True
                run.font.size = Pt(11)

                if priority:
                    run2 = p.add_run(f"  [{priority.upper()}]")
                    run2.font.size = Pt(9)
                    run2.font.color.rgb = AMBER if priority == "high" else TEXT_SECONDARY

                if detail:
                    doc.add_paragraph(detail)
            else:
                doc.add_paragraph(str(decision), style="List Bullet")

    # ─── FOOTER ───
    doc.add_paragraph("")
    footer = doc.add_paragraph()
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer.add_run(f"{author} | {author_title} | Fourth")
    run.font.size = Pt(9)
    run.font.color.rgb = TEXT_SECONDARY
    run = footer.add_run(f"\nConfidential - {report_date}")
    run.font.size = Pt(8)
    run.font.color.rgb = TEXT_SECONDARY
    run.font.italic = True

    # Save
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(output_file))

    return str(output_file)


def build(snapshot: dict, narratives: dict, manual_inputs: dict, config: dict, degraded_banner: str | None = None) -> str:
    """Main entry point for report generation."""
    output_dir = Path(__file__).parent.parent / "output" / "latest"
    output_path = output_dir / "report.docx"

    result_path = build_report(
        snapshot, narratives, manual_inputs, config, str(output_path), degraded_banner=degraded_banner
    )

    # Copy to Documents
    report_dest = config.get("output", {}).get("report_dest")
    if report_dest:
        dest = Path(report_dest)
        if dest.exists():
            week_num = datetime.now().isocalendar()[1]
            dest_file = dest / f"AI-Enablement-Week{week_num}.docx"
            shutil.copy2(result_path, str(dest_file))

    return result_path


if __name__ == "__main__":
    import yaml

    config_path = Path(__file__).parent.parent / "config.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    # Test with empty data
    snapshot = {"git": {"totals": {}, "repos": {}}, "system": {}, "memory": {}}
    narratives = {"executive_summary": "Test report.", "this_week_highlights": ["Test item"]}
    manual = {}

    path = build(snapshot, narratives, manual, config)
    print(f"Report generated: {path}")
