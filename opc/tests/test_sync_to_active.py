"""Regression tests for scripts/sync-to-active.sh.

The forward sync script (continuous-claude/.claude/ -> ~/.claude/) deliberately
excludes hooks/src so it doesn't stomp dist mtimes and re-trip
hook-dist-freshness. This invariant has been broken once (commit c0fe795) and
the resulting "hook re-stale" loop is hard to debug in the wild, so we encode
it here as a hard test.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SYNC_SCRIPT = REPO_ROOT / "scripts" / "sync-to-active.sh"


def _extract_sync_dirs(script_text: str) -> list[str]:
    """Find the SYNC_DIRS=... assignment and return the list of dirs.

    Handles either ``SYNC_DIRS="a b c"`` (space-separated, the current form)
    or the bash array form ``SYNC_DIRS=(a b c)`` if anyone ever switches.
    """
    m = re.search(r'^SYNC_DIRS=(?:"([^"]*)"|\(([^)]*)\))',
                  script_text, re.MULTILINE)
    assert m, "SYNC_DIRS assignment not found in sync-to-active.sh"
    raw = m.group(1) or m.group(2)
    return [d for d in raw.split() if d]


def test_sync_script_exists():
    assert SYNC_SCRIPT.is_file(), f"missing {SYNC_SCRIPT}"


def test_sync_dirs_excludes_hooks_src():
    """hooks/src must NEVER appear in SYNC_DIRS.

    Why: copying repo src over active src updates mtimes and makes every
    .ts look newer than its .mjs, tripping hook-dist-freshness with
    nothing to do. The active dir uses dist/*.mjs (built from repo src
    by `npm run build` before sync); src is not used at runtime.

    History: this exclusion was added in commit c0fe795 after a real
    incident. Don't put it back.
    """
    text = SYNC_SCRIPT.read_text(encoding="utf-8")
    sync_dirs = _extract_sync_dirs(text)
    assert "hooks/src" not in sync_dirs, (
        f"hooks/src must not be in SYNC_DIRS (got {sync_dirs!r}). "
        "See c0fe795 -- copying src stomps mtimes and re-trips "
        "hook-dist-freshness WARN."
    )
    # Also catch nested forms anyone might accidentally introduce.
    assert "hooks" not in sync_dirs, (
        f"'hooks' (root) must not be in SYNC_DIRS (got {sync_dirs!r}); "
        "it would sweep src/ along with everything else."
    )


def test_sync_dirs_has_expected_members():
    """Sanity guard: keep at least the canonical dirs flowing.

    Loose check by design -- new dirs are fine, but losing rules/skills/
    agents silently would break the active install.
    """
    text = SYNC_SCRIPT.read_text(encoding="utf-8")
    sync_dirs = set(_extract_sync_dirs(text))
    for required in {"rules", "skills", "agents"}:
        assert required in sync_dirs, (
            f"SYNC_DIRS must include {required!r} for forward sync to work, "
            f"got {sorted(sync_dirs)!r}"
        )


def test_sync_script_documents_hooks_src_exclusion():
    """The 'why' has to live near the exclusion, not just in this test.

    Without the comment, a future maintainer will re-add hooks/src to
    SYNC_DIRS in good faith. Keep the rationale on the script itself.
    """
    text = SYNC_SCRIPT.read_text(encoding="utf-8")
    # Look for the exclusion comment near SYNC_DIRS. Match loosely so we
    # don't lock the exact wording, but require the key terms.
    assert "hooks/src" in text and "exclud" in text.lower(), (
        "sync-to-active.sh must explicitly comment why hooks/src is "
        "excluded from SYNC_DIRS (so future maintainers don't re-add it)."
    )
