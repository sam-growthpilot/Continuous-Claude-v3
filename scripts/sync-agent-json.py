#!/usr/bin/env python
"""
sync-agent-json.py — Regenerate .json sidecars from .md agent definitions.

For each <name>.md in the target directory that has a matching <name>.json,
rebuilds the .json so description/tools/prompt reflect the canonical .md
while preserving spawn-only fields (model, permissions, blocked_patterns,
inherit_blocks).

Usage:
    python scripts/sync-agent-json.py --target .claude/agents --dry-run
    python scripts/sync-agent-json.py --target .claude/agents --apply --verbose
    python scripts/sync-agent-json.py --target .claude/agents --target ~/.claude/agents --apply

Output: JSON to stdout with status + per-file actions.
"""

import argparse
import json
import os
import pathlib
import re
import sys


def parse_frontmatter(md_path):
    """
    Parse YAML frontmatter from a .md file.

    Returns (fields_dict, body_str) or raises ValueError on bad format.

    Frontmatter must start at byte 0 with '---'.
    Supported fields: name, description, model, tools (single-line list).
    """
    text = md_path.read_text(encoding="utf-8")

    if not text.startswith("---"):
        raise ValueError(f"{md_path}: frontmatter does not start at byte 0")

    # Find closing ---
    second_dash = text.find("\n---", 3)
    if second_dash == -1:
        raise ValueError(f"{md_path}: no closing --- in frontmatter")

    frontmatter_block = text[3:second_dash]  # between first --- and second ---
    body = text[second_dash + 4:]            # everything after closing ---\n

    fields = {}
    lines = frontmatter_block.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        # Skip blank lines
        if not line.strip():
            i += 1
            continue
        # Match key: value
        m = re.match(r'^(\w[\w-]*):\s*(.*)', line)
        if not m:
            i += 1
            continue
        key = m.group(1)
        value = m.group(2).strip()
        fields[key] = value
        i += 1

    return fields, body


def parse_tools(tools_str):
    """
    Parse a YAML inline list like '[Read, Bash, Grep, Glob]' into a Python list.
    Returns [] for empty or missing values.
    """
    if not tools_str:
        return []
    # Strip surrounding brackets
    stripped = tools_str.strip()
    if stripped.startswith("[") and stripped.endswith("]"):
        stripped = stripped[1:-1]
    if not stripped.strip():
        return []
    parts = [p.strip() for p in stripped.split(",")]
    return [p for p in parts if p]


def load_existing_json(json_path):
    """Load existing .json, return dict. Returns {} on parse error."""
    try:
        return json.loads(json_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def build_new_json(md_fields, md_body, existing_json):
    """
    Construct the new .json dict.

    Precedence:
    - name, description, tools, prompt: from .md
    - model, permissions, blocked_patterns, inherit_blocks: from existing .json
      (with defaults if absent)
    """
    name = md_fields.get("name", "").strip()
    description = md_fields.get("description", "").strip()
    tools = parse_tools(md_fields.get("tools", ""))
    prompt = md_body.strip()

    # Spawn-only fields — preserve from existing .json or use defaults
    model = existing_json.get("model", "opus")
    permissions = existing_json.get("permissions", "skip")
    blocked_patterns = existing_json.get("blocked_patterns", [])
    inherit_blocks = existing_json.get("inherit_blocks", True)

    return {
        "name": name,
        "description": description,
        "prompt": prompt,
        "tools": tools,
        "model": model,
        "permissions": permissions,
        "blocked_patterns": blocked_patterns,
        "inherit_blocks": inherit_blocks,
    }


def diff_summary(old_json, new_json, agent_name):
    """
    Return a one-line human-readable diff summary between old and new JSON dicts.
    Returns None if nothing changed.
    """
    changes = []

    old_desc = old_json.get("description", "")
    new_desc = new_json.get("description", "")
    if old_desc != new_desc:
        changes.append(
            f"description changed ({len(old_desc)} -> {len(new_desc)} chars)"
        )

    old_tools = old_json.get("tools", [])
    new_tools = new_json.get("tools", [])
    if old_tools != new_tools:
        changes.append(f"tools [{len(old_tools)}] -> [{len(new_tools)}]")

    old_prompt = old_json.get("prompt", "").strip()
    new_prompt = new_json.get("prompt", "").strip()
    if old_prompt != new_prompt:
        old_lines = len(old_prompt.splitlines()) if old_prompt else 0
        new_lines = len(new_prompt.splitlines()) if new_prompt else 0
        changes.append(f"prompt {old_lines} line(s) -> {new_lines} line(s)")

    if not changes:
        return None

    return f"{agent_name}.json: " + ", ".join(changes)


def process_directory(target_dir, dry_run, verbose):
    """
    Process one agents directory.

    Returns a list of action dicts:
      {"agent": name, "action": "updated"|"skipped"|"no_change"|"error",
       "summary": str, "path": str}
    """
    target = pathlib.Path(target_dir)
    if not target.is_dir():
        return [{"agent": "?", "action": "error",
                 "summary": f"Directory not found: {target_dir}", "path": str(target_dir)}]

    results = []

    for md_path in sorted(target.glob("*.md")):
        agent_name = md_path.stem
        json_path = target / f"{agent_name}.json"

        if not json_path.exists():
            # No .json sidecar — skip (agents with .md only don't use claude_spawn.py)
            continue

        try:
            md_fields, md_body = parse_frontmatter(md_path)
        except ValueError as e:
            results.append({
                "agent": agent_name,
                "action": "error",
                "summary": str(e),
                "path": str(json_path),
            })
            continue

        existing_json = load_existing_json(json_path)
        new_json = build_new_json(md_fields, md_body, existing_json)

        summary = diff_summary(existing_json, new_json, agent_name)

        if summary is None:
            results.append({
                "agent": agent_name,
                "action": "no_change",
                "summary": f"{agent_name}.json: no changes",
                "path": str(json_path),
            })
            continue

        if verbose:
            # Print to stderr so stdout stays clean JSON
            print(f"  {summary}", file=sys.stderr)

        if dry_run:
            results.append({
                "agent": agent_name,
                "action": "would_update",
                "summary": summary,
                "path": str(json_path),
            })
        else:
            json_text = json.dumps(new_json, indent=2, ensure_ascii=False) + "\n"
            json_path.write_text(json_text, encoding="utf-8")
            results.append({
                "agent": agent_name,
                "action": "updated",
                "summary": summary,
                "path": str(json_path),
            })

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Regenerate .json sidecars from .md agent definitions."
    )
    parser.add_argument(
        "--target",
        action="append",
        required=True,
        metavar="DIR",
        help="Agents directory to operate on (repeatable)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Print what would change without writing (default mode)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Write changes",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        default=False,
        help="Show per-file diff summary to stderr",
    )
    args = parser.parse_args()

    # --dry-run and --apply are mutually exclusive; --dry-run is the safe default
    if args.apply and args.dry_run:
        print(
            json.dumps({"status": "error", "message": "--dry-run and --apply are mutually exclusive"}),
            file=sys.stdout,
        )
        sys.exit(1)

    dry_run = not args.apply  # if neither flag, default to dry-run

    all_results = []
    for target_dir in args.target:
        dir_results = process_directory(target_dir, dry_run=dry_run, verbose=args.verbose)
        for r in dir_results:
            r["directory"] = target_dir
        all_results.extend(dir_results)

    updated = [r for r in all_results if r["action"] in ("updated", "would_update")]
    no_change = [r for r in all_results if r["action"] == "no_change"]
    errors = [r for r in all_results if r["action"] == "error"]

    output = {
        "status": "ok" if not errors else "partial",
        "mode": "dry-run" if dry_run else "apply",
        "summary": {
            "updated": len(updated),
            "no_change": len(no_change),
            "errors": len(errors),
            "total_processed": len(all_results),
        },
        "actions": all_results,
    }

    print(json.dumps(output, indent=2))
    sys.exit(0 if not errors else 2)


if __name__ == "__main__":
    main()
