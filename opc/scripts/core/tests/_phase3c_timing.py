"""Phase 3C: measure cold-load vs cached load of the BGE model.

Run from opc/ as:
    PYTHONPATH=. uv run python scripts/core/tests/_phase3c_timing.py

Not a pytest test (it loads BGE which costs time + memory). Used in the
Phase 3C verification record only.
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

# Make scripts/core importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import project_memory  # noqa: E402


async def main() -> None:
    # First call: pays cold-load cost.
    project_memory._embedder = None  # ensure clean state
    t0 = time.perf_counter()
    e1 = project_memory.get_embedder()
    t1 = time.perf_counter()
    cold_ms = (t1 - t0) * 1000

    # First embedding call (also blocks on model warm-up if any).
    t2 = time.perf_counter()
    _ = await e1.embed("warmup")
    t3 = time.perf_counter()
    embed_ms = (t3 - t2) * 1000

    # Second call: should be ~immediate (just dict lookup).
    t4 = time.perf_counter()
    e2 = project_memory.get_embedder()
    t5 = time.perf_counter()
    warm_ms = (t5 - t4) * 1000

    assert e1 is e2, "singleton must return same instance"

    print(f"Phase 3C cold-load timings:")
    print(f"  get_embedder() cold (first call):     {cold_ms:.1f} ms")
    print(f"  embed('warmup') after construction:    {embed_ms:.1f} ms")
    print(f"  get_embedder() warm (cached):          {warm_ms:.3f} ms")
    print(f"  same instance returned:                {e1 is e2}")


if __name__ == "__main__":
    asyncio.run(main())
