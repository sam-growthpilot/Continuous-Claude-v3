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
  // filesystem — recursive deletion only (single-file `rm -f x` is allowed).
  // Scans across SPLIT flag tokens so `rm -f -r x` / `rm --force --recursive x`
  // are caught, not just `rm -rf` (F3: the prior /-\w*r\w*/ only saw the 1st flag).
  { name: 'recursive rm', re: /\brm(?:\s+-{1,2}[^\s]+)*\s+-{1,2}[^\s]*[rR][^\s]*/i },
  { name: 'find -delete', re: /\bfind\b[^&|;]*-delete\b/i },
  { name: 'find -exec rm', re: /\bfind\b[^&|;]*-exec\s+rm\b/i },
  // bulk delete via xargs — e.g. `find … | xargs rm`. Catches the non-recursive
  // form too (plain `xargs rm`), which the recursive-rm pattern alone misses.
  { name: 'xargs rm', re: /\bxargs\b[^|&;]*\brm\b/i },
  { name: 'dd to/from device', re: /\bdd\s+[^&|;]*\b(if|of)=/i },
  { name: 'mkfs', re: /\bmkfs(\.\w+)?\b/i },
  { name: 'shred', re: /\bshred\b/i },
  { name: 'truncate to zero', re: /\btruncate\s+-s\s*0\b/i },
  { name: 'write to block device', re: /(?:>|of=)\s*\/dev\/(sd|nvme|disk|hd)/i },
  // git — history rewrite / working-tree or remote destruction
  { name: 'git reset --hard', re: /\bgit\s+reset\s+--hard\b/i },
  { name: 'git push --force', re: /\bgit\s+push\b[^&|;]*(--force(-with-lease)?|\s-f\b)/i },
  { name: 'git push --delete', re: /\bgit\s+push\b[^&|;]*(--delete|\s-d\b)/i },
  { name: 'git clean -f', re: /\bgit\s+clean(?:\s+-{1,2}[^\s]+)*\s+-{1,2}[^\s]*f[^\s]*/i },
  { name: 'git checkout discard', re: /\bgit\s+checkout\s+(--|\.)/i },
  { name: 'git branch -D', re: /\bgit\s+branch\s+(-D\b|--delete\s+--force|--force\s+--delete|-\w*D\w*\s)/i },
  { name: 'git rebase', re: /\bgit\s+rebase\b/i },
  { name: 'git stash clear/drop', re: /\bgit\s+stash\s+(clear|drop)\b/i },
  { name: 'git update-ref -d', re: /\bgit\s+update-ref\s+-d\b/i },
  { name: 'git reflog expire', re: /\bgit\s+reflog\s+expire\b/i },
  { name: 'git gc --prune', re: /\bgit\s+gc\b[^&|;]*--prune/i },
  { name: 'git filter-branch/repo', re: /\bgit\s+filter-(branch|repo)\b/i },
  // docker — volume/image/system destruction
  { name: 'docker prune', re: /\bdocker\s+(system|volume|network|container|image)\s+prune\b/i },
  { name: 'docker volume rm', re: /\bdocker\s+volume\s+rm\b/i },
  { name: 'docker force rm', re: /\bdocker\s+(rm|rmi)\s+[^&|;]*(--force|-f\b|-\w*f\b)/i },
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
 * NOTE: this strip is for the TOP-LEVEL scan only. A destructive op WRAPPED in
 * `bash -c "rm -rf /"` or hidden in a command substitution `"$(rm -rf x)"` /
 * `` "`rm -rf x`" `` is NO LONGER a blind spot (Phase 1b): classifyDestructive
 * separately recurses into executable payloads via parseExecutable, so those
 * match too — while quoted MESSAGE text (not at a command position, or in single
 * quotes) still does not false-trigger.
 */
export function stripQuotedStrings(command: string): string {
  return command
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/**
 * Quote-aware parse of a shell command into the pieces bash would actually
 * EXECUTE, so the classifier can recurse into payloads stripQuotedStrings would
 * otherwise hide (the documented blind spot). Returns:
 *   - segments: top-level command segments, split on UNQUOTED ; && || | & and
 *     newlines (quotes preserved). A shell-wrapper (bash -c "...") is treated as
 *     real only when it BEGINS a segment, so "bash -c ..." text inside a
 *     -m "..." message (not at a segment start) is not mistaken for an invocation.
 *   - substitutions: contents of $(...) and `...` that bash WOULD run -- i.e.
 *     those NOT inside single quotes (top-level and double-quoted substitutions
 *     execute; single-quoted are literal). Catches the commit-message backtick
 *     incident class: git commit -m "... `rm -rf x` ...".
 * Best-effort + defensive; callers wrap this and fail OPEN on any error.
 */
export function parseExecutable(command: string): { segments: string[]; substitutions: string[] } {
  const segments: string[] = [];
  const substitutions: string[] = [];
  let seg = '';
  let inSingle = false;
  let inDouble = false;
  const n = command.length;
  let i = 0;
  const pushSeg = () => { const t = seg.trim(); if (t) segments.push(t); seg = ''; };

  while (i < n) {
    const c = command[i];
    const next = command[i + 1];

    if (inSingle) {
      seg += c;
      if (c === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '\\' && next !== undefined) { seg += c + next; i += 2; continue; }
      if (c === '"') { inDouble = false; seg += c; i++; continue; }
      if (c === '$' && next === '(') {
        const { inner, end } = readBalanced(command, i + 2, '(', ')');
        substitutions.push(inner);
        seg += command.slice(i, end); i = end; continue;
      }
      if (c === '`') {
        const { inner, end } = readBacktick(command, i + 1);
        substitutions.push(inner);
        seg += command.slice(i, end); i = end; continue;
      }
      seg += c; i++;
      continue;
    }
    // top level (unquoted)
    if (c === '\\' && next !== undefined) { seg += c + next; i += 2; continue; }
    if (c === "'") { inSingle = true; seg += c; i++; continue; }
    if (c === '"') { inDouble = true; seg += c; i++; continue; }
    if (c === '$' && next === '(') {
      const { inner, end } = readBalanced(command, i + 2, '(', ')');
      substitutions.push(inner);
      seg += command.slice(i, end); i = end; continue;
    }
    if (c === '`') {
      const { inner, end } = readBacktick(command, i + 1);
      substitutions.push(inner);
      seg += command.slice(i, end); i = end; continue;
    }
    if (c === ';' || c === '\n') { pushSeg(); i++; continue; }
    if ((c === '&' && next === '&') || (c === '|' && next === '|')) { pushSeg(); i += 2; continue; }
    if (c === '|' || c === '&') { pushSeg(); i++; continue; }
    seg += c; i++;
  }
  pushSeg();
  return { segments, substitutions };
}

/** Read until the matching close of a $(...) group (quote- and nesting-aware). */
function readBalanced(s: string, start: number, open: string, close: string): { inner: string; end: number } {
  let depth = 1;
  let i = start;
  let inS = false;
  let inD = false;
  while (i < s.length) {
    const c = s[i];
    if (inS) { if (c === "'") inS = false; i++; continue; }
    if (inD) { if (c === '\\') { i += 2; continue; } if (c === '"') inD = false; i++; continue; }
    if (c === "'") { inS = true; i++; continue; }
    if (c === '"') { inD = true; i++; continue; }
    if (c === '$' && s[i + 1] === open) { depth++; i += 2; continue; }
    if (c === open) { depth++; i++; continue; }
    if (c === close) { depth--; if (depth === 0) return { inner: s.slice(start, i), end: i + 1 }; i++; continue; }
    i++;
  }
  return { inner: s.slice(start), end: s.length };
}

/** Read until the matching closing backtick. */
function readBacktick(s: string, start: number): { inner: string; end: number } {
  let i = start;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === '`') return { inner: s.slice(start, i), end: i + 1 };
    i++;
  }
  return { inner: s.slice(start), end: s.length };
}

// A shell-wrapper at a COMMAND POSITION: a segment that, after optional
// sudo/env/VAR= prefixes, begins with a shell interpreter invoked with an exec
// flag whose flag-cluster ends in the exec letter (-c / -lc / -Command / /c).
// The payload is the following quoted string (or rest-of-segment). [^'"]*? skips
// intermediate flags but stops before the payload's opening quote.
const WRAPPER_RES: RegExp[] = [
  // POSIX shells: bash|sh|zsh|dash|ksh|ash ... -c|-...c "<payload>"
  /^(?:(?:sudo|env|nohup|time)\s+|[^\s=]+=\S+\s+)*(?:bash|sh|zsh|dash|ksh|ash)\b[^'"]*?\s-[a-z]*c\b\s*("(?:[^"\\]|\\.)*"|'[^']*'|\S.*)$/i,
  // PowerShell: powershell|pwsh ... -c|-Command "<payload>"
  /^(?:(?:sudo|env)\s+)?(?:powershell|pwsh)(?:\.exe)?\b[^'"]*?\s-c(?:ommand)?\b\s*("(?:[^"\\]|\\.)*"|'[^']*'|\S.*)$/i,
  // cmd: cmd[.exe] /c|/k "<payload>"
  /^(?:(?:sudo|env)\s+)?cmd(?:\.exe)?\b[^'"]*?\s\/[ck]\b\s*("(?:[^"\\]|\\.)*"|'[^']*'|\S.*)$/i,
];

function unwrapPayload(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.replace(/\\(["'`$\\])/g, '$1');
}

function wrapperPayloadsFromSegments(segments: string[]): string[] {
  const out: string[] = [];
  for (const seg of segments) {
    for (const re of WRAPPER_RES) {
      const m = seg.match(re);
      if (m && m[1]) { out.push(unwrapPayload(m[1])); break; }
    }
  }
  return out;
}

/**
 * Payloads of shell-wrapper invocations (bash -c "...", powershell -Command
 * "...", cmd /c "...") found at a command position. These are commands the
 * wrapper will execute, so classifyDestructive recurses into them.
 */
export function extractShellWrapperPayloads(command: string): string[] {
  try { return wrapperPayloadsFromSegments(parseExecutable(command).segments); }
  catch { return []; }
}

/**
 * Pure classifier -- returns the first matching destructive pattern name, or null.
 * Scans the quote-stripped top-level command, then RECURSES into executable
 * payloads it would otherwise miss: shell-wrapper bodies (bash -c "...") and
 * command substitutions ($()/backticks bash executes). Depth-bounded; fail-open.
 */
export function classifyDestructive(command: string, depth = 0): string | null {
  if (!command || typeof command !== 'string') return null;
  const scan = stripQuotedStrings(command);
  for (const p of DESTRUCTIVE_PATTERNS) {
    if (p.re.test(scan)) return p.name;
  }
  if (depth < 4) {
    try {
      const { segments, substitutions } = parseExecutable(command);
      const payloads = [...wrapperPayloadsFromSegments(segments), ...substitutions];
      for (const payload of payloads) {
        const inner = classifyDestructive(payload, depth + 1);
        if (inner) return inner;
      }
    } catch {
      // fail-open: a parser hiccup must never brick the guard
    }
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
  // F2: the override is only honored as a LEADING command prefix (the env-var
  // form the user actually types), NOT as a substring anywhere — otherwise
  // `echo SKIP_DESTRUCTIVE_GUARD=1 && rm -rf x` would disable the guard.
  if (env.SKIP_DESTRUCTIVE_GUARD === '1' || /^\s*SKIP_DESTRUCTIVE_GUARD=1\s+/.test(command)) {
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
