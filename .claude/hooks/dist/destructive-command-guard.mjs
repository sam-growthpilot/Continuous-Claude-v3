#!/usr/bin/env node

// src/destructive-command-guard.ts
var DESTRUCTIVE_PATTERNS = [
  // filesystem — recursive/forced deletion only (single-file `rm -f x` is allowed)
  { name: "recursive rm", re: /\brm\s+(-\w*r\w*|--recursive)/i },
  { name: "find -delete", re: /\bfind\b[^&|;]*-delete\b/i },
  { name: "find -exec rm", re: /\bfind\b[^&|;]*-exec\s+rm\b/i },
  { name: "dd to/from device", re: /\bdd\s+[^&|;]*\b(if|of)=/i },
  { name: "mkfs", re: /\bmkfs(\.\w+)?\b/i },
  { name: "shred", re: /\bshred\b/i },
  { name: "truncate to zero", re: /\btruncate\s+-s\s*0\b/i },
  { name: "write to block device", re: /(?:>|of=)\s*\/dev\/(sd|nvme|disk|hd)/i },
  // git — history rewrite / working-tree or remote destruction
  { name: "git reset --hard", re: /\bgit\s+reset\s+--hard\b/i },
  { name: "git push --force", re: /\bgit\s+push\b[^&|;]*(--force(-with-lease)?|\s-f\b)/i },
  { name: "git push --delete", re: /\bgit\s+push\b[^&|;]*(--delete|\s-d\b)/i },
  { name: "git clean -f", re: /\bgit\s+clean\s+-\w*f/i },
  { name: "git checkout discard", re: /\bgit\s+checkout\s+(--|\.)/i },
  { name: "git branch -D", re: /\bgit\s+branch\s+(-D\b|--delete\s+--force|-\w*D\w*\s)/i },
  { name: "git rebase", re: /\bgit\s+rebase\b/i },
  { name: "git stash clear/drop", re: /\bgit\s+stash\s+(clear|drop)\b/i },
  { name: "git update-ref -d", re: /\bgit\s+update-ref\s+-d\b/i },
  { name: "git reflog expire", re: /\bgit\s+reflog\s+expire\b/i },
  { name: "git gc --prune", re: /\bgit\s+gc\b[^&|;]*--prune/i },
  { name: "git filter-branch/repo", re: /\bgit\s+filter-(branch|repo)\b/i },
  // docker — volume/image/system destruction
  { name: "docker prune", re: /\bdocker\s+(system|volume|network|container|image)\s+prune\b/i },
  { name: "docker volume rm", re: /\bdocker\s+volume\s+rm\b/i },
  { name: "docker force rm", re: /\bdocker\s+(rm|rmi)\s+[^&|;]*-f\b/i }
];
function stripQuotedStrings(command) {
  return command.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
}
function classifyDestructive(command) {
  if (!command || typeof command !== "string") return null;
  const scan = stripQuotedStrings(command);
  for (const p of DESTRUCTIVE_PATTERNS) {
    if (p.re.test(scan)) return p.name;
  }
  return null;
}
function isUnattended(input, env = process.env) {
  if (input.permission_mode === "bypassPermissions") return true;
  if (env.CLAUDE_AGENT_ID) return true;
  if (env.CI === "true" || env.CI === "1") return true;
  return false;
}
function decide(command, input, env = process.env) {
  if (env.SKIP_DESTRUCTIVE_GUARD === "1" || /\bSKIP_DESTRUCTIVE_GUARD=1\b/.test(command)) {
    return { decision: "allow" };
  }
  const pattern = classifyDestructive(command);
  if (!pattern) return { decision: "allow" };
  return { decision: isUnattended(input, env) ? "deny" : "ask", pattern };
}
function reasonFor(decision, pattern, command) {
  const head = decision === "deny" ? `BLOCKED (fail-closed): destructive command in an unattended/bypass context` : `CONFIRM: this is a destructive command`;
  return `${head}

Matched: ${pattern}
Command: ${command.slice(0, 300)}

${decision === "deny" ? `An interactive confirmation would hang a headless/autonomous run, so this is denied. If you genuinely intend it here, re-run with SKIP_DESTRUCTIVE_GUARD=1 prefixed, or run it interactively.` : `Approve only if you intend this irreversible operation. (Gate: destructive-command-guard; see ~/.claude/rules/destructive-commands.md.)`}`;
}
async function main() {
  let input = {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    const raw = Buffer.concat(chunks).toString("utf-8").trim();
    if (raw) input = JSON.parse(raw);
  } catch {
    console.log("{}");
    return;
  }
  const tool = input.tool || input.tool_name;
  if (tool !== "Bash") {
    console.log("{}");
    return;
  }
  const command = input.tool_input?.command;
  if (typeof command !== "string" || !command.trim()) {
    console.log("{}");
    return;
  }
  const { decision, pattern } = decide(command, input);
  if (decision === "allow" || !pattern) {
    console.log("{}");
    return;
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reasonFor(decision, pattern, command)
    }
  };
  console.log(JSON.stringify(output));
}
if (!process.env.VITEST) {
  main().catch(() => {
    console.log("{}");
  });
}
export {
  classifyDestructive,
  decide,
  isUnattended,
  stripQuotedStrings
};
