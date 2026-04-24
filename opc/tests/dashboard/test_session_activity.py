"""Tests for session activity service and router.

Tests the ability to read per-session hook/skill activity data
from ~/.claude/cache/session-activity/{sessionId}.json files.
"""

import json
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

from dashboard.services.sessions import SessionsService


class TestGetSessionActivity:
    """Tests for SessionsService.get_session_activity()."""

    @pytest.fixture
    def activity_dir(self, tmp_path):
        """Create a temporary session-activity directory with test data."""
        activity_path = tmp_path / "session-activity"
        activity_path.mkdir()
        return activity_path

    @pytest.fixture
    def service(self):
        return SessionsService()

    def _write_activity(self, activity_dir: Path, session_id: str, data: dict):
        """Helper to write a session activity JSON file."""
        filepath = activity_dir / f"{session_id}.json"
        filepath.write_text(json.dumps(data))

    @pytest.mark.asyncio
    async def test_returns_activity_for_valid_session(self, service, activity_dir):
        """Should return parsed activity data for a session with hooks/skills."""
        session_id = "abc-123-def"
        activity_data = {
            "session_id": session_id,
            "started_at": "2026-03-04T10:30:00Z",
            "skills": [
                {"name": "memory", "first_seen": "2026-03-04T10:31:00Z", "count": 5},
            ],
            "hooks": [
                {"name": "pre-tool-use", "first_seen": "2026-03-04T10:30:10Z", "count": 10},
                {"name": "post-tool-use", "first_seen": "2026-03-04T10:30:15Z", "count": 8},
            ],
        }
        self._write_activity(activity_dir, session_id, activity_data)

        result = await service.get_session_activity(
            session_id, activity_dir=str(activity_dir)
        )

        assert result is not None
        assert result["session_id"] == session_id
        assert result["started_at"] == "2026-03-04T10:30:00Z"
        assert len(result["skills"]) == 1
        assert result["skills"][0]["name"] == "memory"
        assert result["skills"][0]["count"] == 5
        assert len(result["hooks"]) == 2
        assert result["hooks"][0]["name"] == "pre-tool-use"
        assert result["hooks"][0]["count"] == 10

    @pytest.mark.asyncio
    async def test_returns_none_for_missing_session(self, service, activity_dir):
        """Should return None when session activity file does not exist."""
        result = await service.get_session_activity(
            "nonexistent-session", activity_dir=str(activity_dir)
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_for_invalid_json(self, service, activity_dir):
        """Should return None when the activity file contains invalid JSON."""
        bad_file = activity_dir / "bad-session.json"
        bad_file.write_text("not valid json {{{")

        result = await service.get_session_activity(
            "bad-session", activity_dir=str(activity_dir)
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_empty_hooks_and_skills(self, service, activity_dir):
        """Should handle sessions with empty hooks and skills arrays."""
        session_id = "empty-session"
        activity_data = {
            "session_id": session_id,
            "started_at": "2026-03-04T12:00:00Z",
            "skills": [],
            "hooks": [],
        }
        self._write_activity(activity_dir, session_id, activity_data)

        result = await service.get_session_activity(
            session_id, activity_dir=str(activity_dir)
        )

        assert result is not None
        assert result["skills"] == []
        assert result["hooks"] == []

    @pytest.mark.asyncio
    async def test_includes_summary_counts(self, service, activity_dir):
        """Should include total_hooks and total_skills summary counts."""
        session_id = "summary-session"
        activity_data = {
            "session_id": session_id,
            "started_at": "2026-03-04T12:00:00Z",
            "skills": [
                {"name": "memory", "first_seen": "2026-03-04T12:01:00Z", "count": 3},
                {"name": "commit", "first_seen": "2026-03-04T12:02:00Z", "count": 2},
            ],
            "hooks": [
                {"name": "smart-search-router", "first_seen": "2026-03-04T12:01:00Z", "count": 6},
                {"name": "skill-activation-prompt", "first_seen": "2026-03-04T12:02:00Z", "count": 13},
                {"name": "memory-awareness", "first_seen": "2026-03-04T12:03:00Z", "count": 4},
            ],
        }
        self._write_activity(activity_dir, session_id, activity_data)

        result = await service.get_session_activity(
            session_id, activity_dir=str(activity_dir)
        )

        assert result is not None
        assert result["total_skills"] == 5  # 3 + 2
        assert result["total_hooks"] == 23  # 6 + 13 + 4

    @pytest.mark.asyncio
    async def test_sanitizes_path_traversal(self, service, activity_dir):
        """Should reject session IDs with path traversal characters."""
        result = await service.get_session_activity(
            "../../../etc/passwd", activity_dir=str(activity_dir)
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_default_activity_dir(self, service):
        """Should use the default activity dir when none is specified."""
        # Test with a session that definitely won't exist
        result = await service.get_session_activity("nonexistent-test-id-99999")
        assert result is None  # Just verifying it doesn't crash


class TestSessionActivityRouter:
    """Tests for the /api/sessions/{session_id}/activity endpoint."""

    @pytest.fixture
    def activity_dir(self, tmp_path):
        activity_path = tmp_path / "session-activity"
        activity_path.mkdir()
        return activity_path

    def _write_activity(self, activity_dir: Path, session_id: str, data: dict):
        filepath = activity_dir / f"{session_id}.json"
        filepath.write_text(json.dumps(data))

    @pytest.mark.asyncio
    async def test_activity_endpoint_returns_data(self, activity_dir):
        """GET /api/sessions/{id}/activity should return activity data."""
        from fastapi.testclient import TestClient
        from dashboard.routers.sessions import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        session_id = "test-endpoint-session"
        activity_data = {
            "session_id": session_id,
            "started_at": "2026-03-04T10:30:00Z",
            "skills": [{"name": "memory", "first_seen": "2026-03-04T10:31:00Z", "count": 5}],
            "hooks": [{"name": "pre-tool-use", "first_seen": "2026-03-04T10:30:10Z", "count": 10}],
        }
        self._write_activity(activity_dir, session_id, activity_data)

        client = TestClient(app)

        with patch(
            "dashboard.routers.sessions.DEFAULT_ACTIVITY_DIR",
            str(activity_dir),
        ):
            response = client.get(f"/api/sessions/{session_id}/activity")

        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == session_id
        assert len(data["hooks"]) == 1
        assert data["total_hooks"] == 10

    @pytest.mark.asyncio
    async def test_activity_endpoint_404_for_missing(self, activity_dir):
        """GET /api/sessions/{id}/activity should return 404 for missing session."""
        from fastapi.testclient import TestClient
        from dashboard.routers.sessions import router
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)

        client = TestClient(app)

        with patch(
            "dashboard.routers.sessions.DEFAULT_ACTIVITY_DIR",
            str(activity_dir),
        ):
            response = client.get("/api/sessions/nonexistent/activity")

        assert response.status_code == 404
