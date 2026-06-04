#!/usr/bin/env node

// src/code-intel-enforcer.ts
function facadeMode() {
  const raw = (process.env.CCV3_FACADE_MODE || "").trim().toLowerCase();
  return raw === "warn" ? "warn" : "off";
}
function grepSymbolTarget(pattern) {
  if (!pattern || typeof pattern !== "string") return null;
  const m = pattern.match(/\b(?:function|def|class)\s+([A-Za-z_]\w*)/);
  return m ? m[1] : null;
}
function noop() {
  return {};
}
function nudge(message) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: message
    }
  };
}
function evaluate(input) {
  if (facadeMode() === "off") return noop();
  const tool = input.tool || input.tool_name;
  if (tool === "Grep") {
    const sym = grepSymbolTarget(input.tool_input?.pattern);
    if (sym) {
      return nudge(
        `[code-intel] This looks like a symbol-definition search for '${sym}'. Consider \`node scripts/code-intel.mjs find-symbol ${sym}\` (broad, FTS-first; escalate to Serena find_symbol for precise identity). This is a non-blocking suggestion.`
      );
    }
    return noop();
  }
  return noop();
}
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  let input = {};
  try {
    const raw = Buffer.concat(chunks).toString("utf-8").trim();
    if (raw) input = JSON.parse(raw);
  } catch {
    console.log("{}");
    return;
  }
  try {
    console.log(JSON.stringify(evaluate(input)));
  } catch {
    console.log("{}");
  }
}
if (process.argv[1] && process.argv[1].includes("code-intel-enforcer")) {
  main().catch(() => console.log("{}"));
}
export {
  evaluate
};
