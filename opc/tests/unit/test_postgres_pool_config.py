"""Unit tests for the asyncpg pool config (A1, 2026-06-29).

Verifies the idle-connection lifetime is set EXPLICITLY (multi-week freshness
guarantee) and is env-overridable, so the pool never relies on an asyncpg
library default that a future upgrade could change.
"""
from __future__ import annotations

import sys
from pathlib import Path

# opc root on the path so `scripts.core.db...` imports resolve.
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from scripts.core.db.postgres_pool import _get_pool_config


def test_pool_config_sets_explicit_idle_lifetime_default(monkeypatch):
    """Default: 300s, set explicitly (not left to the asyncpg default)."""
    monkeypatch.delenv("AGENTICA_POOL_MAX_IDLE_S", raising=False)
    cfg = _get_pool_config()
    assert cfg["max_inactive_connection_lifetime"] == 300.0


def test_pool_config_idle_lifetime_env_override(monkeypatch):
    """AGENTICA_POOL_MAX_IDLE_S overrides the lifetime."""
    monkeypatch.setenv("AGENTICA_POOL_MAX_IDLE_S", "120")
    assert _get_pool_config()["max_inactive_connection_lifetime"] == 120.0


def test_pool_config_idle_lifetime_zero_disables(monkeypatch):
    """0 is honored verbatim (asyncpg semantics: disable idle eviction)."""
    monkeypatch.setenv("AGENTICA_POOL_MAX_IDLE_S", "0")
    assert _get_pool_config()["max_inactive_connection_lifetime"] == 0.0


def test_pool_config_idle_lifetime_invalid_falls_back(monkeypatch):
    """Non-numeric / negative -> safe 300s default (never crash startup)."""
    monkeypatch.setenv("AGENTICA_POOL_MAX_IDLE_S", "not-a-number")
    assert _get_pool_config()["max_inactive_connection_lifetime"] == 300.0
    monkeypatch.setenv("AGENTICA_POOL_MAX_IDLE_S", "-5")
    assert _get_pool_config()["max_inactive_connection_lifetime"] == 300.0


def test_pool_config_keeps_existing_keys():
    """Additive change: min_size / max_size / command_timeout still present."""
    cfg = _get_pool_config()
    assert "min_size" in cfg and "max_size" in cfg and "command_timeout" in cfg
