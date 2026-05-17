/**
 * Memory Awareness Hook (UserPromptSubmit)
 *
 * Checks if user prompt is similar to stored learnings.
 * Shows hint to BOTH user (visible) AND Claude (system context).
 *
 * Flow:
 * 1. Extract INTENT from user prompt (via shared/intent-extractor)
 * 2. Run local-memory + DB-memory checks in parallel
 * 3. Merge & dedupe results, apply PROACTIVE_INJECTION_FLOOR
 * 4. If results survive floor, inject MEMORY MATCH context for Claude
 * 5. Log every fire to <project>/.claude/logs/memory-recall.jsonl
 *
 * Story: memory-hardening-2026-05-16, Wave 3 (Tasks 9 + 10).
 *  - Task 9: de-shadow local memory (merge local + DB instead of short-circuit)
 *  - Task 10: append observability log (memory-recall.jsonl) for every fire
 *  - Wave 3 cleanup: replace inline extractIntent/extractKeywords with
 *    imports from shared/intent-extractor (Wave 2 owns that file).
 */

import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { getOpcDir } from './shared/opc-path.js';
import { outputContinue } from './shared/output.js';
import { logHook } from './shared/session-activity.js';
import { extractIntent, extractKeywords } from './shared/intent-extractor.js';

const PROACTIVE_INJECTION_FLOOR = 0.05;

/**
 * Score-scale normalization for local results.
 *
 * Local index returns cosine-ish similarity (~0.5 typical) while the DB path
 * returns ts_rank (0.0001–0.1) plus a 0.1 ILIKE fallback. Multiplying local
 * scores by this factor brings them into the ts_rank range so the merge sort
 * and floor filter behave consistently across both sources.
 */
const LOCAL_SCORE_NORMALIZE = 0.1;

interface UserPromptSubmitInput {
  session_id: string;
  hook_event_name: string;
  prompt: string;
  cwd: string;
}

interface LearningResult {
  id: string;
  type: string;
  content: string;
  score: number;
}

type MemorySource = 'local' | 'db' | 'merged' | 'empty';

interface MemoryMatch {
  count: number;
  results: LearningResult[];
  source: MemorySource;
}

function readStdin(): string {
  return readFileSync(0, 'utf-8');
}

/**
 * Detect git operations and expand query for better memory matching.
 * E.g., "push" → "git push remote fork origin" to catch repo-specific preferences.
 */
function expandGitQuery(prompt: string): string | null {
  const lower = prompt.toLowerCase().trim();

  // Git operation patterns and their expanded queries
  const gitExpansions: Record<string, string> = {
    'push': 'git push remote fork origin upstream',
    'git push': 'git push remote fork origin upstream',
    'commit': 'git commit message workflow',
    'git commit': 'git commit message workflow',
    'pr': 'pull request pr create review',
    'create pr': 'pull request pr create github',
    'pull request': 'pull request pr create github',
    'merge': 'git merge branch main',
    'rebase': 'git rebase branch workflow',
    'checkout': 'git checkout branch switch',
    'branch': 'git branch create switch',
    'stash': 'git stash save pop',
    'reset': 'git reset hard soft',
    'force push': 'git push force dangerous',
  };

  // Check for exact or partial matches
  for (const [pattern, expansion] of Object.entries(gitExpansions)) {
    if (lower === pattern || lower.startsWith(pattern + ' ') || lower.endsWith(' ' + pattern)) {
      return expansion;
    }
  }

  // Check if prompt contains git-related words
  const gitKeywords = ['git', 'push', 'commit', 'pr', 'merge', 'rebase', 'branch'];
  const hasGitContext = gitKeywords.some(kw => lower.includes(kw));

  if (hasGitContext) {
    // Add git context to the search
    return prompt + ' git remote workflow';
  }

  return null;
}

// Note: extractIntent / extractKeywords now imported from
// './shared/intent-extractor.js' (Wave 2 — kraken-AGENT-RECALL).
// The implementations there are byte-identical to the previous inline
// versions; behavior is unchanged.

/**
 * Check local project memory index first (topic keyword match).
 * Returns results from .claude/memory/index.json if available.
 *
 * NOTE: scores from this path are similarity-style (~0.5). The caller
 * normalizes them via LOCAL_SCORE_NORMALIZE before merging with DB results
 * so the merge sort + floor filter behave consistently.
 */
function checkLocalMemory(intent: string, projectDir: string): LearningResult[] {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const projectMemoryScript = path.join(homeDir, '.claude', 'scripts', 'core', 'project_memory.py');

  if (!existsSync(projectMemoryScript)) return [];

  try {
    const result = spawnSync('uv', [
      'run', 'python', projectMemoryScript,
      'query', intent,
      '--project-dir', projectDir,
      '-k', '3',
      '--json'
    ], {
      encoding: 'utf-8',
      cwd: path.join(homeDir, '.claude', 'scripts', 'core'),
      timeout: 2000,
      killSignal: 'SIGKILL',
    });

    if (result.status !== 0 || !result.stdout) return [];

    const data = JSON.parse(result.stdout);
    if (!data.results || data.results.length === 0) return [];

    return data.results.slice(0, 3).map((r: any) => ({
      id: r.task_id || r.id || 'local',
      type: 'LOCAL_HANDOFF',
      content: r.summary || r.content || '',
      // Normalize local similarity (~0.5) into ts_rank range so the merge
      // sort/floor doesn't unfairly favor local rows.
      score: (r.similarity || 0.5) * LOCAL_SCORE_NORMALIZE,
    }));
  } catch {
    return [];
  }
}

/**
 * Query the global archival memory DB via recall_learnings.py.
 * Returns the raw (unfiltered) result list — caller applies floor + merge.
 */
function checkDbMemory(intent: string, _projectDir: string): LearningResult[] {
  const opcDir = getOpcDir();
  if (!opcDir) return [];

  const searchTerm = intent
    .replace(/[_\/]/g, ' ')
    .replace(/\b\w{1,2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const result = spawnSync('uv', [
    'run', 'python', 'scripts/core/recall_learnings.py',
    '--query', searchTerm,
    '--k', '3',
    '--json',
    '--text-only'
  ], {
    encoding: 'utf-8',
    cwd: opcDir,
    env: {
      ...process.env,
      PYTHONPATH: opcDir
    },
    timeout: 2000,
    killSignal: 'SIGKILL',
  });

  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  try {
    const data = JSON.parse(result.stdout);

    if (!data.results || data.results.length === 0) {
      return [];
    }

    return (data.results || []).map((r: any) => {
      const content = r.content || '';
      const preview = content
        .split('\n')
        .filter((l: string) => l.trim().length > 0)
        .map((l: string) => l.trim())
        .join(' ')
        .slice(0, 120);

      return {
        id: (r.id || 'unknown').slice(0, 8),
        type: r.learning_type || r.type || 'UNKNOWN',
        content: preview + (content.length > 120 ? '...' : ''),
        score: r.score || 0,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Merge local + DB result lists.
 *
 * Returns null if both inputs are empty. Otherwise dedupes by id (keeping
 * the higher score), sorts descending, slices to top 3, and tags the source.
 *
 * `source` semantics: 'local' / 'db' / 'merged' depending on which sources
 * contributed to the *kept* (post-slice) results.
 */
function mergeResults(
  local: LearningResult[],
  db: LearningResult[],
): MemoryMatch | null {
  if ((!local || local.length === 0) && (!db || db.length === 0)) {
    return null;
  }

  const localTagged = (local || []).map((r) => ({ ...r, __src: 'local' as const }));
  const dbTagged = (db || []).map((r) => ({ ...r, __src: 'db' as const }));
  const combined = [...localTagged, ...dbTagged];

  // Dedupe by id: keep the entry with the higher score (and remember
  // whether we crossed sources for that id, which counts as 'merged').
  const byId = new Map<string, { row: LearningResult & { __src: 'local' | 'db' }; crossed: boolean }>();
  for (const row of combined) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, { row, crossed: false });
    } else {
      const crossed = existing.crossed || existing.row.__src !== row.__src;
      const winner = row.score > existing.row.score ? row : existing.row;
      byId.set(row.id, { row: winner, crossed });
    }
  }

  const deduped = Array.from(byId.values());
  deduped.sort((a, b) => b.row.score - a.row.score);
  const top = deduped.slice(0, 3);

  if (top.length === 0) return null;

  const sources = new Set<string>();
  for (const t of top) {
    sources.add(t.row.__src);
    if (t.crossed) sources.add('merged');
  }
  const source: MemorySource =
    sources.has('merged') || sources.size > 1
      ? 'merged'
      : sources.has('local')
        ? 'local'
        : 'db';

  // Strip the internal __src tag from results before returning.
  const cleaned: LearningResult[] = top.map(({ row }) => ({
    id: row.id,
    type: row.type,
    content: row.content,
    score: row.score,
  }));

  return {
    count: deduped.length,
    results: cleaned,
    source,
  };
}

/**
 * Apply the PROACTIVE_INJECTION_FLOOR to a MemoryMatch.
 * Returns null if nothing survives.
 */
function applyFloor(match: MemoryMatch | null): MemoryMatch | null {
  if (!match) return null;
  const filtered = match.results.filter((r) => (r.score ?? 0) >= PROACTIVE_INJECTION_FLOOR);
  if (filtered.length === 0) return null;
  return {
    count: filtered.length,
    results: filtered,
    source: match.source,
  };
}

/**
 * Memory relevance check (Wave 3 dual-source design).
 *
 * Previously this short-circuited on a local hit, which could mask better
 * global archival_memory rows. Now we ALWAYS query both sources, merge,
 * dedupe, sort, and slice to the top 3 — then apply the floor.
 */
function checkMemoryRelevance(intent: string, projectDir: string): MemoryMatch | null {
  if (!intent || intent.length < 3) return null;

  const local = checkLocalMemory(intent, projectDir);
  const db = checkDbMemory(intent, projectDir);

  const merged = mergeResults(local, db);
  return applyFloor(merged);
}

// ---------------------------------------------------------------------------
// Observability logging (Task #10)
// ---------------------------------------------------------------------------

interface RecallLogEntry {
  timestamp: string;
  session_id: string;
  subagent: string | null;
  intent: string;
  results_count: number;
  top_score: number;
  kept_after_floor: number;
  source: MemorySource;
}

function getRecallLogPath(projectDir: string): string {
  const dir = path.join(projectDir, '.claude', 'logs');
  try {
    mkdirSync(dir, { recursive: true });
  } catch { /* dir already exists */ }
  return path.join(dir, 'memory-recall.jsonl');
}

function logRecallFire(entry: RecallLogEntry, projectDir: string): void {
  try {
    appendFileSync(getRecallLogPath(projectDir), JSON.stringify(entry) + '\n');
  } catch {
    /* fail-open: never let logging break the hook */
  }
}

async function main() {
  const input: UserPromptSubmitInput = JSON.parse(readStdin());
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd;

  // Skip for subagents - they don't need memory recall (saves tokens)
  if (process.env.CLAUDE_AGENT_ID) {
    outputContinue();
    return;
  }

  // Skip very short prompts (greetings, commands)
  if (input.prompt.length < 15) {
    outputContinue();
    return;
  }

  // Skip if prompt is just a slash command
  if (input.prompt.trim().startsWith('/')) {
    outputContinue();
    return;
  }

  // Check for git operations first - expand query for better matching
  const gitExpanded = expandGitQuery(input.prompt);

  // Extract intent (semantic query, not just keywords)
  const intent = gitExpanded || extractIntent(input.prompt);

  // Skip if no meaningful intent
  if (intent.length < 3) {
    outputContinue();
    return;
  }

  // Run both sources, merge, apply floor.
  const local = checkLocalMemory(intent, projectDir);
  const db = checkDbMemory(intent, projectDir);
  const mergedRaw = mergeResults(local, db);
  const match = applyFloor(mergedRaw);

  // Observability log (Task #10): record every fire that made it past skips.
  // We log both hits and misses so we can find "intents that consistently
  // miss" — but suppress entries that get filtered by the skip checks above.
  const topScoreRaw = mergedRaw && mergedRaw.results.length > 0
    ? mergedRaw.results.reduce((m, r) => Math.max(m, r.score ?? 0), 0)
    : 0;
  const logEntry: RecallLogEntry = {
    timestamp: new Date().toISOString(),
    session_id: input.session_id || 'unknown',
    subagent: process.env.CLAUDE_AGENT_ID || null,
    intent,
    results_count: mergedRaw ? mergedRaw.count : 0,
    top_score: topScoreRaw,
    kept_after_floor: match ? match.results.length : 0,
    source: match ? match.source : (mergedRaw ? mergedRaw.source : 'empty'),
  };
  logRecallFire(logEntry, projectDir);

  if (match) {
    // Log that this hook fired (only when it actually finds memories)
    try { logHook(input.session_id, 'memory-awareness'); } catch { /* never break */ }

    // Build structured context for Claude
    const resultLines = match.results.map((r, i) =>
      `${i + 1}. [${r.type}] ${r.content} (id: ${r.id})`
    ).join('\n');

    const claudeContext = `MEMORY MATCH (${match.count} results) for "${intent}":\n${resultLines}\nUse /recall "${intent}" for full content. Disclose if helpful.`;

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: claudeContext
      }
    }));
  } else {
    outputContinue();
  }
}

main().catch(() => {
  // Silent fail - don't block user prompts
  outputContinue();
});

// Exports for testability — Wave 3 introduces these so future tests can pin
// the merge & floor behavior without going through the stdin/spawn path.
export {
  mergeResults,
  applyFloor,
  PROACTIVE_INJECTION_FLOOR,
  LOCAL_SCORE_NORMALIZE,
};
export type { LearningResult, MemoryMatch, MemorySource };
// Also re-export the shared helpers so callers don't need to know they were
// factored into shared/.
export { extractIntent, extractKeywords };
