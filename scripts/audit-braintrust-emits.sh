#!/bin/bash
# audit-braintrust-emits.sh
# Purpose: Guard against agent-rewrite collisions silently dropping or reverting emitBraintrustScore() calls.
# Usage:   bash scripts/audit-braintrust-emits.sh
# Run after any TypeScript hook edit. Exits 1 on regression (count < invariant).

# ==============================================================
# INVARIANT GUARD — DO NOT MODIFY THE INVARIANT_4 LINE
# This script's only job is to catch sparks/agents silently
# dropping emitBraintrustScore() calls. If it FAILS, fix the
# code it points at — NEVER lower the invariant to silence it.
# History: invariant was lowered once (Gate 0.7+0.8, 2026-05-22)
# and immediately restored by orchestrator cleanup.
# Regression #6 (2026-05-23): all but memory-awareness reverted
# from `await` to `void` AND memory-awareness emit was deleted
# in one agent rewrite. Old grep matched both void+await and
# would have reported green on a pure await→void revert; this
# script now requires `await` prefix to catch that pattern.
# PATTERN: every emit MUST be `await emitBraintrustScore(...)`
#          on one line. Reverting to `void` or splitting across
#          lines will trip this check.
# Expected emit sites (do NOT lower this invariant to silence regressions):
#   memory-awareness.ts     (memory_recall_relevance)
#   telemetry-tracker.ts    (skill_trigger_accuracy)
#   ralph-task-monitor.ts   (agent_task_success)
#   hook-health-monitor.ts  (hook_health_ratio)
# The real guard is in .claude/agents/spark.md Rule 7 — this
# header is just for human readers reviewing the diff.
# ==============================================================
INVARIANT_4=4

cd "$(dirname "$0")/.."

# ==============================================================
# CONTEXT BUS SURFACE GUARD (WS-2 Phase A.4)
# The L2 context-bus single-writer and its foundations carry NO
# emitBraintrustScore() calls, so the emit invariant below does
# NOT protect them. This block asserts each critical module still
# exports its core surface -- a silent whole-file regen that drops
# an export (the agent-rewrite collision hazard, e.g. regression #6)
# trips this check. Do NOT weaken these assertions to silence a
# regression; fix the module the check points at.
# ==============================================================
bus_fail=0
check_bus_export() {
  # $1 = file, $2 = export pattern, $3 = human label
  if [ ! -f "$1" ]; then
    echo "FAIL: $1 is missing (expected export $3)."
    bus_fail=1
  elif ! grep -qE "$2" "$1"; then
    echo "FAIL: $1 no longer exports $3."
    bus_fail=1
  fi
}
check_bus_export ".claude/hooks/src/shared/session-bus-id.ts" "export function getBusId" "getBusId()"
check_bus_export ".claude/hooks/src/shared/context-bus.ts"    "export function readBus"   "readBus()"
check_bus_export ".claude/hooks/src/shared/context-bus.ts"    "export function mutateBus" "mutateBus()"
check_bus_export ".claude/hooks/src/shared/intel-bus.ts"      "export function appendIntelBus" "appendIntelBus()"
if [ "$bus_fail" -ne 0 ]; then
  echo "FAIL: context bus surface guard -- a core export was dropped or a file went missing."
  exit 1
fi
echo "Context bus surface guard: OK (session-bus-id, context-bus, intel-bus exports intact)."
echo ""

echo "Scanning .claude/hooks/src/ for awaited emitBraintrustScore( call sites..."
echo ""

matches=$(grep -rn "emitBraintrustScore(" .claude/hooks/src/ --include="*.ts" \
  | grep -v "__tests__/" \
  | grep -E "await emitBraintrustScore\(")

echo "$matches"
echo ""

count=$(echo "$matches" | grep -c "emitBraintrustScore(" 2>/dev/null || echo 0)
# Handle empty string case
if [ -z "$(echo "$matches" | tr -d '[:space:]')" ]; then
  count=0
fi

echo "Found: $count  |  Invariant: $INVARIANT_4"

if [ "$count" -lt "$INVARIANT_4" ]; then
  echo "FAIL: Regression detected — $count awaited emit(s) found but invariant is $INVARIANT_4."
  echo "Every emit site under .claude/hooks/src/ MUST use \`await emitBraintrustScore(...)\` on one line."
  echo "Likely cause: a recent agent edit reverted \`await\` to \`void\`, split the call across lines, or dropped a call entirely."
  echo "Inspect: git diff HEAD -- .claude/hooks/src/*.ts | grep -E '^[-+].*emitBraintrustScore'"
  echo "Check .claude/hooks/src/memory-awareness.ts first (recurring victim)."
  exit 1
elif [ "$count" -gt "$INVARIANT_4" ]; then
  echo "WARN: $count emits found, invariant is $INVARIANT_4. If you added a new score dimension, update INVARIANT_4 in this script."
  exit 0
else
  echo "OK: Emit count matches invariant ($INVARIANT_4)."
  exit 0
fi
