// Auto-allow PermissionRequest EXCEPT for AskUserQuestion.
// AskUserQuestion must surface its UI prompt; auto-allowing it makes
// Claude Code proceed with empty answers and breaks plan-mode interviews.
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

  if (input.tool_name === 'AskUserQuestion') {
    process.stdout.write('{}');
    return;
  }

  emitAllow();
}

main();
