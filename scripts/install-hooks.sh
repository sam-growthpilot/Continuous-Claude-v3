#!/bin/bash
# install-hooks.sh
# Idempotent installer for this repo's git hooks. Tracked + re-runnable so a teammate,
# CI, or a `git clean -fd` can always restore the hooks (.git/hooks/ is NOT tracked, and
# the setup wizard is one-shot). Safe to run any number of times.
#
# Installs:
#   1. post-commit  -> auto-sync repo -> ~/.claude (copied from scripts/post-commit-hook.sh)
#   2. pre-commit   -> runs scripts/precommit-build-guard.sh (build-forget staleness guard)
#
# Idempotent + non-clobbering:
#   - post-commit: installed only if absent (never overwrites a customized one).
#   - pre-commit:  if absent, created fresh; if present WITHOUT our marker it is chained by
#                  INSERTING the guard right after the shebang (so an existing hook that ends
#                  in `exit 0` cannot silence the guard); if our marker is already present it
#                  is left untouched. A non-shell existing hook is NOT modified (warn instead),
#                  to avoid corrupting a python/ruby/etc. hook.
#
# Robustness notes (from cross-model review):
#   - The generated hook invokes the guard via `bash <script>` and tests `-f` (not `-x`): a
#     clean clone may leave the guard non-executable, and `bash <script>` ignores the script's
#     own (possibly CRLF) shebang. `.gitattributes` pins `*.sh eol=lf` as belt-and-suspenders.
#   - Idempotency keys on MARKER_END (written last) so an interrupted prior run is repaired.
#
# Usage: bash scripts/install-hooks.sh

set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$ROOT" ] || [ ! -d "$ROOT/.git" ]; then
  echo "install-hooks: not a git work tree (skipped)"
  exit 0
fi

HOOKS_DIR="$ROOT/.git/hooks"
mkdir -p "$HOOKS_DIR"

MARKER_START="# >>> ccv3 precommit-build-guard >>>"
MARKER_END="# <<< ccv3 precommit-build-guard <<<"

RC=0

# --- 1. post-commit (auto-sync) -----------------------------------------------
POST_SRC="$ROOT/scripts/post-commit-hook.sh"
POST_DST="$HOOKS_DIR/post-commit"
if [ -f "$POST_DST" ]; then
  echo "install-hooks: post-commit already present (skipped)"
elif [ ! -f "$POST_SRC" ]; then
  echo "install-hooks: WARN source $POST_SRC missing -- post-commit not installed"
  RC=1
else
  if cp "$POST_SRC" "$POST_DST" && chmod +x "$POST_DST"; then
    echo "install-hooks: installed post-commit"
  else
    echo "install-hooks: WARN could not install post-commit"
    RC=1
  fi
fi

# --- 2. pre-commit (build-forget guard) ---------------------------------------
PRE_DST="$HOOKS_DIR/pre-commit"

# Guard block. Invokes via `bash` + `-f` so it survives a non-executable / CRLF-shebang
# checkout, and resolves the repo root at hook runtime so it survives a moved checkout.
guard_block() {
  printf '%s\n' "$MARKER_START"
  printf '%s\n' 'CCV3_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"'
  printf '%s\n' 'if [ -n "$CCV3_ROOT" ] && [ -f "$CCV3_ROOT/scripts/precommit-build-guard.sh" ]; then'
  printf '%s\n' '  bash "$CCV3_ROOT/scripts/precommit-build-guard.sh" || exit $?'
  printf '%s\n' 'fi'
  printf '%s\n' "$MARKER_END"
}

write_atomic() {  # write_atomic <dest>  (reads body from stdin)
  local dest="$1" tmp="$1.ccv3.$$"
  if cat > "$tmp" && chmod +x "$tmp" && mv "$tmp" "$dest"; then
    return 0
  fi
  rm -f "$tmp" 2>/dev/null
  return 1
}

if [ ! -f "$PRE_DST" ]; then
  if { printf '%s\n' '#!/bin/bash'; printf '%s\n' '# Auto-installed by scripts/install-hooks.sh'; guard_block; } | write_atomic "$PRE_DST"; then
    echo "install-hooks: created pre-commit with build-forget guard"
  else
    echo "install-hooks: WARN could not create pre-commit"
    RC=1
  fi
elif grep -qF "$MARKER_END" "$PRE_DST" 2>/dev/null; then
  echo "install-hooks: pre-commit guard already present (skipped)"
else
  # Existing hook without a complete marker. Chain only if it is a POSIX shell hook;
  # insert AFTER the shebang so an early `exit 0` in the existing body cannot skip the guard.
  first_line="$(head -1 "$PRE_DST" 2>/dev/null)"
  # Treat as a shell hook only if the shebang invokes sh or bash (matches `#!/bin/sh`,
  # `#!/bin/bash`, `#!/usr/bin/env bash`, etc.). Anything else (python/ruby/no shebang)
  # is left untouched to avoid corruption.
  if printf '%s' "$first_line" | grep -qE '^#!.*(ba)?sh\b'; then
    if { printf '%s\n' "$first_line"; guard_block; tail -n +2 "$PRE_DST"; } | write_atomic "$PRE_DST"; then
      echo "install-hooks: chained build-forget guard into existing shell pre-commit (runs first)"
    else
      echo "install-hooks: WARN could not chain guard into existing pre-commit"
      RC=1
    fi
  else
    echo "install-hooks: WARN existing pre-commit is non-shell or has no shebang -- NOT modified."
    echo "install-hooks:      Add the guard manually: bash \"\$(git rev-parse --show-toplevel)/scripts/precommit-build-guard.sh\""
    RC=1
  fi
fi

echo "install-hooks: done"
exit $RC
