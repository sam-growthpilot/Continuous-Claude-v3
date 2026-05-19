// Auto-allow PermissionRequest EXCEPT for AskUserQuestion and ExitPlanMode.
// - AskUserQuestion must surface its UI prompt; auto-allowing it makes
//   Claude Code proceed with empty answers and breaks plan-mode interviews.
// - ExitPlanMode must surface its UI prompt so the user actually approves
//   the proposed plan before execution begins. The plan-mode-approval-gate
//   PreToolUse hook also gates this in bypass-permissions mode (where
//   PermissionRequest hooks don't fire); this exclusion is the
//   belt-and-suspenders for normal mode.
// Everything else is auto-allowed to preserve the .claude/ sensitive-file
// workaround (added 2026-03-28 for Claude Code v2.1.78+).

import { readFileSync } from 'node:fs';

interface PermissionRequestInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

function emitAllow(): void {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: { behavior: 'allow' },
    },
  }));
}

function main(): void {
  let input: PermissionRequestInput = {};
  try {
    const raw = readFileSync(0, 'utf8');
    input = raw ? JSON.parse(raw) : {};
  } catch {
    emitAllow();
    return;
  }

  if (input.tool_name === 'AskUserQuestion' || input.tool_name === 'ExitPlanMode') {
    process.stdout.write('{}');
    return;
  }

  emitAllow();
}

main();
