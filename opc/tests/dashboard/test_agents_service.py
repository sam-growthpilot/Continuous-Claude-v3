"""Tests for AgentsPillarService — parses telemetry + agent cache dirs."""

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

from dashboard.services.agents import AgentsPillarService


@pytest.fixture
def tmp_dirs(tmp_path):
    """Create temp telemetry file and agent cache directory."""
    telemetry_file = tmp_path / "skill-telemetry.jsonl"
    agents_dir = tmp_path / "agents"
    agents_dir.mkdir()
    return telemetry_file, agents_dir


@pytest.fixture
def sample_telemetry_lines():
    """Sample telemetry JSONL lines."""
    return [
        json.dumps({
            "timestamp": "2026-01-14T01:07:07.231Z",
            "session_id": "sess-001",
            "type": "agent_spawned",
            "name": "scout",
            "trigger_source": "llm",
            "success": True,
        }),
        json.dumps({
            "timestamp": "2026-01-14T01:08:54.288Z",
            "session_id": "sess-001",
            "type": "agent_spawned",
            "name": "kraken",
            "trigger_source": "llm",
            "success": True,
        }),
        json.dumps({
            "timestamp": "2026-01-14T02:00:00.000Z",
            "session_id": "sess-002",
            "type": "agent_spawned",
            "name": "scout",
            "trigger_source": "llm",
            "success": False,
        }),
        json.dumps({
            "timestamp": "2026-01-15T01:57:27.977Z",
            "session_id": "sess-002",
            "type": "skill_used",
            "name": "react-perf",
            "trigger_source": "llm",
            "success": True,
        }),
        json.dumps({
            "timestamp": "2026-01-15T03:00:00.000Z",
            "session_id": "sess-003",
            "type": "agent_spawned",
            "name": "kraken",
            "trigger_source": "llm",
            "success": True,
        }),
    ]


class TestAgentsPillarService:
    """Test the agents pillar service."""

    def test_init(self):
        """Service initializes with correct pillar name."""
        svc = AgentsPillarService()
        assert svc.name == "agents"

    def test_parse_telemetry_counts_agents(self, tmp_dirs, sample_telemetry_lines):
        """Parsing telemetry counts agent spawns by type."""
        telemetry_file, agents_dir = tmp_dirs
        telemetry_file.write_text("\n".join(sample_telemetry_lines) + "\n")

        svc = AgentsPillarService(
            telemetry_path=telemetry_file,
            agents_dir=agents_dir,
        )
        data = svc._parse_telemetry()

        assert data["by_agent"]["scout"] == 2
        assert data["by_agent"]["kraken"] == 2
        assert data["total_spawns"] == 4  # only agent_spawned events
        assert "react-perf" not in data["by_agent"]  # skill_used excluded

    def test_parse_telemetry_success_rate(self, tmp_dirs, sample_telemetry_lines):
        """Parses success vs failure counts."""
        telemetry_file, agents_dir = tmp_dirs
        telemetry_file.write_text("\n".join(sample_telemetry_lines) + "\n")

        svc = AgentsPillarService(
            telemetry_path=telemetry_file,
            agents_dir=agents_dir,
        )
        data = svc._parse_telemetry()

        assert data["success_count"] == 3
        assert data["failure_count"] == 1

    def test_parse_telemetry_recent_spawns(self, tmp_dirs, sample_telemetry_lines):
        """Recent spawns returns most recent events first."""
        telemetry_file, agents_dir = tmp_dirs
        telemetry_file.write_text("\n".join(sample_telemetry_lines) + "\n")

        svc = AgentsPillarService(
            telemetry_path=telemetry_file,
            agents_dir=agents_dir,
        )
        data = svc._parse_telemetry()

        recent = data["recent_spawns"]
        assert len(recent) <= 20
        assert recent[0]["name"] == "kraken"  # most recent timestamp
        assert recent[0]["timestamp"] == "2026-01-15T03:00:00.000Z"

    def test_parse_telemetry_empty_file(self, tmp_dirs):
        """Handles empty telemetry file gracefully."""
        telemetry_file, agents_dir = tmp_dirs
        telemetry_file.write_text("")

        svc = AgentsPillarService(
            telemetry_path=telemetry_file,
            agents_dir=agents_dir,
        )
        data = svc._parse_telemetry()

        assert data["total_spawns"] == 0
        assert data["by_agent"] == {}
        assert data["recent_spawns"] == []

    def test_parse_telemetry_missing_file(self, tmp_dirs):
        """Handles missing telemetry file gracefully."""
        _, agents_dir = tmp_dirs
        missing_path = Path("/nonexistent/telemetry.jsonl")

        svc = AgentsPillarService(
            telemetry_path=missing_path,
            agents_dir=agents_dir,
        )
        data = svc._parse_telemetry()

        assert data["total_spawns"] == 0

    def test_parse_telemetry_malformed_line(self, tmp_dirs):
        """Skips malformed JSON lines without crashing."""
        telemetry_file, agents_dir = tmp_dirs
        lines = [
            json.dumps({"timestamp": "2026-01-14T01:00:00Z", "type": "agent_spawned", "name": "scout", "session_id": "s1", "success": True}),
            "NOT VALID JSON {{{",
            json.dumps({"timestamp": "2026-01-14T02:00:00Z", "type": "agent_spawned", "name": "kraken", "session_id": "s2", "success": True}),
        ]
        telemetry_file.write_text("\n".join(lines) + "\n")

        svc = AgentsPillarService(
            telemetry_path=telemetry_file,
            agents_dir=agents_dir,
        )
        data = svc._parse_telemetry()

        assert data["total_spawns"] == 2

    def test_list_agent_types(self, tmp_dirs):
        """Lists agent types from cache directories."""
        _, agents_dir = tmp_dirs
        (agents_dir / "scout").mkdir()
        (agents_dir / "kraken").mkdir()
        (agents_dir / "spark").mkdir()
        # Files should be ignored
        (agents_dir / "some-file.txt").write_text("not a dir")

        svc = AgentsPillarService(
            telemetry_path=Path("/nonexistent"),
            agents_dir=agents_dir,
        )
        types = svc._list_agent_types()

        assert sorted(types) == ["kraken", "scout", "spark"]

    def test_list_agent_types_missing_dir(self, tmp_dirs):
        """Handles missing agents directory gracefully."""
        telemetry_file, _ = tmp_dirs
        missing_dir = Path("/nonexistent/agents")

        svc = AgentsPillarService(
            telemetry_path=telemetry_file,
            agents_dir=missing_dir,
        )
        types = svc._list_agent_types()

        assert types == []

    @pytest.mark.asyncio
    async def test_get_details(self, tmp_dirs, sample_telemetry_lines):
        """get_details returns combined telemetry + agent types."""
        telemetry_file, agents_dir = tmp_dirs
        telemetry_file.write_text("\n".join(sample_telemetry_lines) + "\n")
        (agents_dir / "scout").mkdir()
        (agents_dir / "oracle").mkdir()

        svc = AgentsPillarService(
            telemetry_path=telemetry_file,
            agents_dir=agents_dir,
        )
        details = await svc.get_details()

        assert "telemetry" in details
        assert "agent_types" in details
        assert details["telemetry"]["total_spawns"] == 4
        assert "scout" in details["agent_types"]
        assert "oracle" in details["agent_types"]

    @pytest.mark.asyncio
    async def test_check_health_online(self, tmp_dirs):
        """Health check returns online when telemetry has data with low failure rate."""
        telemetry_file, agents_dir = tmp_dirs
        # 10 successes, 1 failure = 10% failure rate (below 20% threshold)
        lines = []
        for i in range(10):
            lines.append(json.dumps({
                "timestamp": f"2026-01-14T0{i}:00:00Z",
                "session_id": f"sess-{i}",
                "type": "agent_spawned",
                "name": "scout",
                "success": True,
            }))
        lines.append(json.dumps({
            "timestamp": "2026-01-14T10:00:00Z",
            "session_id": "sess-10",
            "type": "agent_spawned",
            "name": "scout",
            "success": False,
        }))
        telemetry_file.write_text("\n".join(lines) + "\n")

        svc = AgentsPillarService(
            telemetry_path=telemetry_file,
            agents_dir=agents_dir,
        )
        health = await svc.check_health()

        assert health.name == "agents"
        assert health.status.value == "online"
        assert health.count == 11  # total spawns

    @pytest.mark.asyncio
    async def test_check_health_offline(self, tmp_dirs):
        """Health check returns offline when no telemetry file."""
        _, agents_dir = tmp_dirs

        svc = AgentsPillarService(
            telemetry_path=Path("/nonexistent"),
            agents_dir=agents_dir,
        )
        health = await svc.check_health()

        assert health.status.value == "offline"

    def test_session_count(self, tmp_dirs, sample_telemetry_lines):
        """Counts unique sessions from telemetry."""
        telemetry_file, agents_dir = tmp_dirs
        telemetry_file.write_text("\n".join(sample_telemetry_lines) + "\n")

        svc = AgentsPillarService(
            telemetry_path=telemetry_file,
            agents_dir=agents_dir,
        )
        data = svc._parse_telemetry()

        assert data["unique_sessions"] == 3
