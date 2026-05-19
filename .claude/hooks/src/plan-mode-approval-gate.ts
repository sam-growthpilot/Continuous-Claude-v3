#!/usr/bin/env node
/**
 * Plan Mode Approval Gate
 *
 * PreToolUse hook on ExitPlanMode. Forces an interactive approval dialog
 * before ExitPlanMode runs, even when Claude Code is in
 * `--dangerously-skip-permissions` (bypass) mode. PreToolUse "ask"
 * decisions survive bypass mode, unlike the PermissionRequest layer
 * (where `permission-auto-allow` and bypass mode otherwise auto-approve
 * ExitPlanMode).
 *
 * Behavior:
 *   - BYPASS_PLAN_GATE=1 set                   -> allow (manual override)
 *   - /goal mode is active in this session     -> allow (autonomous goal
 *                                                 mode needs to enter/exit
 *                                                 plan mode without
 *                                                 interruption; detected
 *                                                 via the `goal_status`
 *                                                 attachment that Claude
 *                                                 Code writes to the
 *                                                 transcript JSONL)
 *   - Ralph is active in this project          -> allow (mid-loop plan
 *                                                 exits flow through)
 *   - Otherwise                                -> ask (force user dialog)
 *
 * Fails open on ALL errors.
 */

import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { isRalphActive } from './shared/state-schema.js';
import { createLogger } from './shared/logger.js';
import { logHook } from './shared/session-activity.js';

const log = createLogger('plan-mode-approval-gate');

interface HookInput {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export interface GateDecisionInput {
  toolName?: string;
  bypassEnv: boolean;
  ralphActive: boolean;
  goalActive: boolean;
}

export type GateDecision =
  | { action: 'allow' }
  | { action: 'ask'; reason: string };

export function decideGate(params: GateDecisionInput): GateDecision {
  if (params.toolName !== 'ExitPlanMode') return { action: 'allow' };
  if (params.bypassEnv) return { action: 'allow' };
  if (params.goalActive) return { action: 'allow' };
  if (params.ralphActive) return { action: 'allow' };
  return {
    action: 'ask',
    reason:
      'Plan-mode approval gate: confirm before exiting plan mode and ' +
      'executing the proposed plan. Set BYPASS_PLAN_GATE=1 to skip this ' +
      'gate, or run /goal / /ralph to auto-bypass for autonomous flows.',
  };
}

// ---------------------------------------------------------------------------
// Goal-mode detection via transcript JSONL
// ---------------------------------------------------------------------------

/**
 * Maps a project directory to the transcript directory name that Claude
 * Code uses under ~/.claude/projects/. Replaces every non-alphanumeric
 * character with a dash (matches the harness convention; e.g.
 * `C:/Users/david.hayes/continuous-claude` -> `C--Users-david-hayes-continuous-claude`).
 */
export function mangleProjectDir(projectDir: string): string {
  return projectDir.replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Hard cap on transcript size we'll scan. Anything larger we treat as
 * "no goal" (the user can set BYPASS_PLAN_GATE=1 to override).
 */
const MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;

/**
 * Pure: scan transcript-tail text for the most recent goal_status entry
 * and return its activeness, or `null` if no goal_status was found.
 *
 * Returns true  -> goal is active (sentinel=true, met=false)
 * Returns false -> goal is cleared/met (any other goal_status shape)
 * Returns null  -> no goal_status found in this text window
 *
 * The harness emits a single goal_status attachment when /goal activates;
 * we walk backwards from the end to find it.
 */
export function detectGoalActiveFromTranscript(text: string): boolean | null {
  if (!text) return null;
  const lines = text.split('\n');
  // Walk backwards through the lines, returning at the most recent
  // valid goal_status attachment.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    // Cheap pre-filter to avoid parsing every line.
    if (!line.includes('"goal_status"')) continue;
    try {
      const obj = JSON.parse(line);
      const att = obj?.attachment;
      if (att && att.type === 'goal_status') {
        return att.sentinel === true && att.met === false;
      }
    } catch {
      // skip
    }
  }
  return null;
}

/**
 * Resolve the transcript path for (projectDir, sessionId), scan it
 * backwards in 256KB chunks, and detect whether /goal is currently active.
 *
 * The harness emits a single `goal_status` attachment per /goal command;
 * we have to walk backwards through the file to find the most recent
 * activation (or clearance) event. Hard-cap the scan at 8MB so this
 * stays bounded for very long sessions; if the goal event lives further
 * back than that, we conservatively treat goal as inactive (the user
 * can set BYPASS_PLAN_GATE=1 to override).
 *
 * Fails closed (returns false) on any error so a missing/unreadable
 * transcript never silently bypasses the gate.
 */
export function isGoalModeActive(projectDir: string, sessionId: string): boolean {
  if (!sessionId) return false;
  try {
    const mangled = mangleProjectDir(projectDir);
    const transcriptPath = join(
      homedir(),
      '.claude',
      'projects',
      mangled,
      `${sessionId}.jsonl`,
    );
    let size = 0;
    try {
      size = statSync(transcriptPath).size;
    } catch {
      return false;
    }
    if (size === 0 || size > MAX_TRANSCRIPT_BYTES) return false;
    const text = readFileSync(transcriptPath, 'utf-8');
    return detectGoalActiveFromTranscript(text) === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hook plumbing
// ---------------------------------------------------------------------------

function emitAllow(): void {
  console.log(JSON.stringify({}));
}

function emitAsk(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  };
  console.log(JSON.stringify(output));
}

function main(): void {
  try {
    const raw = readFileSync(0, 'utf-8');
    if (!raw.trim()) {
      emitAllow();
      return;
    }

    let input: HookInput;
    try {
      input = JSON.parse(raw);
    } catch {
      emitAllow();
      return;
    }

    if (input.tool_name !== 'ExitPlanMode') {
      emitAllow();
      return;
    }

    const sessionId = input.session_id || '';
    const bypassEnv = process.env.BYPASS_PLAN_GATE === '1';
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

    let ralphActive = false;
    try {
      ralphActive = isRalphActive(projectDir).active;
    } catch {
      ralphActive = false;
    }

    let goalActive = false;
    try {
      goalActive = isGoalModeActive(projectDir, sessionId);
    } catch {
      goalActive = false;
    }

    const decision = decideGate({
      toolName: input.tool_name,
      bypassEnv,
      ralphActive,
      goalActive,
    });

    try {
      logHook(sessionId, 'plan-mode-approval-gate');
    } catch {
      // Never break on activity logging
    }

    if (decision.action === 'ask') {
      log.info('Forcing plan-mode approval dialog', { sessionId });
      emitAsk(decision.reason);
    } else {
      log.info('Allowing ExitPlanMode without prompt', {
        sessionId,
        bypassEnv,
        goalActive,
        ralphActive,
      });
      emitAllow();
    }
  } catch (err) {
    log.error('Unexpected error, failing open', { error: String(err) });
    emitAllow();
  }
}

if (!process.env.VITEST) {
  main();
}
