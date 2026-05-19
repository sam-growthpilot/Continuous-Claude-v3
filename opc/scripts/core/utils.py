"""Shared utilities for opc/scripts/core/*.

Lightweight module — only stdlib imports so it is safe to import at the
top of any core script without pulling in heavy dependencies (torch, numpy,
sentence-transformers). (Phase 2 MEDIUM-4)
"""
from __future__ import annotations

import math
from typing import Sequence


def percentile(values: Sequence[float], pct: float) -> float:
    """Compute the pct-th percentile (0-100) using nearest-rank with ceil + clamp.

    Matches the algorithm used across rerank.py, eval_recall.py, and
    embedding_daemon.py bench modes. For pct=50 on even-length data, returns
    the upper median (not the average of two middle values) for consistency
    with the nearest-rank semantics.

    For pct=50 specifically — if you need the true median (average of two
    middle values for even n) — use ``median()`` instead.

    Args:
        values: Non-empty sequence of float values.
        pct: Percentile to compute, in [0, 100].

    Returns:
        The nearest-rank percentile value.

    Raises:
        ValueError: If ``values`` is empty.
    """
    if not values:
        raise ValueError("percentile requires non-empty values")
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    idx = min(n - 1, int(math.ceil(n * pct / 100)) - 1)
    return sorted_vals[max(0, idx)]


def median(values: Sequence[float]) -> float:
    """True median: average of two middle values for even-length, middle for odd.

    Matches the p50 formula used in rerank.py and embedding_daemon.py bench
    modes (post-fix commit 83d1308).

    Args:
        values: Non-empty sequence of float values.

    Returns:
        The median value.

    Raises:
        ValueError: If ``values`` is empty.
    """
    if not values:
        raise ValueError("median requires non-empty values")
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    if n % 2 == 0:
        return (sorted_vals[n // 2 - 1] + sorted_vals[n // 2]) / 2.0
    return sorted_vals[n // 2]
