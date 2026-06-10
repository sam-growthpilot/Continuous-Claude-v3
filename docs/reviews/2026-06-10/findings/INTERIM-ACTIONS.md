# Interim Actions Taken During the Review (pre-G-B carve-outs)

Actions executed DURING the read-only review arc under explicit user authorization,
recorded here so WF-2 refuters and the WF-3 synthesis account for them. The frozen
finding JSON files (`D*.json`) are NOT mutated — verify content at the frozen review
SHA `86b8f60` as planned.

## 1. D2a-01 — navigator-safety deregistered (2026-06-10)

**Finding:** `D2a-01` (D2a.json) — S1. `navigator-safety.ts` emits
`permissionDecision: 'allow'` when a Bash command matches its DESTRUCTIVE_PATTERNS
(`rm`, `git reset --hard`, `git push -f/--force`, `DROP TABLE`, `TRUNCATE`,
`DELETE FROM`). In PreToolUse semantics, `'allow'` AUTO-APPROVES the tool call and
SUPPRESSES the user permission prompt — so the hook auto-approved exactly the
destructive commands it was written to warn about. Its docstring claims it
"Does NOT block — surfaces rule for Claude's consideration", but the reason string
goes to the **user**, not Claude, and the prompt the user would have seen is gone.

**Verification (spot pass, 2026-06-10):** read `.claude/hooks/src/navigator-safety.ts`
`main()` (lines ~149-184) — non-destructive path emits `outputContinue()` (neutral);
destructive path emits `hookSpecificOutput.permissionDecision: 'allow'` with the
warning as `permissionDecisionReason`. Reachability: registered live as
PreToolUse/Bash in BOTH repo `.claude/settings.json` and active
`~/.claude/settings.json`. Confirmed safety inversion — not a doc nit.

**Action (user-authorized carve-out: "take care of this now ... deregister it
immediately rather than wait for the fix arc"):**
- Removed the navigator-safety registration from repo `.claude/settings.json`
  AND active `~/.claude/settings.json` (Node atomic read-modify-write; 1 entry
  removed from each; verified 0 remaining references in both).
- Source file `.claude/hooks/src/navigator-safety.ts` (and its dist build) is
  RETAINED on disk for the Phase 4 fix arc.

**Effect of deregistration:** destructive Bash commands now flow through Claude
Code's NORMAL permission prompt (the default when no hook decides) — strictly
safer than the hook's behavior. Nothing else consumed this hook.

**Fix-arc backlog item (Phase 4, pre-seeded):** rewrite navigator-safety to either
(a) `permissionDecision: 'ask'` with the rule text as the reason — forces the
prompt and shows the warning, or (b) drop the permissionDecision entirely and emit
the rule via PostToolUse `additionalContext` so Claude (not the user) sees it.
Re-register only after a vitest case asserts the destructive path NEVER emits
`'allow'`.

**Note for WF-2:** verify D2a-01 against the frozen SHA as normal (the source is
unchanged). Reachability evidence for the *pre-action* state is the settings.json
at the frozen review SHA `86b8f60`; the post-action state (deregistered) is the
commit carrying this file. CONFIRM should stand with a `mitigated: deregistered 2026-06-10`
annotation rather than a downgrade — the root cause (the source file) is not yet
fixed.
