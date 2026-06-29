#!/usr/bin/env node
/**
 * Destructive Command Guard — PreToolUse:Bash
 *
 * Phase 1a (SAFE floor, D2g-02 / GAP3-01). Restores the human gate on
 * destructive shell operations that the permission layer otherwise auto-runs.
 *
 * Why a PreToolUse:Bash hook and NOT the permission-auto-allow PermissionRequest
 * hook (mechanism corrected via claude-code-guide research 2026-06-28):
 *   - `permissions.allow` contains "Bash", so Bash is granted BEFORE the
 *     PermissionRequest hook is ever reached — scoping that hook cannot gate Bash.
 *   - PermissionRequest is silenced entirely in bypass + headless modes.
 *   - A PreToolUse hook fires in ALL modes (default, bypass, headless) and can
 *     return permissionDecision to override an allow rule. This is the ONLY
 *     mechanism that gates destructive Bash everywhere.
 *
 * Posture (Codex T1 + #3 — fail-CLOSED, never hang):
 *   - destructive + interactive (default/acceptEdits/plan) → 'ask'  (prompt the human)
 *   - destructive + unattended (bypassPermissions / CLAUDE_AGENT_ID / CI) → 'deny'
 *     (structured denial; an interactive prompt in a headless loop would hang forever)
 *   - everything else → allow (empty output)
 *
 * Curated to HIGH blast radius + LOW false-positive so it does not gate routine
 * dev. Scans the whole command (catches compound `cd x && rm -rf y`) AFTER
 * stripping quoted-string contents, so destructive keywords inside a commit
 * message / echo / diagnostic do NOT false-trigger. Scope = UNQUOTED shell ops
 * (DB DROP/PowerShell Remove-Item are deliberately out — see note by the pattern list).
 * Fail-OPEN on any parse/logic error — a guard bug must never brick all Bash.
 * Override: prefix the command with SKIP_DESTRUCTIVE_GUARD=1 (detected in the
 * command string, since a PreToolUse hook does not inherit the command's env).
 */

interface HookInput {
  tool?: string;
  tool_name?: string;
  tool_input?: {
    command?: string;
    [key: string]: unknown;
  };
  permission_mode?: string;
  session_id?: string;
}

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'deny' | 'ask';
    permissionDecisionReason: string;
  };
}

// Each pattern is HIGH blast radius (irreversible / large scope) and chosen to
// avoid matching the safe everyday form (e.g. recursive rm only, not `rm -f file`;
// force-push only, not plain push; DB drops only inside a DB-CLI invocation).
interface DPattern { name: string; re: RegExp; }
const DESTRUCTIVE_PATTERNS: DPattern[] = [
  // filesystem — recursive/forced deletion only (single-file `rm -f x` is allowed)
  { name: 'recursive rm', re: /\brm\s+(-\w*r\w*|--recursive)/i },
  { name: 'find -delete', re: /\bfind\b[^&|;]*-delete\b/i },
  { name: 'find -exec rm', re: /\bfind\b[^&|;]*-exec\s+rm\b/i },
  { name: 'dd to/from device', re: /\bdd\s+[^&|;]*\b(if|of)=/i },
  { name: 'mkfs', re: /\bmkfs(\.\w+)?\b/i },
  { name: 'shred', re: /\bshred\b/i },
  { name: 'truncate to zero', re: /\btruncate\s+-s\s*0\b/i },
  { name: 'write to block device', re: /(?:>|of=)\s*\/dev\/(sd|nvme|disk|hd)/i },
  // git — history rewrite / working-tree or remote destruction
  { name: 'git reset --hard', re: /\bgit\s+reset\s+--hard\b/i },
  { name: 'git push --force', re: /\bgit\s+push\b[^&|;]*(--force(-with-lease)?|\s-f\b)/i },
  { name: 'git push --delete', re: /\bgit\s+push\b[^&|;]*(--delete|\s-d\b)/i },
  { name: 'git clean -f', re: /\bgit\s+clean\s+-\w*f/i },
  { name: 'git checkout discard', re: /\bgit\s+checkout\s+(--|\.)/i },
  { name: 'git branch -D', re: /\bgit\s+branch\s+(-D\b|--delete\s+--force|-\w*D\w*\s)/i },
  { name: 'git rebase', re: /\bgit\s+rebase\b/i },
  { name: 'git stash clear/drop', re: /\bgit\s+stash\s+(clear|drop)\b/i },
  { name: 'git update-ref -d', re: /\bgit\s+update-ref\s+-d\b/i },
  { name: 'git reflog expire', re: /\bgit\s+reflog\s+expire\b/i },
  { name: 'git gc --prune', re: /\bgit\s+gc\b[^&|;]*--prune/i },
  { name: 'git filter-branch/repo', re: /\bgit\s+filter-(branch|repo)\b/i },
  // docker — volume/image/system destruction
  { name: 'docker prune', re: /\bdocker\s+(system|volume|network|container|image)\s+prune\b/i },
  { name: 'docker volume rm', re: /\bdocker\s+volume\s+rm\b/i },
  { name: 'docker force rm', re: /\bdocker\s+(rm|rmi)\s+[^&|;]*-f\b/i },
];
// NOTE: DB drops (psql/sqlite3 -c "DROP TABLE …") and PowerShell Remove-Item are
// intentionally NOT gated here. Their payload is inherently inside quotes, which
// stripQuotedStrings() removes, and the same keywords appear constantly in
// migration commit messages — gating them produces more false-positives than
// value. Those destructive paths stay covered by: the settings deny rule
// (neonctl *delete*), the per-tool safety rules (neonctl/kusto/databases skills),
// and the human confirm-first convention. This Bash guard owns UNQUOTED shell ops.

/**
 * Strip quoted-string CONTENTS so destructive keywords that live inside a
 * commit message, echo arg, or other string literal don't false-trigger
 * (e.g. `git commit -m "... git reset --hard ..."`). Best-effort, non-nested:
 * handles "..." and '...' with backslash escapes. Real destructive commands
 * are unquoted (`rm -rf build`, `git push --force`) so they still match.
 * Known gap: a destructive op WRAPPED in `bash -c "rm -rf /"` is not seen — an
 * accepted trade-off (the dominant false-positive source is string literals;
 * accidental destruction is almost always a direct, unquoted command).
 */
export function stripQuotedStrings(command: string): string {
  return command
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/** Pure classifier — returns the first matching destructive pattern name, or null. */
export function classifyDestructive(command: string): string | null {
  if (!command || typeof command !== 'string') return null;
  const scan = stripQuotedStrings(command);
  for (const p of DESTRUCTIVE_PATTERNS) {
    if (p.re.test(scan)) return p.name;
  }
  return null;
}

/**
 * Unattended = no human is available to answer an interactive prompt.
 * In these contexts an 'ask' would hang forever, so destructive ops fail CLOSED
 * (deny). bypassPermissions is treated as unattended/yolo: even there, truly
 * destructive ops are blocked as a circuit breaker (overridable via SKIP env).
 */
export function isUnattended(input: HookInput, env: NodeJS.ProcessEnv = process.env): boolean {
  if (input.permission_mode === 'bypassPermissions') return true;
  if (env.CLAUDE_AGENT_ID) return true;          // subagent context
  if (env.CI === 'true' || env.CI === '1') return true;
  return false;
}

export type Decision = { decision: 'allow' | 'ask' | 'deny'; pattern?: string };

/**
 * Decide allow/ask/deny for a Bash command. Pure — easy to unit test.
 *
 * Override: a PreToolUse hook runs in its OWN process (Claude Code's env), so an
 * inline `SKIP_DESTRUCTIVE_GUARD=1 <cmd>` prefix does NOT reach env here — it
 * sets the var only for the command's subshell. So the override is detected in
 * the COMMAND STRING (the prefix the user actually types), with the env var kept
 * as a fallback in case the parent process exports it.
 */
export function decide(command: string, input: HookInput, env: NodeJS.ProcessEnv = process.env): Decision {
  if (env.SKIP_DESTRUCTIVE_GUARD === '1' || /\bSKIP_DESTRUCTIVE_GUARD=1\b/.test(command)) {
    return { decision: 'allow' };
  }
  const pattern = classifyDestructive(command);
  if (!pattern) return { decision: 'allow' };
  return { decision: isUnattended(input, env) ? 'deny' : 'ask', pattern };
}

function reasonFor(decision: 'ask' | 'deny', pattern: string, command: string): string {
  const head = decision === 'deny'
    ? `BLOCKED (fail-closed): destructive command in an unattended/bypass context`
    : `CONFIRM: this is a destructive command`;
  return `${head}\n\nMatched: ${pattern}\nCommand: ${command.slice(0, 300)}\n\n${
    decision === 'deny'
      ? `An interactive confirmation would hang a headless/autonomous run, so this is denied. If you genuinely intend it here, re-run with SKIP_DESTRUCTIVE_GUARD=1 prefixed, or run it interactively.`
      : `Approve only if you intend this irreversible operation. (Gate: destructive-command-guard; see ~/.claude/rules/destructive-commands.md.)`
  }`;
}

async function main(): Promise<void> {
  let input: HookInput = {};
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (raw) input = JSON.parse(raw);
  } catch {
    console.log('{}'); // fail-open on malformed input
    return;
  }

  const tool = input.tool || input.tool_name;
  if (tool !== 'Bash') { console.log('{}'); return; }

  const command = input.tool_input?.command;
  if (typeof command !== 'string' || !command.trim()) { console.log('{}'); return; }

  const { decision, pattern } = decide(command, input);
  if (decision === 'allow' || !pattern) { console.log('{}'); return; }

  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reasonFor(decision, pattern, command),
    },
  };
  console.log(JSON.stringify(output));
}

// Auto-run only as a hook; VITEST imports the pure functions above.
if (!process.env.VITEST) {
  main().catch(() => {
    console.log('{}'); // fail-open: a guard crash must never brick Bash
  });
}
