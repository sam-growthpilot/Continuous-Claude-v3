#!/bin/bash
# audit-braintrust-emits.sh
# Purpose: Guard against agent-rewrite collisions silently dropping void emitBraintrustScore() calls.
# Usage:   bash scripts/audit-braintrust-emits.sh
# Run after any TypeScript hook edit. Exits 1 on regression (count < baseline).

# BASELINE: bump this when a legitimate new score dimension is added
# Counts both void and await emitBraintrustScore() call sites.
# Gate 0.6/0.7/0.8/0.9 fixes: all 4 emitting hooks now use await.
# Expected emit sites (do NOT lower this baseline to silence regressions):
#   memory-awareness.ts     (memory_recall_relevance)
#   telemetry-tracker.ts    (skill_trigger_accuracy)
#   ralph-task-monitor.ts   (agent_task_success)
#   hook-health-monitor.ts  (hook_health_ratio)
BASELINE=4

cd "$(dirname "$0")/.."

echo "Scanning .claude/hooks/src/ for emitBraintrustScore( call sites (void + await)..."
echo ""

matches=$(grep -rn "emitBraintrustScore(" .claude/hooks/src/ --include="*.ts" \
  | grep -v "__tests__/" \
  | grep -E "(void|await) emitBraintrustScore\(")

echo "$matches"
echo ""

count=$(echo "$matches" | grep -c "emitBraintrustScore(" 2>/dev/null || echo 0)
# Handle empty string case
if [ -z "$(echo "$matches" | tr -d '[:space:]')" ]; then
  count=0
fi

echo "Found: $count  |  Baseline: $BASELINE"

if [ "$count" -lt "$BASELINE" ]; then
  echo "FAIL: Regression detected — $count emit(s) found but baseline is $BASELINE."
  echo "An emitBraintrustScore call was likely dropped by an agent rewrite."
  echo "Check .claude/hooks/src/memory-awareness.ts first (recurring victim)."
  exit 1
elif [ "$count" -gt "$BASELINE" ]; then
  echo "WARN: $count emits found, baseline is $BASELINE. If you added a new score dimension, update BASELINE in this script."
  exit 0
else
  echo "OK: Emit count matches baseline ($BASELINE)."
  exit 0
fi
