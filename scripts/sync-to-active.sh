#!/usr/bin/env bash
# Sync continuous-claude/.claude/ → ~/.claude/ (forward sync)
# Run after git pull or local edits in continuous-claude

set -e

SCRIPT_DIR="$( cd "$( dirname "$0" )" && pwd )"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
REPO_CLAUDE="$REPO_ROOT/.claude"
ACTIVE_CLAUDE="$HOME/.claude"

DRY_RUN=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=true; shift ;;
        --verbose) VERBOSE=true; shift ;;
        --skip-build) shift ;;
        --help|-h)
            echo "Usage: $0 [--dry-run] [--verbose] [--skip-build]"
            echo ""
            echo "Syncs continuous-claude/.claude/ → ~/.claude/"
            echo ""
            echo "Options:"
            echo "  --dry-run     Show what would be copied without copying"
            echo "  --verbose     Show detailed progress"
            echo "  --skip-build  Accepted for back-compat; no-op (build step was removed)"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

$VERBOSE && echo "Syncing: $REPO_CLAUDE → $ACTIVE_CLAUDE" || true

# hooks/src excluded: dist/*.mjs is what runs; copying src stomps mtimes and breaks hook-dist-freshness.
SYNC_DIRS="rules agents skills scripts docs"

NEVER_SYNC="CLAUDE.md RULES.md .env .credentials.json settings.json history.jsonl knowledge-tree.json"

copy_dir() {
    local dir="$1"
    local src_path="$REPO_CLAUDE/$dir"
    local dst_path="$ACTIVE_CLAUDE/$dir"

    [[ ! -d "$src_path" ]] && return 0

    $DRY_RUN || mkdir -p "$dst_path"

    while IFS= read -r src_file; do
        local rel="${src_file#$src_path/}"
        local dst_file="$dst_path/$rel"

        local base=$(basename "$src_file")
        local skip_file=false
        for skip in $NEVER_SYNC; do
            [[ "$base" == "$skip" ]] && skip_file=true && break
        done
        $skip_file && continue

        if $DRY_RUN; then
            echo "[DRY RUN] Would copy: $src_file -> $dst_file"
        else
            mkdir -p "$(dirname "$dst_file")"
            cp "$src_file" "$dst_file"
            $VERBOSE && echo "Copied: $dir/$rel" || true
        fi
    done < <(find "$src_path" -type f ! -name "*.pid" ! -name "*.lock" ! -path "*/.tldr/*" ! -path "*/node_modules/*" ! -path "*/cache/*" ! -path "*/dist/*" 2>/dev/null)
}

# Regenerate .json sidecars from .md frontmatter before copying agents.
# This ensures any .md edits are reflected in the .json files that claude_spawn.py reads.
SYNC_AGENT_JSON="$SCRIPT_DIR/sync-agent-json.py"
if [[ -f "$SYNC_AGENT_JSON" ]]; then
    if $DRY_RUN; then
        echo "[DRY RUN] Would regenerate agent .json sidecars from .md frontmatter"
    else
        $VERBOSE && echo "Regenerating agent .json sidecars..." || true
        python "$SYNC_AGENT_JSON" --target "$REPO_CLAUDE/agents" --apply \
            $( $VERBOSE && echo "--verbose" || true ) 2>&1 \
            | python -c "import json,sys; d=json.load(sys.stdin); print(f'  agent-json-sync: {d[\"summary\"][\"updated\"]} updated, {d[\"summary\"][\"no_change\"]} unchanged')" \
            || echo "  Warning: agent .json sidecar sync failed (non-fatal)"
    fi
fi

for dir in $SYNC_DIRS; do
    copy_dir "$dir"
done

# Sync top-level .claude/*.md files (canonical entry points / redirect stubs)
# mkdir -p the target root first -- a fresh-install machine may not have ~/.claude/
# yet, and `cp file dir/` requires the dir to exist.
$DRY_RUN || mkdir -p "$ACTIVE_CLAUDE"
for src_file in "$REPO_CLAUDE"/*.md; do
    [[ ! -f "$src_file" ]] && continue
    base=$(basename "$src_file")
    skip_file=false
    for skip in $NEVER_SYNC; do
        [[ "$base" == "$skip" ]] && skip_file=true && break
    done
    $skip_file && continue
    dst_file="$ACTIVE_CLAUDE/$base"
    if $DRY_RUN; then
        echo "[DRY RUN] Would copy: $src_file -> $dst_file"
    else
        cp "$src_file" "$dst_file"
        $VERBOSE && echo "Copied: $base" || true
    fi
done

for pattern in "hooks/*.sh" "hooks/*.py" "hooks/*.mjs" "hooks/*.ps1" "hooks/package.json" "hooks/tsconfig.json"; do
    for src_file in $REPO_CLAUDE/$pattern; do
        [[ ! -f "$src_file" ]] && continue
        rel="${src_file#$REPO_CLAUDE/}"
        dst_file="$ACTIVE_CLAUDE/$rel"

        if $DRY_RUN; then
            echo "[DRY RUN] Would copy: $src_file -> $dst_file"
        else
            mkdir -p "$(dirname "$dst_file")"
            cp "$src_file" "$dst_file"
            $VERBOSE && echo "Copied: $rel" || true
        fi
    done
done

# Sync hooks/dist/*.mjs (built hook bundles)
DIST_SRC="$REPO_CLAUDE/hooks/dist"
DIST_DST="$ACTIVE_CLAUDE/hooks/dist"
if [[ -d "$DIST_SRC" ]]; then
    $DRY_RUN || mkdir -p "$DIST_DST"
    for src_file in "$DIST_SRC"/*.mjs; do
        [[ ! -f "$src_file" ]] && continue
        local_name=$(basename "$src_file")
        dst_file="$DIST_DST/$local_name"
        if $DRY_RUN; then
            echo "[DRY RUN] Would copy: $src_file -> $dst_file"
        else
            cp "$src_file" "$dst_file"
            $VERBOSE && echo "Copied: hooks/dist/$local_name" || true
        fi
    done
fi

# Sync templates/ralph/ (prompt templates for Ralph agents)
TEMPLATES_SRC="$REPO_CLAUDE/templates/ralph"
TEMPLATES_DST="$ACTIVE_CLAUDE/templates/ralph"
if [[ -d "$TEMPLATES_SRC" ]]; then
    $DRY_RUN || mkdir -p "$TEMPLATES_DST"
    for src_file in "$TEMPLATES_SRC"/*; do
        [[ ! -f "$src_file" ]] && continue
        local_name=$(basename "$src_file")
        dst_file="$TEMPLATES_DST/$local_name"
        if $DRY_RUN; then
            echo "[DRY RUN] Would copy: $src_file -> $dst_file"
        else
            cp "$src_file" "$dst_file"
            $VERBOSE && echo "Copied: templates/ralph/$local_name" || true
        fi
    done
fi

# Sync opc/scripts/core/project_memory.py → scripts/core/ (needed by memory-awareness.ts)
CORE_SRC="$REPO_ROOT/opc/scripts/core/project_memory.py"
CORE_DST="$ACTIVE_CLAUDE/scripts/core/project_memory.py"
if [[ -f "$CORE_SRC" ]]; then
    $DRY_RUN || mkdir -p "$(dirname "$CORE_DST")"
    if $DRY_RUN; then
        echo "[DRY RUN] Would copy: $CORE_SRC -> $CORE_DST"
    else
        cp "$CORE_SRC" "$CORE_DST"
        $VERBOSE && echo "Copied: opc/scripts/core/project_memory.py -> scripts/core/project_memory.py" || true
    fi
fi

# Sync scripts/ralph/*.py (create target directory if needed for fresh installs)
RALPH_SRC="$REPO_CLAUDE/scripts/ralph"
RALPH_DST="$ACTIVE_CLAUDE/scripts/ralph"
if [[ -d "$RALPH_SRC" ]]; then
    $DRY_RUN || mkdir -p "$RALPH_DST"
    for src_file in "$RALPH_SRC"/*.py; do
        [[ ! -f "$src_file" ]] && continue
        local_name=$(basename "$src_file")
        dst_file="$RALPH_DST/$local_name"
        if $DRY_RUN; then
            echo "[DRY RUN] Would copy: $src_file -> $dst_file"
        else
            cp "$src_file" "$dst_file"
            $VERBOSE && echo "Copied: scripts/ralph/$local_name" || true
        fi
    done
fi

# Build step removed (CCv3 WS-0.3 structural fix): dist is pre-built in the repo and copied to active by the hooks/dist block above. No build-from-active-src.

# Merge mcpServers from repo settings.json into active settings.json
# This preserves machine-specific settings while syncing MCP server config
if ! $DRY_RUN && command -v jq &> /dev/null; then
    REPO_SETTINGS="$REPO_CLAUDE/settings.json"
    ACTIVE_SETTINGS="$ACTIVE_CLAUDE/settings.json"

    if [[ -f "$REPO_SETTINGS" && -f "$ACTIVE_SETTINGS" ]]; then
        # Extract mcpServers from repo and merge into active.
        # Both jq calls run under `set -e`, so a malformed JSON file would
        # abort the entire sync before reaching the cleanup paths below.
        # The `|| MCP_SERVERS=""` and `if jq ...; then` forms keep set -e
        # from killing the script on a non-zero jq exit -- we want a
        # graceful skip instead.
        MCP_SERVERS=$(jq '.mcpServers // empty' "$REPO_SETTINGS" 2>/dev/null) || MCP_SERVERS=""
        if [[ -n "$MCP_SERVERS" && "$MCP_SERVERS" != "null" ]]; then
            # Create temp file with merged content
            TEMP_SETTINGS=$(mktemp)
            if jq --argjson mcp "$MCP_SERVERS" '.mcpServers = $mcp' "$ACTIVE_SETTINGS" > "$TEMP_SETTINGS" 2>/dev/null && [[ -s "$TEMP_SETTINGS" ]]; then
                mv "$TEMP_SETTINGS" "$ACTIVE_SETTINGS"
                $VERBOSE && echo "Merged mcpServers into ~/.claude/settings.json" || true
            else
                rm -f "$TEMP_SETTINGS"
                $VERBOSE && echo "Warning: Failed to merge mcpServers" || true
            fi
        fi
    fi
elif ! $DRY_RUN; then
    $VERBOSE && echo "Note: jq not installed, skipping mcpServers merge" || true
fi

# Verification: compare file counts between source and target
if ! $DRY_RUN; then
    VERIFY_FAIL=0
    echo "Verification:"

    verify_dir() {
        local label="$1" src_dir="$2" dst_dir="$3" pattern="$4"
        if [[ ! -d "$src_dir" ]]; then
            return 0
        fi
        if [[ ! -d "$dst_dir" ]]; then
            echo "  $label: SKIPPED (target dir absent)"
            return 0
        fi
        local src_count dst_count
        if [[ -n "$pattern" ]]; then
            src_count=$(find "$src_dir" -maxdepth 1 -name "$pattern" -type f 2>/dev/null | wc -l)
            dst_count=$(find "$dst_dir" -maxdepth 1 -name "$pattern" -type f 2>/dev/null | wc -l)
        else
            src_count=$(find "$src_dir" -type f ! -name "*.pid" ! -name "*.lock" ! -path "*/.tldr/*" ! -path "*/node_modules/*" ! -path "*/cache/*" ! -path "*/dist/*" 2>/dev/null | wc -l)
            dst_count=$(find "$dst_dir" -type f ! -name "*.pid" ! -name "*.lock" ! -path "*/.tldr/*" ! -path "*/node_modules/*" ! -path "*/cache/*" ! -path "*/dist/*" 2>/dev/null | wc -l)
        fi
        src_count=$(echo "$src_count" | tr -d ' ')
        dst_count=$(echo "$dst_count" | tr -d ' ')
        if [[ "$src_count" -eq "$dst_count" ]]; then
            echo "  $label: OK ($src_count files)"
        else
            echo "  $label: MISMATCH (source=$src_count, target=$dst_count)"
            VERIFY_FAIL=1
        fi
    }

    for dir in $SYNC_DIRS; do
        verify_dir "$dir" "$REPO_CLAUDE/$dir" "$ACTIVE_CLAUDE/$dir"
    done
    verify_dir "hooks/dist (*.mjs)" "$REPO_CLAUDE/hooks/dist" "$ACTIVE_CLAUDE/hooks/dist" "*.mjs"
    verify_dir "scripts/ralph (*.py)" "$REPO_CLAUDE/scripts/ralph" "$ACTIVE_CLAUDE/scripts/ralph" "*.py"
    verify_dir "templates/ralph" "$REPO_CLAUDE/templates/ralph" "$ACTIVE_CLAUDE/templates/ralph"

    if [[ "$VERIFY_FAIL" -eq 1 ]]; then
        echo "  WARNING: Some directories have file count mismatches"
    fi
fi

$VERBOSE && echo "Sync complete: continuous-claude -> ~/.claude" || true
