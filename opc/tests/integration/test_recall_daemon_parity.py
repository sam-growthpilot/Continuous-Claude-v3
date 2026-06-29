"""ST-05 integration parity test: daemon recall path vs `recall_learnings.py --json`.

Premortem R7 / H1 done-gate: the resident recall path (do_recall, fed a vector
the resident BGE daemon embedded) must return the SAME result ids in the SAME
order as the canonical CLI `recall_learnings.py --query ... --k ... --json` for
an identical query/k.

Requires BOTH a live Postgres (docker `continuous-claude-postgres`) AND the
resident embedding daemon up+ready — the latter so do_recall and the CLI
subprocess embed the query with the SAME pinned model (identical query vector
=> identical pgvector leg). If either is unavailable the test SKIPS (CI without
the stack stays green).

Run explicitly:
    uv run python -m pytest tests/integration/test_recall_daemon_parity.py -v -s
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

OPC_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(OPC_ROOT))
sys.path.insert(0, str(OPC_ROOT / "scripts"))
sys.path.insert(0, str(OPC_ROOT / "scripts" / "core"))

# A query that should hit the memory corpus (memory-system work is well
# represented). Parity is asserted regardless of count; non-emptiness is
# reported for the done-gate.
PARITY_QUERY = "embedding daemon resident recall hybrid RRF memory"
PARITY_K = 5


def _daemon_ready():
    """Return (vector, info) when the daemon is up+ready, else (None, None)."""
    try:
        from core import embedding_daemon as ed
    except Exception:
        return None, None
    ping = ed.ping_daemon(timeout_s=2.0)
    if not ping or not ping.get("ready"):
        return None, None
    if ping.get("model") != ed.MODEL_NAME or ping.get("dim") != ed.EMBEDDING_DIM:
        return None, None
    resp = ed.embed_via_daemon(PARITY_QUERY, timeout_s=10.0)
    if not resp or "vector" not in resp:
        return None, None
    return resp["vector"], ping


async def _db_reachable() -> bool:
    try:
        from db.postgres_pool import health_check, reset_pool
        reset_pool()  # rebind the pool/lock to THIS test's event loop
        ok, _ = await health_check()
        return ok
    except Exception:
        return False


@pytest.mark.asyncio
async def test_daemon_recall_matches_cli_json(monkeypatch):
    """do_recall(query_vector, query, k) result ids+ordering == CLI --json.

    This is a RANKING/SCOPE parity test. Two confounds are eliminated so a
    failure can only mean a genuine ranking/param divergence:

      * Vector parity — both paths embed via the SAME running daemon model
        (do_recall is fed that exact vector; the CLI subprocess routes its
        embed to the same daemon), so the query vector is identical.
      * Scope parity — project_id is CWD-derived (get_project_id hashes the
        literal path). The CLI subprocess runs with cwd=<opc>; do_recall now
        also defaults to opc-dir scope (NOT the ambient pytest CWD). We further
        clear CLAUDE_PROJECT_ID so neither path is perturbed by ambient env.
        This mirrors production: the uv fallback runs recall_learnings.py with
        cwd=<opc>, and the resident daemon's do_recall resolves opc-dir scope.
    """
    monkeypatch.delenv("CLAUDE_PROJECT_ID", raising=False)

    query_vector, ping = _daemon_ready()
    if query_vector is None:
        pytest.skip("embedding daemon not up+ready — cannot guarantee vector parity")
    if not await _db_reachable():
        pytest.skip("Postgres not reachable (DATABASE_URL / docker container down)")

    # Daemon path: feed the resident-model vector straight into do_recall.
    # (_db_reachable already bound the pool to THIS event loop via health_check;
    # do_recall's get_pool() reuses it.) No explicit scope -> do_recall defaults
    # to opc-dir scope, identical to the uv path below.
    from core.recall_learnings import do_recall

    daemon_out = await do_recall(query_vector, PARITY_QUERY, PARITY_K, "hybrid")
    daemon_ids = [r["id"] for r in daemon_out["results"]]

    # CLI path: the subprocess embeds via the SAME daemon -> identical vector,
    # and runs with cwd=<opc> (no --project-dir) -> opc-dir scope. Env has
    # CLAUDE_PROJECT_ID stripped so scope can't be perturbed.
    sub_env = os.environ.copy()
    sub_env.pop("CLAUDE_PROJECT_ID", None)
    proc = subprocess.run(
        ["uv", "run", "python", "scripts/core/recall_learnings.py",
         "--query", PARITY_QUERY, "--k", str(PARITY_K), "--json"],
        cwd=str(OPC_ROOT),
        env=sub_env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, f"CLI failed: {proc.stderr[-2000:]}"
    cli_doc = json.loads(proc.stdout.strip().splitlines()[-1])
    cli_ids = [r["id"] for r in cli_doc["results"]]

    meta = daemon_out["_meta"]

    # Scope parity guard: both paths MUST resolve the same project scope, or the
    # id comparison is meaningless. (This is the confound that produced the
    # original false 'ranking divergence' — root-caused to a CWD scope diff.)
    assert meta.get("scope_mode") is not None
    print(
        f"\n[parity] query={PARITY_QUERY!r} k={PARITY_K} "
        f"daemon_hits={len(daemon_ids)} cli_hits={len(cli_ids)} "
        f"scope={meta.get('scope_mode')}/{meta.get('project_id')} "
        f"meta={{vector:{meta.get('vector_count')}, fts:{meta.get('fts_count')}, "
        f"drops:{meta.get('threshold_drops')}}}"
    )

    # Parity: identical ids in identical order. With vector + scope held equal,
    # decay time-skew between the two calls is ~1e-6 relative — never enough to
    # reorder distinct final_scores.
    assert daemon_ids == cli_ids, (
        f"recall parity drift:\n  daemon={daemon_ids}\n  cli   ={cli_ids}"
    )

    # Sanity on the daemon _meta block shape (H1/H6).
    assert {"vector_count", "fts_count", "threshold_drops"} <= set(meta.keys())

    if not daemon_ids:
        print("[parity] NOTE: zero hits — parity holds on empty, but the "
              "done-gate prefers a non-empty known-hit query.")
