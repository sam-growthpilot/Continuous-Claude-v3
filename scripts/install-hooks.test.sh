#!/bin/bash
# install-hooks.test.sh
# Verifies scripts/install-hooks.sh: fresh create, idempotent re-run, and non-clobbering
# chain onto a pre-existing pre-commit hook. Runs against throwaway git repos that point
# their hooks at THIS repo's real scripts (so the installed hook is exercised verbatim).
# Usage: bash scripts/install-hooks.test.sh   (exit 0 = all pass)

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALLER="$SCRIPT_DIR/install-hooks.sh"

PASS=0; FAIL=0
pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

# Build a temp repo whose scripts/ symlinks (or copies) the real guard + installer so the
# installed hook resolves the guard. We run the installer with cwd inside the temp repo.
new_repo() {
  local d
  d="$(mktemp -d 2>/dev/null || mktemp -d -t insttest)"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.t
  git -C "$d" config user.name t
  mkdir -p "$d/scripts"
  cp "$REAL_ROOT/scripts/precommit-build-guard.sh" "$d/scripts/"
  cp "$REAL_ROOT/scripts/post-commit-hook.sh" "$d/scripts/" 2>/dev/null || true
  cp "$INSTALLER" "$d/scripts/install-hooks.sh"
  chmod +x "$d/scripts/"*.sh
  echo "$d"
}

# Case 1: fresh install creates pre-commit with the guard marker.
d="$(new_repo)"
( cd "$d" && bash scripts/install-hooks.sh >/dev/null 2>&1 )
if [ -f "$d/.git/hooks/pre-commit" ] && grep -qF ">>> ccv3 precommit-build-guard >>>" "$d/.git/hooks/pre-commit"; then
  pass "fresh install creates pre-commit guard"
else
  fail "fresh install creates pre-commit guard"
fi

# Case 2: idempotent -- second run does not duplicate the marker.
( cd "$d" && bash scripts/install-hooks.sh >/dev/null 2>&1 )
count=$(grep -cF ">>> ccv3 precommit-build-guard >>>" "$d/.git/hooks/pre-commit")
if [ "$count" = "1" ]; then pass "idempotent re-run (marker count=1)"; else fail "idempotent re-run: marker count=$count"; fi

# Case 3: chains onto an existing pre-commit without clobbering it.
d2="$(new_repo)"
printf '#!/bin/bash\necho "existing-hook-sentinel"\n' > "$d2/.git/hooks/pre-commit"
chmod +x "$d2/.git/hooks/pre-commit"
( cd "$d2" && bash scripts/install-hooks.sh >/dev/null 2>&1 )
if grep -qF "existing-hook-sentinel" "$d2/.git/hooks/pre-commit" \
   && grep -qF ">>> ccv3 precommit-build-guard >>>" "$d2/.git/hooks/pre-commit"; then
  pass "chains onto existing pre-commit (original preserved)"
else
  fail "chains onto existing pre-commit (original preserved)"
fi

# Case 4: end-to-end -- installed pre-commit actually BLOCKS a src-only commit.
d3="$(new_repo)"
( cd "$d3" && bash scripts/install-hooks.sh >/dev/null 2>&1 )
mkdir -p "$d3/.claude/hooks/src"
echo "export const a=1;" > "$d3/.claude/hooks/src/foo.ts"
git -C "$d3" add .claude/hooks/src/foo.ts
rc=$( cd "$d3" && git commit -m "src only" >/dev/null 2>&1; echo $? )
if [ "$rc" != "0" ]; then pass "installed hook blocks a src-only commit (rc=$rc)"; else fail "installed hook should block src-only commit but rc=$rc"; fi

# Case 5: existing shell hook that ends in `exit 0` -> guard inserted BEFORE it still fires.
d4="$(new_repo)"
printf '#!/bin/bash\necho "legacy"\nexit 0\n' > "$d4/.git/hooks/pre-commit"
chmod +x "$d4/.git/hooks/pre-commit"
( cd "$d4" && bash scripts/install-hooks.sh >/dev/null 2>&1 )
mkdir -p "$d4/.claude/hooks/src"
echo "export const a=1;" > "$d4/.claude/hooks/src/foo.ts"
git -C "$d4" add .claude/hooks/src/foo.ts
rc=$( cd "$d4" && git commit -m "src only" >/dev/null 2>&1; echo $? )
if [ "$rc" != "0" ] && grep -qF "legacy" "$d4/.git/hooks/pre-commit"; then
  pass "guard fires before existing early-exit hook (rc=$rc, legacy preserved)"
else
  fail "guard should fire despite existing 'exit 0' hook (rc=$rc)"
fi

# Case 6: existing NON-shell hook (python shebang) is left untouched, NOT corrupted.
d5="$(new_repo)"
printf '#!/usr/bin/env python\nprint("py-hook")\n' > "$d5/.git/hooks/pre-commit"
chmod +x "$d5/.git/hooks/pre-commit"
( cd "$d5" && bash scripts/install-hooks.sh >/dev/null 2>&1 )
if grep -qF "py-hook" "$d5/.git/hooks/pre-commit" && ! grep -qF ">>> ccv3 precommit-build-guard >>>" "$d5/.git/hooks/pre-commit"; then
  pass "non-shell pre-commit left untouched (not corrupted)"
else
  fail "non-shell pre-commit should NOT be modified"
fi

# Case 7: guard script present but NON-EXECUTABLE -> installed hook still blocks (bash invocation).
d6="$(new_repo)"
chmod -x "$d6/scripts/precommit-build-guard.sh"
( cd "$d6" && bash scripts/install-hooks.sh >/dev/null 2>&1 )
mkdir -p "$d6/.claude/hooks/src"
echo "export const a=1;" > "$d6/.claude/hooks/src/foo.ts"
git -C "$d6" add .claude/hooks/src/foo.ts
rc=$( cd "$d6" && git commit -m "src only" >/dev/null 2>&1; echo $? )
if [ "$rc" != "0" ]; then pass "non-executable guard still blocks via bash (rc=$rc)"; else fail "non-executable guard should still block (rc=$rc)"; fi

echo ""
echo "install-hooks tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
