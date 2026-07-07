#!/usr/bin/env node

// src/no-haiku-enforcer.ts
async function main() {
  let input = {};
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  try {
    const rawInput = Buffer.concat(chunks).toString("utf-8").trim();
    if (rawInput) {
      input = JSON.parse(rawInput);
    }
  } catch {
    console.log("{}");
    return;
  }
  const tool = input.tool || input.tool_name;
  const model = input.tool_input?.model;
  const isSpawn = tool === "Agent" || tool === "Task";
  const flatten = process.env.CLAUDE_CODE_SUBAGENT_MODEL;
  if (isSpawn && flatten) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `BLOCKED: CLAUDE_CODE_SUBAGENT_MODEL is set (="${flatten}").

It overrides every agent's frontmatter and FLATTENS the two-tier model map to one model.
Unset it (it must never be set) \u2014 see ~/.claude/rules/agent-model-selection.md.`
      }
    }));
    return;
  }
  if (!isSpawn || model?.toLowerCase() !== "haiku") {
    console.log("{}");
    return;
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `BLOCKED: model='haiku' not allowed.

Per ~/.claude/rules/no-haiku.md:
- Haiku is unreliable for agent tasks
- Use model='sonnet' (or model='opus' for judgment-dense work)
- Or omit the model parameter for a genuinely ad-hoc chat-level call`
    }
  };
  console.log(JSON.stringify(output));
}
main().catch(() => {
  console.log("{}");
});
