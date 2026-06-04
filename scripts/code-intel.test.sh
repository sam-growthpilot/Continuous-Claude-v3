#!/bin/bash
# code-intel.test.sh
# Deterministic tests for scripts/code-intel.mjs (routing, JSON shape, clarify, bus discovery,
# CCV3_BUS_OFF, telemetry append, --bus sanitization). Avoids Docker -- does NOT assert recall
# RESULTS (memory backend may be down); it asserts ROUTING fields, which are deterministic.
# Usage: bash scripts/code-intel.test.sh   (exit 0 = all pass)
#
# NOTE (cross-model review F3): assertions capture CLI output into a variable and feed it to
# node via a HERESTRING -- NOT `node ... | assert`. A pipe would run the assert in a subshell,
# so PASS/FAIL increments (and thus the exit code) would be lost. Keep the herestring form.

set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/code-intel.mjs"

PASS=0; FAIL=0
pass() { echo "  [PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL + 1)); }

# assert <desc> <node-bool-expr-over-d> <json-string>   (runs in the MAIN shell)
assert() {
  local desc="$1" expr="$2" json="$3"
  if node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.exit(($expr)?0:1)" <<<"$json"; then
    pass "$desc"
  else
    fail "$desc"
  fi
}

echo "== help / clarify =="
assert "help -> success + commands map"        "d.success===true && d.commands && d.commands.help" "$(node "$CLI" help)"
assert "no subcommand -> help"                 "d.commands && d.backend==='facade'"                 "$(node "$CLI")"
assert "unknown -> clarify + supported list"   "d.success===false && d.clarify===true && Array.isArray(d.supported) && d.supported.length>0" "$(node "$CLI" bogus-cmd)"
assert "flow missing args -> clarify"          "d.clarify===true"                                   "$(node "$CLI" flow)"
assert "who-calls missing args -> clarify"     "d.clarify===true"                                   "$(node "$CLI" who-calls)"

echo "== routing fields (deterministic regardless of backend success) =="
assert "who-calls -> tldr, escalated_from codegraph"               "d.backend==='tldr' && d.escalated_from==='codegraph'" "$(node "$CLI" who-calls someFn)"
assert "find-symbol -> tldr, escalated_from codegraph, names Serena" "d.backend==='tldr' && d.escalated_from==='codegraph' && /Serena/i.test(d.routing_reason)" "$(node "$CLI" find-symbol Foo)"
assert "rename-preview -> ast-grep guidance (no crash)"            "d.success===true && d.backend==='ast-grep' && d.result && typeof d.result.guidance==='string'" "$(node "$CLI" rename-preview 'a' 'b')"
# Single-quote escaping: a pattern with a ' must NOT produce the naive broken `'it's'`.
QUOTE_PATTERN="it's"
QUOTE_JSON="$(node "$CLI" rename-preview "$QUOTE_PATTERN" b)"
if node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.exit(d.result.guidance.indexOf(\"'it's'\")<0?0:1)" <<<"$QUOTE_JSON"; then
  pass "rename-preview escapes single quotes in guidance (no broken 'it's')"
else
  fail "rename-preview escapes single quotes in guidance"
fi

echo "== bus discovery + kill switch + --bus sanitization =="
assert "bus -> context-bus backend, discovery present" "d.backend==='context-bus' && typeof d.discovery==='string'" "$(node "$CLI" bus)"
assert "CCV3_BUS_OFF=1 -> discovery bus-off"           "d.discovery==='bus-off'"                                     "$(CCV3_BUS_OFF=1 node "$CLI" bus)"
assert "--bus traversal sanitized (no path escape)"    "d.discovery==='arg' && d.bus_id.indexOf('/')<0 && d.bus_id.indexOf('..')<0" "$(node "$CLI" bus --bus '../../etc/passwd')"

echo "== telemetry append (isolated temp project) =="
TMP="$(mktemp -d 2>/dev/null || mktemp -d -t citest)"
CLAUDE_PROJECT_DIR="$TMP" node "$CLI" rename-preview 'x' 'y' >/dev/null 2>&1
if CLAUDE_PROJECT_DIR="$TMP" node -e '
  const {join}=require("path"),fs=require("fs");
  const p=join(process.env.CLAUDE_PROJECT_DIR,".claude","logs","intel-bus.jsonl");
  if(!fs.existsSync(p))process.exit(1);
  const l=fs.readFileSync(p,"utf8").trim().split("\n");
  const e=JSON.parse(l[l.length-1]);
  // contract: facade + specialist + correlation_id + schema_version, and NO raw subject_id
  process.exit(e.facade==="/code-intel"&&e.specialist==="ast-grep"&&typeof e.correlation_id==="string"&&e.schema_version===1&&!("subject_id" in e)?0:1)
'; then
  pass "telemetry row appended (allowlisted fields, no subject_id)"
else
  fail "telemetry row appended"
fi

TMP2="$(mktemp -d 2>/dev/null || mktemp -d -t citest)"
CLAUDE_PROJECT_DIR="$TMP2" CCV3_BUS_OFF=1 node "$CLI" rename-preview 'x' 'y' >/dev/null 2>&1
if CLAUDE_PROJECT_DIR="$TMP2" node -e '
  const {join}=require("path"),fs=require("fs");
  const p=join(process.env.CLAUDE_PROJECT_DIR,".claude","logs","intel-bus.jsonl");
  process.exit(fs.existsSync(p)?1:0)
'; then
  pass "CCV3_BUS_OFF suppresses telemetry append"
else
  fail "CCV3_BUS_OFF suppresses telemetry append"
fi

echo ""
echo "code-intel tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
