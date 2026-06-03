#!/usr/bin/env node
/**
 * code-intel-enforcer -- PreToolUse (Grep | Agent). WS-2 Phase B (B.5).
 *
 * DEFAULT OFF. Even when enabled it NEVER denies -- it only emits a non-blocking
 * `additionalContext` nudge toward the /code-intel facade. This ships INERT (E1: adoption
 * != quality); the enforcer exists so routing-through-the-facade CAN be encouraged later
 * without a new hook.
 *
 * Activation: process.env.CCV3_FACADE_MODE.
 *   - unset / empty            -> {} (allow, no output). The default.
 *   - "warn"                   -> warn-only: emit additionalContext on an EXACT route match.
 *   - any other (invalid) value -> treated as OFF (fail-open), {} returned.
 *
 * Matching is EXACT/STRUCTURAL, not fuzzy (plan #10):
 *   - Grep: a pattern that is clearly a SYMBOL-DEFINITION hunt (`function NAME`, `def NAME`,
 *     `class NAME`) -> nudge `/code-intel find-symbol <NAME>`. Nothing else in Grep matches.
 *   - Agent: registered for forward-compat but intentionally PASSIVE -- a free-form agent
 *     prompt has no exact structural route signal, so we do NOT fuzzy-match it (returns {}).
 *
 * G6 (never point at an archived skill): the ONLY skill this nudge references is `/code-intel`,
 * which is live (added this phase). No archived skill can be named.
 *
 * Fail-open: any parse/logic error -> {} (allow). Honors CCV3_BUS_OFF only insofar as it never
 * touches the bus; it reads no disk and writes no state.
 */

interface HookInput {
  tool?: string;
  tool_name?: string;
  tool_input?: {
    pattern?: string;
    [key: string]: unknown;
  };
}

interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
  };
}

/** Recognized activation modes. Anything else -> OFF. */
function facadeMode(): 'off' | 'warn' {
  const raw = (process.env.CCV3_FACADE_MODE || '').trim().toLowerCase();
  return raw === 'warn' ? 'warn' : 'off';
}

/**
 * Exact structural match for a Grep symbol-DEFINITION hunt. Returns the symbol name to
 * suggest, or null. Deliberately narrow: only `function NAME` / `def NAME` / `class NAME`
 * (optionally with regex anchors/whitespace tokens around them). A plain text grep does
 * NOT match -- this is a route signal, not a heuristic.
 */
function grepSymbolTarget(pattern: string | undefined): string | null {
  if (!pattern || typeof pattern !== 'string') return null;
  // `\b` before the keyword prevents false positives where the keyword is a substring of a
  // larger word (`myclass Widget`, `subclass Foo`, `defunct foo` -- cross-model review F2/M1).
  // Keyword, then real whitespace, then an identifier. (We deliberately do NOT try to match a
  // literal `\s` regex-token form like `function\s+bar`: it is a rare grep shape and the
  // escaping is error-prone -- linear, ReDoS-safe, and exact this way.)
  const m = pattern.match(/\b(?:function|def|class)\s+([A-Za-z_]\w*)/);
  return m ? m[1] : null;
}

function noop(): HookOutput {
  return {};
}

// NOTE (cross-model review H1): the nudge uses `additionalContext`. If a future Claude Code
// drops additionalContext on PreToolUse events, this becomes a silent no-op -- at which point
// switch to `permissionDecision: 'allow'` + `permissionDecisionReason: message` (the confirmed
// non-blocking PreToolUse channel). It must NEVER become 'deny'. Deferred: the enforcer ships
// inert (default OFF) and is adopted later (E1), so the channel choice is revisited at adoption.
function nudge(message: string): HookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: message,
    },
  };
}

export function evaluate(input: HookInput): HookOutput {
  if (facadeMode() === 'off') return noop();

  const tool = input.tool || input.tool_name;

  // Grep: only a clear symbol-definition search is an exact route match.
  if (tool === 'Grep') {
    const sym = grepSymbolTarget(input.tool_input?.pattern);
    if (sym) {
      return nudge(
        `[code-intel] This looks like a symbol-definition search for '${sym}'. ` +
          `Consider \`node scripts/code-intel.mjs find-symbol ${sym}\` (broad, FTS-first; ` +
          `escalate to Serena find_symbol for precise identity). This is a non-blocking suggestion.`,
      );
    }
    return noop();
  }

  // Agent: registered for forward-compat but intentionally passive (no exact structural signal).
  return noop();
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);

  let input: HookInput = {};
  try {
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    if (raw) input = JSON.parse(raw);
  } catch {
    console.log('{}');
    return;
  }

  try {
    console.log(JSON.stringify(evaluate(input)));
  } catch {
    console.log('{}');
  }
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && process.argv[1].includes('code-intel-enforcer')) {
  main().catch(() => console.log('{}'));
}
