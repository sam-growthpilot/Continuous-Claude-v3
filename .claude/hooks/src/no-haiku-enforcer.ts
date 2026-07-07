#!/usr/bin/env node
/**
 * Model-Policy Enforcer Hook - PreToolUse (Agent|Task)
 *
 * (1) Blocks Task/Agent calls with model="haiku" (~/.claude/rules/no-haiku.md).
 * (2) Standing guard: denies all spawns if CLAUDE_CODE_SUBAGENT_MODEL is set — it
 *     overrides every agent's frontmatter and flattens the two-tier map to one model
 *     (~/.claude/rules/agent-model-selection.md).
 *
 * Fix (haiku): use model="sonnet", or omit it for an ad-hoc chat-level call.
 */

interface HookInput {
  tool?: string;
  tool_name?: string;
  tool_input?: {
    model?: string;
    [key: string]: unknown;
  };
}

interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
  };
}

async function main(): Promise<void> {
  let input: HookInput = {};

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  try {
    const rawInput = Buffer.concat(chunks).toString('utf-8').trim();
    if (rawInput) {
      input = JSON.parse(rawInput);
    }
  } catch {
    console.log('{}');
    return;
  }

  const tool = input.tool || input.tool_name;
  const model = input.tool_input?.model;
  const isSpawn = tool === 'Agent' || tool === 'Task';

  // Standing guard (E4): CLAUDE_CODE_SUBAGENT_MODEL overrides every agent's frontmatter
  // and flattens the two-tier map to one model. It must never be set.
  const flatten = process.env.CLAUDE_CODE_SUBAGENT_MODEL;
  if (isSpawn && flatten) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `BLOCKED: CLAUDE_CODE_SUBAGENT_MODEL is set (="${flatten}").

It overrides every agent's frontmatter and FLATTENS the two-tier model map to one model.
Unset it (it must never be set) — see ~/.claude/rules/agent-model-selection.md.`,
      },
    }));
    return;
  }

  // Only block Agent/Task with model="haiku"
  if (!isSpawn || model?.toLowerCase() !== 'haiku') {
    console.log('{}');
    return;
  }

  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `BLOCKED: model='haiku' not allowed.

Per ~/.claude/rules/no-haiku.md:
- Haiku is unreliable for agent tasks
- Use model='sonnet' (or model='opus' for judgment-dense work)
- Or omit the model parameter for a genuinely ad-hoc chat-level call`,
    },
  };

  console.log(JSON.stringify(output));
}

main().catch(() => {
  console.log('{}');
});
