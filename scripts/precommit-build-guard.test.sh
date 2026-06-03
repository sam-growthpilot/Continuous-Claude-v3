#!/bin/bash
# precommit-build-guard.test.sh
# TDD harness for scripts/precommit-build-guard.sh.
# Drives a throwaway git repo + index through every guard branch and asserts exit codes.
# Usage: bash scripts/precommit-build-guard.test.sh   (exit 0 = all pass)
#
# Contract under test (see scripts/precommit-build-guard.sh):
#   - staged .claude/hooks/src/**/*.ts (excl __tests__/, *.d.ts) with NO staged dist/*.mjs  -> BLOCK (exit 1)
#   - same src staged WITH >=1 staged .claude/hooks/dist/*.mjs                                -> ALLOW (exit 0)
#   - docs-only / dist-only / test-only / d.ts-only staged                                    -> ALLOW (exit 0)
#   - SKIP_BUILD_GUARD=1                                                                       -> ALLOW (exit 0)
#   - no staged files                                                                          -> ALLOW (exit 0)

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$SCRIPT_DIR/precommit-build-guard.sh"

PASS=0
FAIL=0

fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }
pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }

# Create an isolated temp git repo for each case (clean index every time).
new_repo() {
  local d
  d="$(mktemp -d 2>/dev/null || mktemp -d -t guardtest)"
  git -C "$d" init -q
  git -C "$d" config user.email "t@t.t"
  git -C "$d" config user.name "t"
  git -C "$d" config commit.gpgsign false
  mkdir -p "$d/.claude/hooks/src/shared" "$d/.claude/hooks/src/__tests__" "$d/.claude/hooks/dist"
  echo "$d"
}

# run_guard <repo-dir> [extra env assignment] -> echoes exit code
run_guard() {
  local d="$1"; shift
  ( cd "$d" && env "$@" bash "$GUARD" >/dev/null 2>&1; echo $? )
}

assert_exit() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then pass "$desc (exit $actual)"; else fail "$desc: expected exit $expected, got $actual"; fi
}

# --- Case 1: no staged files -> ALLOW
d="$(new_repo)"
assert_exit "no staged files -> allow" 0 "$(run_guard "$d")"

# --- Case 2: docs-only staged -> ALLOW
d="$(new_repo)"
echo "x" > "$d/README.md"; git -C "$d" add README.md
assert_exit "docs-only staged -> allow" 0 "$(run_guard "$d")"

# --- Case 3: src .ts WITHOUT dist -> BLOCK
d="$(new_repo)"
echo "export const a=1;" > "$d/.claude/hooks/src/foo.ts"; git -C "$d" add .claude/hooks/src/foo.ts
assert_exit "src-only (no dist) -> BLOCK" 1 "$(run_guard "$d")"

# --- Case 4: src .ts + dist .mjs -> ALLOW
d="$(new_repo)"
echo "export const a=1;" > "$d/.claude/hooks/src/foo.ts"
echo "const a=1;" > "$d/.claude/hooks/dist/foo.mjs"
git -C "$d" add .claude/hooks/src/foo.ts .claude/hooks/dist/foo.mjs
assert_exit "src + dist staged -> allow" 0 "$(run_guard "$d")"

# --- Case 5: only __tests__ ts staged (excluded) -> ALLOW
d="$(new_repo)"
echo "test('x',()=>{});" > "$d/.claude/hooks/src/__tests__/foo.test.ts"
git -C "$d" add .claude/hooks/src/__tests__/foo.test.ts
assert_exit "test-only ts staged -> allow" 0 "$(run_guard "$d")"

# --- Case 6: only *.d.ts staged (excluded) -> ALLOW
d="$(new_repo)"
echo "declare const a:number;" > "$d/.claude/hooks/src/types.d.ts"
git -C "$d" add .claude/hooks/src/types.d.ts
assert_exit "d.ts-only staged -> allow" 0 "$(run_guard "$d")"

# --- Case 7: SKIP_BUILD_GUARD=1 escapes a src-only block -> ALLOW
d="$(new_repo)"
echo "export const a=1;" > "$d/.claude/hooks/src/foo.ts"; git -C "$d" add .claude/hooks/src/foo.ts
assert_exit "SKIP_BUILD_GUARD=1 -> allow" 0 "$(run_guard "$d" SKIP_BUILD_GUARD=1)"

# --- Case 8: dist-only staged (no src) -> ALLOW
d="$(new_repo)"
echo "const a=1;" > "$d/.claude/hooks/dist/foo.mjs"; git -C "$d" add .claude/hooks/dist/foo.mjs
assert_exit "dist-only staged -> allow" 0 "$(run_guard "$d")"

# --- Case 9: nested src dir .ts without dist -> BLOCK (recursive src match)
d="$(new_repo)"
echo "export const a=1;" > "$d/.claude/hooks/src/shared/util.ts"; git -C "$d" add .claude/hooks/src/shared/util.ts
assert_exit "nested src-only (no dist) -> BLOCK" 1 "$(run_guard "$d")"

echo ""
echo "precommit-build-guard tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
