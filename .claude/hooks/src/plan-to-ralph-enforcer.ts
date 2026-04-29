#!/usr/bin/env node
/**
 * Plan-to-Ralph Enforcer Hook
 *
 * PreToolUse hook on Edit|Write. After a plan has been approved
 * (tracked by plan-exit-tracker state file), if the user tries to
 * Edit/Write a CODE file without Ralph being active, this hook
 * BLOCKS the action and directs them to use /ralph.
 *
 * Decision flow:
 *   1. Read plan-approved state from session-isolated temp file
 *   2. No plan approved -> ALLOW
 *   3. Plan approved + Ralph active -> ALLOW (agents edit via delegation)
 *   4. Plan approved + Ralph NOT active + code file -> DENY
 *   5. Plan approved + Ralph NOT active + config/doc file -> ALLOW
 *
 * Fails open on ALL errors.
 */

import { readFileSync } from 'fs';
import {
  getStatePathWithMigration,
  getProjectScopedStatePathWithMigration,
} from './shared/session-isolation.js';
import { getProjectId } from './shared/project-id.js';
import { readStateWithLock } from './shared/atomic-write.js';
import { isRalphActive } from './shared/state-schema.js';
import { createLogger } from './shared/logger.js';
import { logHook } from './shared/session-activity.js';
import { isCodeFile, isAllowedConfigFile } from './shared/file-classification.js';

const log = createLogger('plan-to-ralph-enforcer');

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface HookInput {
  session_id?: string;
  tool_name: string;
  tool_input: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
  };
}

export interface DecisionInput {
  sessionId: string;
  toolName: string;
  filePath: string;
  planApproved: boolean;
  ralphActive: boolean;
}

export interface DecisionResult {
  block: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Pure decision function (exported for testing)
// ---------------------------------------------------------------------------

export function decidePlanEnforcement(params: DecisionInput): DecisionResult {
  const { planApproved, ralphActive, filePath } = params;

  // No plan approved -> allow everything
  if (!planApproved) {
    return { block: false };
  }

  // Plan approved + Ralph active -> allow (agents edit via delegation)
  if (ralphActive) {
    return { block: false };
  }

  // Plan approved + Ralph NOT active + config/doc file -> allow
  if (isAllowedConfigFile(filePath)) {
    return { block: false };
  }

  // Plan approved + Ralph NOT active + code file -> block
  if (isCodeFile(filePath)) {
    return {
      block: true,
      reason:
        'Plan approved -- direct code edits are blocked. ' +
        'Use /ralph to delegate implementation to agents.',
    };
  }

  // Not a code file and not a recognized config file -> allow (fail open)
  return { block: false };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function makeBlockOutput(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  console.log(JSON.stringify(output));
}

function makeAllowOutput(): void {
  console.log(JSON.stringify({}));
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main() {
  try {
    const rawInput = readFileSync(0, 'utf-8');
    if (!rawInput.trim()) {
      makeAllowOutput();
      return;
    }

    let input: HookInput;
    try {
      input = JSON.parse(rawInput);
    } catch {
      makeAllowOutput();
      return;
    }

    // Only process Edit and Write tools
    if (input.tool_name !== 'Edit' && input.tool_name !== 'Write') {
      makeAllowOutput();
      return;
    }

    const sessionId = input.session_id || '';
    const filePath = input.tool_input?.file_path || '';
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const projectId = getProjectId(projectDir);

    // Read plan-approved state.
    // Phase 4: state path is now scoped to (projectId, sessionId) so a stale
    // approval from project A cannot bleed into project B even if both
    // sessions share an ID. Migration helper falls back to the legacy
    // session-only path for one hour to preserve in-flight approvals.
    let planApproved = false;
    try {
      const statePath = getProjectScopedStatePathWithMigration(
        'plan-approved',
        projectId,
        sessionId,
      );
      const content = readStateWithLock(statePath);
      if (content) {
        const state = JSON.parse(content);
        planApproved = state?.approved === true;
      }
    } catch {
      // State unreadable -> treat as no plan approved (fail open)
      planApproved = false;
    }

    // Check Ralph status
    let ralphActive = false;
    if (planApproved) {
      try {
        const ralphStatus = isRalphActive(projectDir);
        ralphActive = ralphStatus.active;
      } catch {
        // Fail open
        ralphActive = false;
      }
    }

    const result = decidePlanEnforcement({
      sessionId,
      toolName: input.tool_name,
      filePath,
      planApproved,
      ralphActive,
    });

    if (result.block && result.reason) {
      log.info(`Blocking ${input.tool_name} on ${filePath}: plan approved, Ralph not active`, { sessionId });
      try { logHook(sessionId, 'plan-to-ralph-enforcer'); } catch { /* never break */ }
      makeBlockOutput(result.reason);
    } else {
      makeAllowOutput();
    }
  } catch (err) {
    // Fail open on ALL errors
    log.error(`Unexpected error, failing open`, { error: String(err) });
    makeAllowOutput();
  }
}

// Guard: don't run main() when imported by vitest
if (!process.env.VITEST) {
  main();
}
