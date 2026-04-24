"""Unit tests for behavioral configuration wizard step.

Tests cover:
- Template loading from .claude/templates/
- Placeholder substitution ({{DOCKER_PATH}})
- Docker path auto-detection
- Skip behavior when files already exist
- File write to ~/.claude/
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure project root is in sys.path
opc_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(opc_root))


class TestDetectDockerPath:
    """Tests for Docker path auto-detection."""

    def test_docker_found_via_shutil_which(self):
        """When docker is on PATH, shutil.which returns its path."""
        from scripts.setup.wizard import detect_docker_path

        with patch("shutil.which", return_value="/usr/bin/docker"):
            result = detect_docker_path()
            assert result == "/usr/bin/docker"

    def test_docker_not_found_returns_platform_default_windows(self):
        """When docker not on PATH, return Windows default on win32."""
        from scripts.setup.wizard import detect_docker_path

        with patch("shutil.which", return_value=None), \
             patch("sys.platform", "win32"):
            result = detect_docker_path()
            assert "docker" in result.lower()
            assert "Program Files" in result or "docker" in result.lower()

    def test_docker_not_found_returns_platform_default_linux(self):
        """When docker not on PATH, return Linux default on linux."""
        from scripts.setup.wizard import detect_docker_path

        with patch("shutil.which", return_value=None), \
             patch("sys.platform", "linux"):
            result = detect_docker_path()
            assert result == "/usr/bin/docker"

    def test_docker_not_found_returns_platform_default_darwin(self):
        """When docker not on PATH, return macOS default on darwin."""
        from scripts.setup.wizard import detect_docker_path

        with patch("shutil.which", return_value=None), \
             patch("sys.platform", "darwin"):
            result = detect_docker_path()
            assert "docker" in result.lower()


class TestLoadAndSubstituteTemplate:
    """Tests for template loading and placeholder substitution."""

    def test_loads_template_file(self, tmp_path):
        """Template file is read from the given path."""
        from scripts.setup.wizard import load_and_substitute_template

        template = tmp_path / "TEST.md.template"
        template.write_text("Hello {{DOCKER_PATH}} world", encoding="utf-8")

        result = load_and_substitute_template(
            template, {"DOCKER_PATH": "/usr/bin/docker"}
        )
        assert result == "Hello /usr/bin/docker world"

    def test_substitutes_multiple_placeholders(self, tmp_path):
        """All occurrences of a placeholder are replaced."""
        from scripts.setup.wizard import load_and_substitute_template

        template = tmp_path / "TEST.md.template"
        template.write_text(
            "Docker: {{DOCKER_PATH}}\nAlso: {{DOCKER_PATH}}",
            encoding="utf-8",
        )

        result = load_and_substitute_template(
            template, {"DOCKER_PATH": "/usr/bin/docker"}
        )
        assert result.count("/usr/bin/docker") == 2
        assert "{{DOCKER_PATH}}" not in result

    def test_preserves_content_without_placeholders(self, tmp_path):
        """Content without placeholders is returned unchanged."""
        from scripts.setup.wizard import load_and_substitute_template

        template = tmp_path / "TEST.md.template"
        content = "# No placeholders here\nJust text."
        template.write_text(content, encoding="utf-8")

        result = load_and_substitute_template(template, {"DOCKER_PATH": "/x"})
        assert result == content

    def test_raises_on_missing_template(self, tmp_path):
        """FileNotFoundError raised when template does not exist."""
        from scripts.setup.wizard import load_and_substitute_template

        missing = tmp_path / "MISSING.md.template"
        with pytest.raises(FileNotFoundError):
            load_and_substitute_template(missing, {})


class TestInstallBehavioralConfig:
    """Tests for the install_behavioral_config function."""

    def test_creates_claude_md_from_template(self, tmp_path):
        """CLAUDE.md is created at target dir from template."""
        from scripts.setup.wizard import install_behavioral_config

        # Setup: template source
        templates_dir = tmp_path / "repo" / ".claude" / "templates"
        templates_dir.mkdir(parents=True)
        (templates_dir / "CLAUDE.md.template").write_text(
            "# CLAUDE.md\nDocker: {{DOCKER_PATH}}", encoding="utf-8"
        )
        (templates_dir / "RULES.md.template").write_text(
            "# RULES.md\nDocker: {{DOCKER_PATH}}", encoding="utf-8"
        )

        # Target
        target_dir = tmp_path / "home" / ".claude"
        target_dir.mkdir(parents=True)

        result = install_behavioral_config(templates_dir, target_dir, "/usr/bin/docker")

        assert result["claude_md_installed"] is True
        assert result["rules_md_installed"] is True
        assert (target_dir / "CLAUDE.md").exists()
        assert (target_dir / "RULES.md").exists()

        claude_content = (target_dir / "CLAUDE.md").read_text(encoding="utf-8")
        assert "/usr/bin/docker" in claude_content
        assert "{{DOCKER_PATH}}" not in claude_content

    def test_skips_when_claude_md_exists(self, tmp_path):
        """Existing CLAUDE.md is not overwritten."""
        from scripts.setup.wizard import install_behavioral_config

        templates_dir = tmp_path / "repo" / ".claude" / "templates"
        templates_dir.mkdir(parents=True)
        (templates_dir / "CLAUDE.md.template").write_text(
            "New content", encoding="utf-8"
        )
        (templates_dir / "RULES.md.template").write_text(
            "New rules", encoding="utf-8"
        )

        target_dir = tmp_path / "home" / ".claude"
        target_dir.mkdir(parents=True)
        (target_dir / "CLAUDE.md").write_text("Existing custom", encoding="utf-8")

        result = install_behavioral_config(templates_dir, target_dir, "/usr/bin/docker")

        assert result["claude_md_installed"] is False
        assert result["claude_md_skipped"] is True
        # Existing content preserved
        assert (target_dir / "CLAUDE.md").read_text(encoding="utf-8") == "Existing custom"

    def test_skips_when_rules_md_exists(self, tmp_path):
        """Existing RULES.md is not overwritten."""
        from scripts.setup.wizard import install_behavioral_config

        templates_dir = tmp_path / "repo" / ".claude" / "templates"
        templates_dir.mkdir(parents=True)
        (templates_dir / "CLAUDE.md.template").write_text(
            "New claude", encoding="utf-8"
        )
        (templates_dir / "RULES.md.template").write_text(
            "New rules", encoding="utf-8"
        )

        target_dir = tmp_path / "home" / ".claude"
        target_dir.mkdir(parents=True)
        (target_dir / "RULES.md").write_text("Existing rules", encoding="utf-8")

        result = install_behavioral_config(templates_dir, target_dir, "/usr/bin/docker")

        assert result["rules_md_installed"] is False
        assert result["rules_md_skipped"] is True
        assert (target_dir / "RULES.md").read_text(encoding="utf-8") == "Existing rules"

    def test_handles_missing_template_gracefully(self, tmp_path):
        """Missing template files produce error result, not crash."""
        from scripts.setup.wizard import install_behavioral_config

        templates_dir = tmp_path / "repo" / ".claude" / "templates"
        templates_dir.mkdir(parents=True)
        # No template files created

        target_dir = tmp_path / "home" / ".claude"
        target_dir.mkdir(parents=True)

        result = install_behavioral_config(templates_dir, target_dir, "/usr/bin/docker")

        assert result["claude_md_installed"] is False
        assert result["rules_md_installed"] is False
        assert "error" in result or "claude_md_error" in result

    def test_creates_target_dir_if_missing(self, tmp_path):
        """Target directory is created if it does not exist."""
        from scripts.setup.wizard import install_behavioral_config

        templates_dir = tmp_path / "repo" / ".claude" / "templates"
        templates_dir.mkdir(parents=True)
        (templates_dir / "CLAUDE.md.template").write_text(
            "# Config", encoding="utf-8"
        )
        (templates_dir / "RULES.md.template").write_text(
            "# Rules", encoding="utf-8"
        )

        target_dir = tmp_path / "home" / ".claude"
        # Note: NOT creating target_dir

        result = install_behavioral_config(templates_dir, target_dir, "/usr/bin/docker")

        assert result["claude_md_installed"] is True
        assert target_dir.exists()


class TestTemplateContentIntegrity:
    """Tests that actual template files contain expected sections."""

    @pytest.fixture
    def repo_root(self):
        """Get the continuous-claude repo root."""
        return Path(__file__).parent.parent.parent.parent

    def test_claude_md_template_exists(self, repo_root):
        """CLAUDE.md.template exists in .claude/templates/."""
        template = repo_root / ".claude" / "templates" / "CLAUDE.md.template"
        assert template.exists(), f"Template not found at {template}"

    def test_rules_md_template_exists(self, repo_root):
        """RULES.md.template exists in .claude/templates/."""
        template = repo_root / ".claude" / "templates" / "RULES.md.template"
        assert template.exists(), f"Template not found at {template}"

    def test_claude_md_template_has_philosophy_section(self, repo_root):
        """CLAUDE.md template contains the Philosophy section."""
        template = repo_root / ".claude" / "templates" / "CLAUDE.md.template"
        content = template.read_text(encoding="utf-8")
        assert "## Philosophy" in content

    def test_claude_md_template_has_code_standards(self, repo_root):
        """CLAUDE.md template contains Code Standards section."""
        template = repo_root / ".claude" / "templates" / "CLAUDE.md.template"
        content = template.read_text(encoding="utf-8")
        assert "## Code Standards" in content

    def test_claude_md_template_has_docker_placeholder(self, repo_root):
        """CLAUDE.md template uses {{DOCKER_PATH}} not a hardcoded path."""
        template = repo_root / ".claude" / "templates" / "CLAUDE.md.template"
        content = template.read_text(encoding="utf-8")
        # Should not contain Dave's specific Docker path
        assert r"C:\Program Files\Docker" not in content

    def test_rules_md_template_has_severity_system(self, repo_root):
        """RULES.md template contains the Severity System section."""
        template = repo_root / ".claude" / "templates" / "RULES.md.template"
        content = template.read_text(encoding="utf-8")
        assert "## Severity System" in content

    def test_rules_md_template_has_docker_placeholder(self, repo_root):
        """RULES.md template uses {{DOCKER_PATH}} not a hardcoded path."""
        template = repo_root / ".claude" / "templates" / "RULES.md.template"
        content = template.read_text(encoding="utf-8")
        assert "{{DOCKER_PATH}}" in content
        assert r"C:\Program Files\Docker" not in content

    def test_rules_md_template_has_security_standards(self, repo_root):
        """RULES.md template contains Security Standards section."""
        template = repo_root / ".claude" / "templates" / "RULES.md.template"
        content = template.read_text(encoding="utf-8")
        assert "## Security Standards" in content
