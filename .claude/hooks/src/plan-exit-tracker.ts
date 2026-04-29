#!/usr/bin/env node
/**
 * Plan Exit Tracker Hook
 *
 * PostToolUse hook on ExitPlanMode. When ExitPlanMode is used, writes a
 * state file marking that a plan has been approved.
 *
 * State file: $TEMP/claude-plan-approved-<projectId>-<sessionId>.json
 * Content:    { "approved": true, "timestamp": <epoch ms>, "sessionId": "<id>" }
 *
 * Phase 4 (cross-project isolation): state files are scoped by both
 * projectId and sessionId. Two terminals editing different projects
 * with the same sessionId no longer collide.
 *
 * Uses session-isolated state paths and atomic writes.
 * Always outputs {} to stdout (PostToolUse hooks don't block).
 * Fails open: any error -> output {}.
 */

import { readFileSync } from 'fs';
import {
  getStatePathWithMigration,
  getProjectScopedStatePath,
} from './shared/session-isolation.js';
import { getProjectId } from './shared/project-id.js';
import { writeStateWithLock } from './shared/atomic-write.js';
import { createLogger } from './shared/logger.js';
import { logHook } from './shared/session-activity.js';

const log = createLogger('plan-exit-tracker');

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface HookInput {
  tool_name: string;
  tool_input: any;
  session_id?: string;
}

interface PlanApprovedState {
  approved: true;
  timestamp: number;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Returns true only when the input represents an ExitPlanMode tool use.
 */
export function shouldTrack(input: any): boolean {
  if (!input || typeof input !== 'object') return false;
  return input.tool_name === 'ExitPlanMode';
}

/**
 * Builds the plan-approved state object.
 */
export function buildPlanApprovedState(sessionId: string): PlanApprovedState {
  return {
    approved: true,
    timestamp: Date.now(),
    sessionId,
  };
}

// ---------------------------------------------------------------------------
// Core handler (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Handles the ExitPlanMode event by writing plan-approved state.
 * Fails open: never throws.
 */
export function handlePlanExit(input: any): void {
  try {
    if (!shouldTrack(input)) return;

    const sessionId = input.session_id || 'unknown';
    const state = buildPlanApprovedState(sessionId);
    // Phase 4: write project-scoped state. Both reader (plan-to-ralph-enforcer)
    // and writer must agree on the projectId, derived from CLAUDE_PROJECT_DIR
    // (or CWD). Falls back through the migration helper on the read side.
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const projectId = getProjectId(projectDir);
    const statePath = getProjectScopedStatePath(
      'plan-approved',
      projectId,
      input.session_id,
    );

    writeStateWithLock(statePath, JSON.stringify(state, null, 2));

    try {
      logHook(sessionId, 'plan-exit-tracker');
    } catch {
      // Never break on activity logging
    }

    log.info('Plan exit tracked', { sessionId });
  } catch (err) {
    log.error('handlePlanExit failed', { error: String(err) });
    // Fail open
  }
}

// ---------------------------------------------------------------------------
// main() entry point
// ---------------------------------------------------------------------------

function main(): void {
  try {
    const raw = readFileSync(0, 'utf-8');
    if (!raw.trim()) {
      console.log(JSON.stringify({}));
      return;
    }

    let input: HookInput;
    try {
      input = JSON.parse(raw);
    } catch {
      console.log(JSON.stringify({}));
      return;
    }

    handlePlanExit(input);
    console.log(JSON.stringify({}));
  } catch {
    // Fail open
    console.log(JSON.stringify({}));
  }
}

// Guard: don't run main() when imported by vitest
if (!process.env.VITEST) {
  main();
}
