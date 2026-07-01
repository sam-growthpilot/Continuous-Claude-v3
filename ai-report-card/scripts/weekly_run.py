"""Weekly Report Orchestrator.

Main entry point that:
1. Loads configuration
2. Runs collectors (git, system counts, memory)
3. Saves weekly snapshot
4. Runs AI narrator for summaries
5. Generates Word report + HTML presentation
6. Copies to destinations
7. Archives outputs
8. Optionally deploys to GitHub Pages
"""

import argparse
import json
import logging
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import yaml

from collectors.git_metrics import collect_all as collect_git
from collectors.system_counts import collect_all as collect_system
from collectors.memory_insights import collect_all as collect_memory
from generators.ai_narrator import generate_narratives
from generators.build_report import build as build_report
from generators.build_presentation import build as build_presentation

# Setup logging
LOG_DIR = Path(__file__).parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "runs.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(str(LOG_FILE), encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("weekly_run")


def load_config() -> dict:
    """Load configuration from config.yaml."""
    config_path = Path(__file__).parent.parent / "config.yaml"
    with open(config_path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_manual_inputs() -> dict:
    """Load manual inputs if available."""
    inputs_path = Path(__file__).parent.parent / "templates" / "manual_inputs.yaml"
    if not inputs_path.exists():
        return {}
    try:
        with open(inputs_path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        # Filter out empty/None values
        return {k: v for k, v in data.items() if v}
    except Exception as e:
        log.warning(f"Could not load manual inputs: {e}")
        return {}


def collect(config: dict) -> dict:
    """Run all collectors and merge into a single snapshot."""
    log.info("Running collectors...")

    log.info("  Collecting git metrics...")
    git_data = collect_git(config.get("repos", []))

    log.info("  Collecting system counts...")
    system_data = collect_system(config)

    log.info("  Collecting memory insights...")
    memory_data = collect_memory(config)

    snapshot = {
        "git": git_data,
        "system": system_data,
        "memory": memory_data,
        "collected_at": datetime.now().isoformat(),
        "week": datetime.now().isocalendar()[1],
        "year": datetime.now().year,
    }

    log.info(
        f"  Collected: {git_data['totals']['week_commits']} commits this week, "
        f"{system_data['hooks']} hooks, {system_data['skills']} skills, "
        f"{system_data['agents']} agents"
    )

    return snapshot


def save_snapshot(snapshot: dict) -> Path:
    """Save snapshot to data/snapshots/ as weekly JSON."""
    snapshots_dir = Path(__file__).parent.parent / "data" / "snapshots"
    snapshots_dir.mkdir(parents=True, exist_ok=True)

    year = snapshot["year"]
    week = snapshot["week"]
    filename = f"{year}-W{week:02d}.json"
    filepath = snapshots_dir / filename

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, indent=2, default=str)

    log.info(f"  Snapshot saved: {filepath}")
    return filepath


def load_latest_snapshot() -> dict | None:
    """Load the most recent snapshot."""
    snapshots_dir = Path(__file__).parent.parent / "data" / "snapshots"
    if not snapshots_dir.exists():
        return None

    snapshots = sorted(snapshots_dir.glob("*.json"), reverse=True)
    if not snapshots:
        return None

    with open(snapshots[0], encoding="utf-8") as f:
        return json.load(f)


def generate(snapshot: dict, config: dict, manual_inputs: dict) -> dict:
    """Run generators to produce report and presentation."""
    log.info("Generating AI narratives...")
    narratives = generate_narratives(snapshot, config)
    if narratives.get("ai_generated"):
        log.info("  AI narratives generated successfully")
    else:
        log.info("  Using fallback template narratives (AI unavailable)")
        if narratives.get("ai_error"):
            log.warning(f"  AI error: {narratives['ai_error']}")

    # Hand-written manual_inputs override the narrative fields the deck + report render,
    # so a curated executive_note / this_week_highlights / outlook takes precedence over AI/template.
    for _mk, _nk in (("executive_note", "executive_summary"),
                     ("this_week_highlights", "this_week_highlights"),
                     ("outlook", "outlook")):
        if manual_inputs.get(_mk):
            narratives[_nk] = manual_inputs[_mk]
            log.info(f"  Manual override applied: {_nk}")

    log.info("Generating Word report...")
    report_path = build_report(snapshot, narratives, manual_inputs, config)
    log.info(f"  Report saved: {report_path}")

    log.info("Generating HTML presentation...")
    pres_path = build_presentation(snapshot, narratives, manual_inputs, config)
    log.info(f"  Presentation saved: {pres_path}")

    return {
        "narratives": narratives,
        "report_path": report_path,
        "presentation_path": pres_path,
    }


def archive(week: int, year: int):
    """Archive current outputs to output/archive/YYYY-WXX/."""
    latest_dir = Path(__file__).parent.parent / "output" / "latest"
    archive_dir = Path(__file__).parent.parent / "output" / "archive" / f"{year}-W{week:02d}"

    if not latest_dir.exists():
        return

    archive_dir.mkdir(parents=True, exist_ok=True)

    for item in latest_dir.iterdir():
        if item.is_file():
            shutil.copy2(str(item), str(archive_dir / item.name))

    log.info(f"  Archived to: {archive_dir}")


def deploy(config: dict):
    """Deploy presentation to GitHub Pages."""
    pres_repo = config.get("output", {}).get("presentation_repo")
    if not pres_repo or not Path(pres_repo).exists():
        log.warning("Presentation repo not found, skipping deploy")
        return False

    deploy_script = Path(__file__).parent / "deploy.ps1"
    if not deploy_script.exists():
        log.warning("Deploy script not found, skipping deploy")
        return False

    try:
        result = subprocess.run(
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(deploy_script)],
            capture_output=True, text=True, timeout=60,
            encoding="utf-8", errors="replace"
        )
        if result.returncode == 0:
            log.info("  Deployed to GitHub Pages")
            return True
        else:
            log.warning(f"  Deploy failed: {result.stderr}")
            return False
    except Exception as e:
        log.warning(f"  Deploy error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="AI Enablement Weekly Report Generator")
    parser.add_argument("--collect-only", action="store_true", help="Only collect data, skip generation")
    parser.add_argument("--generate-only", action="store_true", help="Only generate from latest snapshot")
    parser.add_argument("--no-deploy", action="store_true", help="Skip GitHub Pages deployment")
    args = parser.parse_args()

    log.info("=" * 60)
    log.info(f"Weekly Report Run - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    config = load_config()
    manual_inputs = load_manual_inputs()

    if manual_inputs:
        log.info(f"Manual inputs loaded: {list(manual_inputs.keys())}")

    # Collect
    if args.generate_only:
        log.info("Using latest snapshot (--generate-only)")
        snapshot = load_latest_snapshot()
        if not snapshot:
            log.error("No snapshots found. Run without --generate-only first.")
            sys.exit(1)
    else:
        snapshot = collect(config)
        snapshot_path = save_snapshot(snapshot)

    if args.collect_only:
        log.info("Collection complete (--collect-only). Exiting.")
        return

    # Generate
    result = generate(snapshot, config, manual_inputs)

    # Archive
    week = datetime.now().isocalendar()[1]
    year = datetime.now().year
    archive(week, year)

    # Deploy
    if not args.no_deploy:
        deploy(config)
    else:
        log.info("Deployment skipped (--no-deploy)")

    # Summary
    log.info("")
    log.info("Run complete!")
    log.info(f"  Report: {result['report_path']}")
    log.info(f"  Presentation: {result['presentation_path']}")

    github_url = config.get("output", {}).get("github_pages_url", "")
    if github_url and not args.no_deploy:
        log.info(f"  GitHub Pages: {github_url}")

    log.info("=" * 60)


if __name__ == "__main__":
    main()
