#!/usr/bin/env node
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logSkill, logAgent } from './shared/session-activity.js';
import { emitBraintrustScore } from './shared/braintrust-score.js';

interface HookInput {
    session_id: string;
    transcript_path: string;
    cwd: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_response?: {
        status?: string;
        output?: string;
    };
}

interface TelemetryEvent {
    timestamp: string;
    session_id: string;
    type: 'skill_triggered' | 'skill_used' | 'agent_suggested' | 'agent_spawned';
    name: string;
    trigger_source: 'hook' | 'explicit' | 'llm';
    success?: boolean;
}

function getTelemetryPath(): string {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const telemetryDir = join(homeDir, '.claude', 'cache');
    if (!existsSync(telemetryDir)) {
        mkdirSync(telemetryDir, { recursive: true });
    }
    return join(telemetryDir, 'skill-telemetry.jsonl');
}

function logEvent(event: TelemetryEvent): void {
    const telemetryPath = getTelemetryPath();
    const line = JSON.stringify(event) + '\n';
    appendFileSync(telemetryPath, line, 'utf-8');
}

function determineSource(toolInput: Record<string, unknown>): 'hook' | 'explicit' | 'llm' {
    const skill = toolInput.skill as string || '';
    if (skill.startsWith('/')) {
        return 'explicit';
    }
    return 'llm';
}

// ---------------------------------------------------------------------------
// Phase 3a (story braintrust-scoring): skill_trigger_accuracy score emit.
//
// The original plan describes "skill_trigger_accuracy" as a multi-skill
// collision detector (exactly 1 skill triggered = 1.0, 0 or 2+ = 0.0).
// That detection happens at a higher layer than this PostToolUse:Skill
// hook -- by the time we run, exactly 1 skill has fired by definition.
//
// What we CAN measure deterministically from this hook is whether that
// single skill SUCCEEDED. We emit:
//   * skill_trigger_accuracy: 1.0 when success === true, else 0.0
//
// Caveat (documented for ops): success is derived from
// `tool_response.status !== 'error'`. Empirical telemetry shows the
// upstream `tool_response.status` is rarely if ever set to "error" on
// Skill failures (see Phase 3 handoff finding), so 1.0 is the dominant
// emit value today. The score becomes more meaningful once upstream
// success-detection is hardened (separate task).
//
// spanId resolution: prefer BRAINTRUST_SESSION_ID env (set by the Python
// hook chain when running inside a Claude Code session); fall back to the
// hook payload session_id. The helper itself is fail-open, so a missing
// span just skips emission silently.
// ---------------------------------------------------------------------------
export function resolveScoreSpanId(payloadSessionId: string | undefined): string {
    const envSpan = (process.env.BRAINTRUST_SESSION_ID || '').trim();
    if (envSpan.length > 0) return envSpan;
    return payloadSessionId || '';
}

export interface SkillTriggerEmitInput {
    sessionId: string | undefined;
    skillName: string;
    triggerSource: 'hook' | 'explicit' | 'llm';
    success: boolean;
}

/**
 * Pure helper that derives the emit payload for skill_trigger_accuracy.
 * Returns null when there is no spanId available (helper would skip).
 * Exported for unit testing -- main() wires this to emitBraintrustScore.
 */
export function buildSkillTriggerScorePayload(
    input: SkillTriggerEmitInput,
): { spanId: string; scores: Record<string, number>; metadata: Record<string, unknown> } | null {
    const spanId = resolveScoreSpanId(input.sessionId);
    if (!spanId) return null;
    return {
        spanId,
        scores: {
            skill_trigger_accuracy: input.success ? 1.0 : 0.0,
        },
        metadata: {
            skill_name: input.skillName,
            trigger_source: input.triggerSource,
            hook: 'telemetry-tracker',
        },
    };
}

async function main() {
    try {
        const input = readFileSync(0, 'utf-8');
        const data: HookInput = JSON.parse(input);

        if (data.tool_name === 'Skill') {
            const skillName = data.tool_input?.skill as string || 'unknown';
            const success = data.tool_response?.status !== 'error';

            const event: TelemetryEvent = {
                timestamp: new Date().toISOString(),
                session_id: data.session_id,
                type: 'skill_used',
                name: skillName,
                trigger_source: determineSource(data.tool_input),
                success
            };

            logEvent(event);
            try { logSkill(data.session_id, skillName); } catch { /* never break */ }

            // Phase 3a: emit skill_trigger_accuracy score. Fire-and-forget --
            // the helper has a 2s timeout and swallows errors. Awaiting would
            // add up to 2s of latency to every Skill PostToolUse.
            try {
                const payload = buildSkillTriggerScorePayload({
                    sessionId: data.session_id,
                    skillName,
                    triggerSource: determineSource(data.tool_input),
                    success,
                });
                if (payload) {
                    await emitBraintrustScore(payload); // eslint-disable-line @typescript-eslint/no-floating-promises
                }
            } catch {
                /* fail-open: never let score emission break the hook */
            }
        } else if (data.tool_name === 'Task') {
            const agentType = data.tool_input?.subagent_type as string || 'unknown';
            const success = data.tool_response?.status !== 'error';

            const event: TelemetryEvent = {
                timestamp: new Date().toISOString(),
                session_id: data.session_id,
                type: 'agent_spawned',
                name: agentType,
                trigger_source: 'llm',
                success
            };

            logEvent(event);
            try { logAgent(data.session_id, agentType); } catch { /* never break */ }
        }

        process.exit(0);
    } catch {
        process.exit(0);
    }
}

if (!process.env.VITEST) {
    main();
}
