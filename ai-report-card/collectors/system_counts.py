"""Count hooks, agents, skills, and connectors from the file system."""

from datetime import datetime
from pathlib import Path


def count_files(directory: str, pattern: str) -> int:
    """Count files matching a pattern in a directory."""
    path = Path(directory)
    if not path.exists():
        return 0
    return len(list(path.glob(pattern)))


def count_subdirs(directory: str) -> int:
    """Count immediate subdirectories."""
    path = Path(directory)
    if not path.exists():
        return 0
    return len([d for d in path.iterdir() if d.is_dir()])


def collect_all(config: dict) -> dict:
    """Collect system counts from file system."""
    counts_config = config.get("counts", {})
    connectors_config = config.get("connectors", {})

    hooks_dir = counts_config.get("hooks_dir", "")
    skills_dir = counts_config.get("skills_dir", "")
    agents_dir = counts_config.get("agents_dir", "")

    hooks_count = count_files(hooks_dir, "*.mjs")
    skills_count = count_subdirs(skills_dir)
    agents_count = count_files(agents_dir, "*.json")

    live_connectors = connectors_config.get("live", [])
    coming_connectors = connectors_config.get("coming", [])

    return {
        "hooks": hooks_count,
        "skills": skills_count,
        "agents": agents_count,
        "connectors_live": len(live_connectors),
        "connectors_coming": len(coming_connectors),
        "connector_names_live": live_connectors,
        "connector_names_coming": coming_connectors,
        "connectors_total": len(live_connectors) + len(coming_connectors),
        "collected_at": datetime.now().isoformat(),
    }


if __name__ == "__main__":
    import json
    import yaml

    config_path = Path(__file__).parent.parent / "config.yaml"
    with open(config_path) as f:
        config = yaml.safe_load(f)

    data = collect_all(config)
    print(json.dumps(data, indent=2))
