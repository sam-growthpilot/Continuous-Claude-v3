#!/usr/bin/env node
/**
 * ROADMAP Completion Hook
 *
 * Automatically updates ROADMAP.md when:
 * 1. TaskUpdate marks a task as "completed"
 * 2. User prompt contains completion signals ("done", "complete", "finished")
 *
 * Hook: PostToolUse (TaskUpdate) + UserPromptSubmit
 * Output: Updates {project}/ROADMAP.md - moves current → completed
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseRoadmap, type RoadmapDoc } from './shared/roadmap-parser.js';

interface PostToolUseInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response?: unknown;
}

interface UserPromptSubmitInput {
  prompt: string;
  session_id?: string;
}

interface HookOutput {
  result: 'continue' | 'block';
  message?: string;
}

const COMPLETION_PATTERNS = [
  /\b(done|complete|completed|finished|shipped|deployed|merged)\b/i,
  /\btask\s+(is\s+)?(done|complete|finished)\b/i,
  /\bmark\s+(as\s+)?(done|complete|finished)\b/i,
  /\bclose\s+(this\s+)?(task|issue|item)\b/i,
];

const TEST_SUCCESS_PATTERNS = [
  /Tests:\s+\d+\s+passed,\s+0\s+failed/i,
  /✓\s+\d+\s+tests?\s+passed/i,
  /All specs passed/i,
  /\d+\s+passed,\s+0\s+failed/i,
  /PASSED\s+\d+\s+tests?/i,
  /OK\s+\(\d+\s+tests?\)/i,
];

const GIT_PUSH_PATTERNS = [
  /\[main\s+[a-f0-9]+\]/i,
  /\[master\s+[a-f0-9]+\]/i,
  /-> main$/im,
  /-> master$/im,
  /Branch .+ set up to track/i,
];

const COMPLETION_EXCLUSIONS = [
  /\bnot\s+(done|complete|finished)\b/i,
  /\bisn'?t\s+(done|complete|finished)\b/i,
  /\bwhen\s+(done|complete|finished)\b/i,
  /\bonce\s+(done|complete|finished)\b/i,
  /\bafter\s+(done|complete|finished)\b/i,
  /\buntil\s+(done|complete|finished)\b/i,
  /\?/, // Questions
];

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 1000);
  });
}

function detectCompletionSignal(text: string): { type: string; matched: boolean } {
  for (const pattern of TEST_SUCCESS_PATTERNS) {
    if (pattern.test(text)) {
      return { type: 'test_success', matched: true };
    }
  }
  for (const pattern of GIT_PUSH_PATTERNS) {
    if (pattern.test(text)) {
      return { type: 'git_push', matched: true };
    }
  }
  return { type: 'none', matched: false };
}

function isCompletionSignal(text: string): boolean {
  // Check exclusions first
  for (const exclusion of COMPLETION_EXCLUSIONS) {
    if (exclusion.test(text)) {
      return false;
    }
  }

  // Check for completion patterns
  for (const pattern of COMPLETION_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

function findRoadmapPath(projectDir: string): string | null {
  const candidates = [
    path.join(projectDir, 'ROADMAP.md'),
    path.join(projectDir, '.claude', 'ROADMAP.md'),
    path.join(projectDir, 'roadmap.md'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

// parseRoadmap + types now live in shared/roadmap-parser.ts (Phase 3A).
// roadmap-completion uses RoadmapDoc as RoadmapData (drop-in superset).
type RoadmapData = RoadmapDoc;

function updateRoadmapContent(content: string, data: RoadmapData): string {
  if (!data.current) {
    return content; // Nothing to complete
  }

  const today = new Date().toISOString().split('T')[0];
  const completedItem = `- [x] ${data.current.title} (${today})`;

  let lines = content.split('\n');
  let inCurrent = false;
  let inCompleted = false;
  let currentStart = -1;
  let currentEnd = -1;
  let completedInsertIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim().toLowerCase();

    if (stripped.startsWith('## current')) {
      inCurrent = true;
      inCompleted = false;
      currentStart = i + 1;
      continue;
    } else if (stripped.startsWith('## completed')) {
      inCurrent = false;
      inCompleted = true;
      completedInsertIndex = i + 1;
      if (currentEnd === -1) currentEnd = i;
      continue;
    } else if (stripped.startsWith('## ')) {
      if (inCurrent && currentEnd === -1) currentEnd = i;
      inCurrent = false;
      inCompleted = false;
      continue;
    }
  }

  if (currentEnd === -1) currentEnd = lines.length;

  // Remove current section content (keep header)
  const newLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i >= currentStart && i < currentEnd) {
      // Skip current section content
      continue;
    }
    newLines.push(lines[i]);

    // Add placeholder after ## Current
    if (lines[i].trim().toLowerCase().startsWith('## current')) {
      newLines.push('');
      newLines.push('_No current goal. Next planned item will be promoted on next planning session._');
      newLines.push('');
    }

    // Insert completed item after ## Completed header
    if (lines[i].trim().toLowerCase().startsWith('## completed')) {
      newLines.push(completedItem);
    }
  }

  return newLines.join('\n');
}

function promoteNextPlanned(content: string, data: RoadmapData): string {
  if (data.planned.length === 0) {
    return content;
  }

  // Find highest priority planned item
  const priorities: Record<string, number> = { high: 3, medium: 2, normal: 1, low: 0 };
  const prioOf = (item: { priority?: string }): number => {
    const p = (item.priority || 'normal').toLowerCase();
    return priorities[p] ?? 1;
  };
  let best = data.planned[0];
  for (const item of data.planned) {
    if (prioOf(item) > prioOf(best)) {
      best = item;
    }
  }

  const today = new Date().toISOString().split('T')[0];

  // Update content to move planned → current
  let lines = content.split('\n');
  let result: string[] = [];
  let inCurrent = false;
  let addedCurrent = false;
  let removedPlanned = false;

  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    const lower = stripped.toLowerCase();

    if (lower.startsWith('## current')) {
      inCurrent = true;
      result.push(lines[i]);
      result.push('');
      result.push(`**${best.title}**`);
      result.push(`- Started: ${today}`);
      result.push('');
      addedCurrent = true;
      continue;
    } else if (lower.startsWith('## ')) {
      inCurrent = false;
    }

    // Skip old "no current goal" placeholder
    if (inCurrent && stripped.includes('No current goal')) {
      continue;
    }

    // Skip the planned item we're promoting
    if (!removedPlanned && stripped.includes(best.title) && stripped.startsWith('- [ ]')) {
      removedPlanned = true;
      continue;
    }

    result.push(lines[i]);
  }

  return result.join('\n');
}

async function handleTaskUpdate(data: PostToolUseInput): Promise<HookOutput> {
  const input = data.tool_input as { status?: string; taskId?: string };

  if (input.status !== 'completed') {
    return { result: 'continue' };
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const roadmapPath = findRoadmapPath(projectDir);

  if (!roadmapPath) {
    return { result: 'continue' };
  }

  const content = fs.readFileSync(roadmapPath, 'utf-8');
  const roadmapData = parseRoadmap(content);

  if (!roadmapData.current) {
    return { result: 'continue' };
  }

  // Update ROADMAP: move current to completed
  let updated = updateRoadmapContent(content, roadmapData);

  // Optionally promote next planned item
  const updatedData = parseRoadmap(updated);
  if (!updatedData.current && updatedData.planned.length > 0) {
    updated = promoteNextPlanned(updated, updatedData);
  }

  fs.writeFileSync(roadmapPath, updated);

  return {
    result: 'continue',
    message: `ROADMAP updated: "${roadmapData.current.title}" marked complete`,
  };
}

async function handleBashOutput(data: PostToolUseInput): Promise<HookOutput> {
  let toolResult: string;
  const resp = data.tool_response;
  if (typeof resp === 'string') {
    toolResult = resp;
  } else if (resp && typeof (resp as any).output === 'string') {
    toolResult = (resp as any).output;
  } else {
    toolResult = '';
  }
  const signal = detectCompletionSignal(toolResult);

  if (!signal.matched) {
    return { result: 'continue' };
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const roadmapPath = findRoadmapPath(projectDir);

  if (!roadmapPath) {
    return { result: 'continue' };
  }

  const content = fs.readFileSync(roadmapPath, 'utf-8');
  const roadmapData = parseRoadmap(content);

  if (!roadmapData.current) {
    return { result: 'continue' };
  }

  const signalDescription = signal.type === 'test_success'
    ? 'All tests passed'
    : 'Code pushed to main branch';

  return {
    result: 'continue',
    message: `🎯 Completion signal: ${signalDescription}. Goal "${roadmapData.current.title}" may be complete.`,
  };
}

async function handleUserPrompt(data: UserPromptSubmitInput): Promise<HookOutput> {
  if (!isCompletionSignal(data.prompt)) {
    return { result: 'continue' };
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const roadmapPath = findRoadmapPath(projectDir);

  if (!roadmapPath) {
    return { result: 'continue' };
  }

  const content = fs.readFileSync(roadmapPath, 'utf-8');
  const roadmapData = parseRoadmap(content);

  if (!roadmapData.current) {
    return { result: 'continue' };
  }

  // Add a system reminder about potential completion
  return {
    result: 'continue',
    message: `Completion signal detected. Current ROADMAP goal: "${roadmapData.current.title}". If this goal is complete, the ROADMAP will be updated when you mark the task as completed.`,
  };
}

async function main() {
  const input = await readStdin();
  if (!input.trim()) {
    console.log(JSON.stringify({ result: 'continue' }));
    return;
  }

  let data: PostToolUseInput | UserPromptSubmitInput;
  try {
    data = JSON.parse(input);
  } catch {
    console.log(JSON.stringify({ result: 'continue' }));
    return;
  }

  let result: HookOutput;

  // Determine which hook type based on input shape
  if ('tool_name' in data && (data as PostToolUseInput).tool_name === 'TaskUpdate') {
    result = await handleTaskUpdate(data as PostToolUseInput);
  } else if ('tool_name' in data && (data as PostToolUseInput).tool_name === 'Bash') {
    result = await handleBashOutput(data as PostToolUseInput);
  } else if ('prompt' in data) {
    result = await handleUserPrompt(data as UserPromptSubmitInput);
  } else {
    result = { result: 'continue' };
  }

  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error('[roadmap-completion] Error:', err.message);
  console.log(JSON.stringify({ result: 'continue' }));
});
