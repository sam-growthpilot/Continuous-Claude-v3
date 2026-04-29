/**
 * Plan-to-Ralph Enforcer: project-scoped hook state isolation (Phase 4).
 *
 * Today's behavior: state file is named claude-plan-approved-<sessionId>.json
 * and gets read regardless of which project the session is editing. After
 * the fix it's claude-plan-approved-<projectId>-<sessionId>.json so the
 * same sessionId in a different project does NOT see another project's
 * state.
 *
 * This test:
 *   1. Writes plan-approved state under (projectId-A, sessionId-X)
 *   2. Fires the enforcer pretending to be (projectId-B, sessionId-X)
 *   3. Asserts decision is 'allow' (no stale match) - today the enforcer
 *      would deny because both writes/reads collapse to the same path.
 *
 * State file cleanup happens in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

import { getProjectScopedStatePath } from '../shared/session-isolation.js';
import { getProjectId } from '../shared/project-id.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const HOOK_PATH = resolve(__dirname, '..', '..', 'dist', 'plan-to-ralph-enforcer.mjs');

const SESSION = 'p2r-project-scope-test';
const PROJECT_A = join(tmpdir(), 'p2r-test-project-a');
const PROJECT_B = join(tmpdir(), 'p2r-test-project-b');

interface HookOutput {
  hookSpecificOutput?: {
    permissionDecision?: 'allow' | 'deny';
    permissionDecisionReason?: string;
  };
}

function runHookForProject(projectDir: string, codeFile: string): HookOutput {
  const input = JSON.stringify({
    session_id: SESSION,
    tool_name: 'Edit',
    tool_input: { file_path: codeFile },
  });

  // IMPORTANT: strip VITEST/VITEST_* env vars so the spawned hook actually
  // runs main() (the hook source has `if (!process.env.VITEST) main();`).
  const cleanEnv: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('VITEST')) cleanEnv[k] = v;
  }

  const result = spawnSync('node', [HOOK_PATH], {
    input,
    encoding: 'utf-8',
    timeout: 5000,
    env: {
      ...cleanEnv,
      CLAUDE_PROJECT_DIR: projectDir,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdout = (result.stdout || '').trim();
  if (!stdout) return {};
  try {
    return JSON.parse(stdout);
  } catch {
    return {};
  }
}

beforeEach(() => {
  if (!existsSync(HOOK_PATH)) {
    throw new Error(`Built hook missing: ${HOOK_PATH}. Run npm run build first.`);
  }
  // Pre-create the project dirs so getProjectId resolves consistently.
  for (const p of [PROJECT_A, PROJECT_B]) {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
});

afterEach(() => {
  // Clean up state files we wrote
  for (const p of [PROJECT_A, PROJECT_B]) {
    const projectId = getProjectId(p);
    const statePath = getProjectScopedStatePath('plan-approved', projectId, SESSION);
    try {
      if (existsSync(statePath)) rmSync(statePath, { force: true });
    } catch {
      // best effort
    }
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

describe('plan-to-ralph-enforcer: project-scoped state (Phase 4B)', () => {
  it('does not leak plan-approved state across projects with same sessionId', () => {
    // Write plan-approved state for PROJECT_A
    const projectIdA = getProjectId(PROJECT_A);
    const statePathA = getProjectScopedStatePath('plan-approved', projectIdA, SESSION);
    writeFileSync(statePathA, JSON.stringify({
      approved: true,
      timestamp: Date.now(),
      sessionId: SESSION,
    }));

    // Fire the enforcer pretending to be in PROJECT_B with the same sessionId.
    // We touch a code file (.ts) so isCodeFile() returns true; without the
    // fix, the enforcer would BLOCK because it would read the stale state
    // from PROJECT_A.
    const codeFileB = join(PROJECT_B, 'feature.ts');
    const output = runHookForProject(PROJECT_B, codeFileB);

    // Expectation: no block (no state for project B). Today's bug: block.
    const decision = output.hookSpecificOutput?.permissionDecision;
    expect(decision).not.toBe('deny');
  });

  it('still blocks within the same project that approved the plan', () => {
    // Write plan-approved state for PROJECT_A
    const projectIdA = getProjectId(PROJECT_A);
    const statePathA = getProjectScopedStatePath('plan-approved', projectIdA, SESSION);
    writeFileSync(statePathA, JSON.stringify({
      approved: true,
      timestamp: Date.now(),
      sessionId: SESSION,
    }));

    // Fire enforcer FROM PROJECT_A with a code file. Should block (Ralph
    // is not active and the plan was approved within this project).
    const codeFileA = join(PROJECT_A, 'feature.ts');
    const output = runHookForProject(PROJECT_A, codeFileA);

    const decision = output.hookSpecificOutput?.permissionDecision;
    expect(decision).toBe('deny');
  });
});
