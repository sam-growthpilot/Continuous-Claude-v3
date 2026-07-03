"""Collect git metrics from configured repositories."""

import os
import subprocess
from datetime import datetime, timedelta
from pathlib import Path


def run_git(repo_path: str, args: list[str]) -> str:
    """Run a git command and return stdout."""
    try:
        result = subprocess.run(
            ["git", "-C", repo_path] + args,
            capture_output=True, text=True, timeout=30,
            encoding="utf-8", errors="replace"
        )
        return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ""


def collect_repo_metrics(repo_config: dict, since_days: int = 7) -> dict:
    """Collect git metrics for a single repository."""
    path = repo_config["path"]
    name = repo_config["name"]
    label = repo_config.get("label", name)

    if not Path(path).exists():
        return {
            "name": name,
            "label": label,
            "exists": False,
            "error": f"Repository path not found: {path}"
        }

    since_date = (datetime.now() - timedelta(days=since_days)).strftime("%Y-%m-%d")

    # Commits this week
    week_log = run_git(path, [
        "log", f"--since={since_date}", "--oneline", "--no-merges"
    ])
    week_commits = len(week_log.splitlines()) if week_log else 0

    # Total commits
    total_log = run_git(path, ["rev-list", "--count", "HEAD"])
    total_commits = int(total_log) if total_log.isdigit() else 0

    # Top commit messages this week (for AI summarization)
    week_messages = run_git(path, [
        "log", f"--since={since_date}", "--format=%s", "--no-merges"
    ])
    top_messages = week_messages.splitlines()[:20] if week_messages else []

    # Files changed this week
    week_diff = run_git(path, [
        "diff", "--stat", f"--since={since_date}", "HEAD"
    ])
    # Fallback: use diffstat from log
    if not week_diff:
        week_diff = run_git(path, [
            "log", f"--since={since_date}", "--stat", "--format="
        ])

    files_changed = 0
    insertions = 0
    deletions = 0
    if week_diff:
        for line in week_diff.splitlines():
            line = line.strip()
            if "file" in line and "changed" in line:
                parts = line.split(",")
                for part in parts:
                    part = part.strip()
                    if "file" in part:
                        files_changed += int("".join(c for c in part if c.isdigit()) or "0")
                    elif "insertion" in part:
                        insertions += int("".join(c for c in part if c.isdigit()) or "0")
                    elif "deletion" in part:
                        deletions += int("".join(c for c in part if c.isdigit()) or "0")

    # Contributors this week
    contributors_raw = run_git(path, [
        "log", f"--since={since_date}", "--format=%aN", "--no-merges"
    ])
    contributors = list(set(contributors_raw.splitlines())) if contributors_raw else []

    # Current branch
    branch = run_git(path, ["rev-parse", "--abbrev-ref", "HEAD"])

    # Last commit date
    last_commit_date = run_git(path, ["log", "-1", "--format=%ci"])

    return {
        "name": name,
        "label": label,
        "exists": True,
        "branch": branch,
        "last_commit_date": last_commit_date,
        "week_commits": week_commits,
        "total_commits": total_commits,
        "top_messages": top_messages,
        "files_changed": files_changed,
        "insertions": insertions,
        "deletions": deletions,
        "contributors": contributors,
        "contributor_count": len(contributors),
    }


def collect_all(repos: list[dict], since_days: int = 7) -> dict:
    """Collect git metrics from all configured repos."""
    results = {}
    totals = {
        "week_commits": 0,
        "total_commits": 0,
        "files_changed": 0,
        "all_contributors": set(),
        "all_messages": [],
    }

    for repo in repos:
        metrics = collect_repo_metrics(repo, since_days)
        results[metrics["name"]] = metrics

        if metrics.get("exists"):
            totals["week_commits"] += metrics["week_commits"]
            totals["total_commits"] += metrics["total_commits"]
            totals["files_changed"] += metrics["files_changed"]
            totals["all_contributors"].update(metrics["contributors"])
            totals["all_messages"].extend(metrics["top_messages"])

    totals["all_contributors"] = list(totals["all_contributors"])
    totals["contributor_count"] = len(totals["all_contributors"])

    return {
        "repos": results,
        "totals": totals,
        "collected_at": datetime.now().isoformat(),
        "since_days": since_days,
    }


if __name__ == "__main__":
    import json
    import yaml

    config_path = Path(__file__).parent.parent / "config.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    data = collect_all(config["repos"])
    print(json.dumps(data, indent=2, default=str))
