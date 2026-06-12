#!/usr/bin/env node
/**
 * Agent Error Capture Hook
 *
 * Captures agent (Task tool) failures as FAILED_APPROACH learnings.
 * When a Task returns with an error or indicates failure, extract context
 * and store as a learning for future sessions.
 *
 * Hook: PostToolUse:Task
 *
 * Error detection patterns:
 * - tool_response contains "error", "failed", "exception"
 * - tool_response contains stack traces
 * - agent returned with explicit failure indicators
 *
 * Stores:
 * - Agent type that failed
 * - Task prompt that was given
 * - Error message/output
 * - Context for future avoidance
 */

import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { scoreExtraction } from './shared/memory-quality-scorer.js';

interface PostToolUseInput {
  session_id: string;
  tool_name: string;
  tool_input: {
    subagent_type?: string;
    prompt?: string;
    description?: string;
  };
  tool_response: unknown;
}

// Error patterns to detect failures
const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bexception\b/i,
  /\bfailure\b/i,
  /\bcrashed?\b/i,
  /\btimeout\b/i,
  /\bTraceback\s+\(most recent/i,  // Python stack trace
  /\bat\s+\S+\s+\(\S+:\d+:\d+\)/,   // JS stack trace
  /\bpanic:/i,                       // Go panic
  /\bRuntimeError\b/i,
  /\bTypeError\b/i,
  /\bSyntaxError\b/i,
  /\bImportError\b/i,
  /\bModuleNotFoundError\b/i,
  /\bConnectionRefused\b/i,
  /\bENOENT\b/i,
  /\bEPERM\b/i,
  /\bEACCES\b/i,
];

// Patterns that indicate agent explicitly reported failure
const FAILURE_INDICATORS = [
  /\bcould not\b/i,
  /\bunable to\b/i,
  /\bI couldn't\b/i,
  /\bI was unable\b/i,
  /\bI failed to\b/i,
  /\bwas not able to\b/i,
  /\bdidn't work\b/i,
  /\bdoesn't work\b/i,
];

function readStdin(): string {
  return readFileSync(0, 'utf-8');
}

function outputContinue(): void {
  console.log(JSON.stringify({}));
}

function getOpcDir(): string {
  return process.env.CLAUDE_OPC_DIR || join(process.env.HOME || process.env.USERPROFILE || '', 'continuous-claude', 'opc');
}

function responseToString(response: unknown): string {
  if (typeof response === 'string') return response;
  if (response === null || response === undefined) return '';
  try {
    return JSON.stringify(response, null, 2);
  } catch {
    return String(response);
  }
}

function hasErrorPattern(text: string): boolean {
  return ERROR_PATTERNS.some(p => p.test(text));
}

function hasFailureIndicator(text: string): boolean {
  return FAILURE_INDICATORS.some(p => p.test(text));
}

function extractErrorContext(response: string, maxLen = 500): string {
  // Try to extract the most relevant error portion
  const lines = response.split('\n');

  // Look for lines with error patterns
  const errorLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ERROR_PATTERNS.some(p => p.test(line))) {
      // Include context: 2 lines before and 3 lines after
      const start = Math.max(0, i - 2);
      const end = Math.min(lines.length, i + 4);
      errorLines.push(...lines.slice(start, end));
      break;
    }
  }

  if (errorLines.length > 0) {
    return errorLines.join('\n').substring(0, maxLen);
  }

  // If no specific error found, return beginning and end
  if (response.length <= maxLen) return response;
  return response.substring(0, maxLen / 2) + '\n...\n' + response.substring(response.length - maxLen / 2);
}

export function storeLearning(
  sessionId: string,
  agentType: string,
  prompt: string,
  errorContext: string
): void {
  const opcDir = getOpcDir();
  const storeScript = join(opcDir, 'scripts', 'core', 'store_learning.py');

  if (!existsSync(storeScript)) {
    console.error('[AgentErrorCapture] store_learning.py not found');
    return;
  }

  // Build content for the learning
  const content = `Agent '${agentType}' error: ${errorContext}`;

  // G3 / Task #6: gate the store with the TypeScript memory-quality-scorer
  // BEFORE shelling out to Python. Previously this hook bypassed the scorer
  // entirely; any "Agent 'foo' error: ..." dump would land in archival_memory
  // regardless of signal density. Now we only proceed for SIGNAL (>=5) or
  // BORDERLINE (3-4); NOISE (<3) is dropped with a stderr log for visibility.
  const score = scoreExtraction(content, `Failed agent invocation: ${agentType}`);
  if (score.classification === 'NOISE') {
    console.error(
      `[AgentErrorCapture] Skipped NOISE (score=${score.score}) for agent '${agentType}': ` +
      score.reasons.join('; ')
    );
    return;
  }

  // Build tags
  const tags = [
    'auto_captured',
    'agent_failure',
    `agent:${agentType}`,
    'scope:global',
    `quality:${score.classification.toLowerCase()}`,
    `score:${score.score}`,
  ];

  try {
    // QW-01: spawn with no shell — pass each argument as a separate argv element.
    // The raw content is handed to Python verbatim (no shell = no injection),
    // so the previous sh-style double-quote escaping is removed entirely.
    const contextStr = `Failed agent invocation: ${agentType}`;
    const tagsStr = tags.join(',');

    spawnSync(
      'uv',
      [
        'run', 'python', 'scripts/core/store_learning.py',
        '--session-id', sessionId,
        '--type', 'FAILED_APPROACH',
        '--content', content,
        '--context', contextStr,
        '--tags', tagsStr,
        '--confidence', 'medium',
      ],
      { cwd: opcDir, shell: false, encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    console.error(`[AgentErrorCapture] Stored failure learning for agent '${agentType}'`);
  } catch (err) {
    console.error(`[AgentErrorCapture] Failed to store learning: ${err}`);
  }
}

async function main() {
  try {
    const rawInput = readStdin();
    if (!rawInput.trim()) {
      outputContinue();
      return;
    }

    let input: PostToolUseInput;
    try {
      input = JSON.parse(rawInput);
    } catch {
      outputContinue();
      return;
    }

    // Only process Agent/Task tool results
    if (input.tool_name !== 'Agent' && input.tool_name !== 'Task') {
      outputContinue();
      return;
    }

    const agentType = input.tool_input.subagent_type || 'unknown';
    const prompt = input.tool_input.prompt || input.tool_input.description || '';
    const responseStr = responseToString(input.tool_response);

    // Check if response indicates failure
    const hasError = hasErrorPattern(responseStr);
    const hasFailure = hasFailureIndicator(responseStr);

    if (hasError) {
      // Only store on actual error patterns (TypeError, ENOENT, etc.)
      // Soft failure language ("could not", "unable to") is not worth storing
      const errorContext = extractErrorContext(responseStr);

      console.error(`[AgentErrorCapture] Detected error in ${agentType} agent response`);

      // Store the learning
      storeLearning(
        input.session_id,
        agentType,
        prompt,
        errorContext
      );
    }

    outputContinue();

  } catch (err) {
    // Fail silently - don't disrupt the session
    console.error(`[AgentErrorCapture] Hook error: ${err}`);
    outputContinue();
  }
}

// Only auto-run when invoked directly as a hook (not when imported by tests).
// process.argv[1] is the bundled dist filename when Claude Code runs the hook.
if (process.argv[1] && process.argv[1].includes('agent-error-capture')) {
  main();
}
