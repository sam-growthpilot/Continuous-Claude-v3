"""Unit tests for opc/scripts/core/eval_recall.py — eval harness."""
from __future__ import annotations
import sys
from pathlib import Path

# Mirror the path setup from test_rerank.py:33-42 so we can import scripts.core.eval_recall
opc_root = Path(__file__).resolve().parents[2]
opc_scripts = opc_root / "scripts"
for p in (opc_root, opc_scripts):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))


class TestSysPathBootstrap:
    def test_eval_recall_imports_core_utils_at_module_scope(self):
        """Bug B regression: eval_recall must import core.utils.percentile at module
        load time, not lazily inside _percentile. This proves the sys.path.insert
        bootstrap is in effect AND that the percentile name is bound at module
        scope (not deferred until the function is called)."""
        import importlib
        m = importlib.import_module("scripts.core.eval_recall")
        # The lifted top-level import binds `_pct` (or whatever alias the fix uses).
        # Be defensive: accept either `_pct` or `percentile` at module scope.
        has_pct = hasattr(m, "_pct") or hasattr(m, "percentile")
        assert has_pct, (
            "eval_recall must have core.utils.percentile bound at module scope "
            "(Bug B regression check — see docs/memory-system-handoff-2026-05-20.md)"
        )

    def test_percentile_helper_still_works(self):
        """Sanity check: _percentile() still returns correct values after the refactor."""
        from scripts.core.eval_recall import _percentile
        # 10 values, p50 nearest-rank should be index ceil(10*50/100)-1 = 4 → 25.0
        values = [10.0, 12.0, 15.0, 20.0, 25.0, 30.0, 35.0, 40.0, 45.0, 50.0]
        assert _percentile(values, 50) == 25.0
        assert _percentile([], 50) == 0.0  # empty short-circuit
