#!/usr/bin/env node
/**
 * merge-settings.mjs — re-apply your personal Claude Code settings on top of
 * the ones the setup wizard generates.
 *
 * WHY THIS EXISTS
 * The wizard writes ~/.claude/settings.json unconditionally (no exists-check,
 * see opc/scripts/setup/claude_integration.py). That file is where the ~73 hook
 * registrations live, so it genuinely does need to be rewritten — but it is also
 * where your model, theme, voice, plugin, and env preferences live. Straight
 * overwrite loses them.
 *
 * USAGE
 *   # 1. snapshot what you have now
 *   cp ~/.claude/settings.json ~/.claude/settings.json.mine
 *
 *   # 2. let the wizard do its thing (it overwrites settings.json)
 *   cd opc && uv run python -m scripts.setup.wizard
 *
 *   # 3. layer your preferences back on
 *   node scripts/merge-settings.mjs \
 *     --mine ~/.claude/settings.json.mine \
 *     --theirs ~/.claude/settings.json \
 *     --out ~/.claude/settings.json
 *
 *   Add --dry-run to print the result without writing.
 *
 * Re-runnable: safe to run again after any future wizard re-run.
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// MERGE POLICY
// Edit these lists to change who wins. This is the whole decision surface.
// ---------------------------------------------------------------------------

/**
 * Keys where YOUR value replaces the wizard's outright if you have one.
 * `enabledPlugins` is here rather than in DEEP_MERGE on purpose: a deep merge
 * would silently re-add the wizard's claude-hud / braintrust entries, which
 * aren't installed on this machine.
 */
const YOURS_WINS = [
  'model',
  'effortLevel',
  'theme',
  'tui',
  'voice',
  'voiceEnabled',
  'autoDreamEnabled',
  'enabledPlugins',
  // Also in REFUSE below. REFUSE drops the wizard's value; this restores yours
  // if you have one. Order matters — REFUSE runs first, this runs after.
  'statusLine',
  'alwaysThinkingEnabled',
  'autoCompact',
];

/**
 * Keys deep-merged key-by-key, with YOUR value winning on a per-key collision.
 * Only `env`: the wizard contributes CLAUDE_OPC_DIR / DATABASE_URL that the
 * memory system needs, and you contribute your own vars. Both are required.
 */
const DEEP_MERGE = ['env'];

/**
 * Keys the framework must own for its hooks to work at all. Yours is discarded
 * for these — except `hooks`, which is concatenated (see mergeHooks).
 */
const THEIRS_WINS = ['allowedTools'];

/**
 * Never adopted FROM THE WIZARD, even though the template sets them. Each is a
 * deliberate posture choice rather than a default. If you set the same key
 * yourself it is still honoured (see YOURS_WINS above).
 * Comment a line out to start accepting the wizard's value for that key.
 */
const REFUSE = [
  'skipDangerousModePermissionPrompt', // suppresses the dangerous-mode confirm prompt
  'statusLine', // points at claude-hud, not installed here — would error every render
  'mcpServers', // 10 servers; firecrawl/morph/perplexity/nia need API keys to connect
  'autoCompact', // wizard sets false; only safe once its continuity system is running
  'alwaysThinkingEnabled', // leave at your current default
];

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--mine') args.mine = argv[++i];
    else if (a === '--theirs') args.theirs = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown option: ${a}`);
  }
  return args;
}

function readJson(p, label) {
  const resolved = p.replace(/^~/, process.env.HOME ?? '');
  if (!fs.existsSync(resolved)) throw new Error(`${label} not found: ${resolved}`);
  try {
    return { data: JSON.parse(fs.readFileSync(resolved, 'utf8')), path: resolved };
  } catch (e) {
    throw new Error(`${label} is not valid JSON (${resolved}): ${e.message}`);
  }
}

/**
 * Hooks are ADDITIVE, not either/or. The framework's hooks and yours target
 * different concerns and can both run — so per event we keep every framework
 * matcher group and append yours after them. Yours running last means the
 * framework's context-injection has already happened by the time yours fires.
 */
function mergeHooks(mine = {}, theirs = {}) {
  const out = {};
  const events = new Set([...Object.keys(theirs), ...Object.keys(mine)]);
  for (const ev of events) {
    const theirGroups = Array.isArray(theirs[ev]) ? theirs[ev] : [];
    const myGroups = Array.isArray(mine[ev]) ? mine[ev] : [];

    // Drop any of my groups that are byte-identical to a framework group,
    // so re-running this script never stacks duplicates.
    const seen = new Set(theirGroups.map((g) => JSON.stringify(g)));
    const mineDeduped = myGroups.filter((g) => !seen.has(JSON.stringify(g)));

    out[ev] = [...theirGroups, ...mineDeduped];
  }
  return out;
}

function merge(mine, theirs) {
  const out = { ...theirs };
  const notes = [];

  for (const k of REFUSE) {
    if (k in out) {
      delete out[k];
      // If you set the same key yourself, YOURS_WINS restores it below — so say
      // "wizard value dropped", not "refused", which would misreport the result.
      notes.push(k in mine ? `dropped   ${k} (wizard's; yours restored below)` : `refused   ${k}`);
    }
  }

  for (const k of DEEP_MERGE) {
    if (mine[k] || out[k]) {
      const merged = { ...(out[k] ?? {}), ...(mine[k] ?? {}) };
      const overridden = Object.keys(mine[k] ?? {}).filter(
        (sub) => out[k] && sub in out[k] && JSON.stringify(out[k][sub]) !== JSON.stringify(mine[k][sub]),
      );
      out[k] = merged;
      notes.push(
        `merged    ${k} (${Object.keys(merged).length} keys` +
          (overridden.length ? `, yours won on: ${overridden.join(', ')}` : '') +
          ')',
      );
    }
  }

  for (const k of YOURS_WINS) {
    if (k in mine) {
      const changed = k in out && JSON.stringify(out[k]) !== JSON.stringify(mine[k]);
      out[k] = mine[k];
      notes.push(`yours     ${k}${changed ? ` (overrode wizard value)` : ''}`);
    }
  }

  for (const k of THEIRS_WINS) {
    if (k in mine && !(k in out)) out[k] = mine[k];
  }

  out.hooks = mergeHooks(mine.hooks, theirs.hooks);
  const count = (h) => Object.values(h ?? {}).flat().reduce((a, g) => a + (g.hooks?.length ?? 0), 0);
  notes.push(`hooks     ${count(theirs.hooks)} framework + ${count(mine.hooks)} yours = ${count(out.hooks)} total`);

  // Anything of yours the policy lists never mentioned — keep it rather than drop it.
  for (const k of Object.keys(mine)) {
    if (k === 'hooks') continue;
    if (YOURS_WINS.includes(k) || DEEP_MERGE.includes(k) || THEIRS_WINS.includes(k) || REFUSE.includes(k)) continue;
    if (!(k in out)) {
      out[k] = mine[k];
      notes.push(`kept      ${k} (yours; not in wizard output)`);
    }
  }

  return { out, notes };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.mine || !args.theirs) {
    console.log('usage: merge-settings.mjs --mine <your-backup.json> --theirs <wizard-output.json> [--out <path>] [--dry-run]');
    process.exit(args.help ? 0 : 1);
  }

  const mine = readJson(args.mine, 'your settings');
  const theirs = readJson(args.theirs, 'wizard settings');
  const { out, notes } = merge(mine.data, theirs.data);

  console.log('merge plan:');
  for (const n of notes) console.log('  ' + n);

  const json = JSON.stringify(out, null, 2) + '\n';

  if (args.dryRun || !args.out) {
    console.log('\n--- result (not written) ---');
    console.log(json);
    return;
  }

  const outPath = args.out.replace(/^~/, process.env.HOME ?? '');
  // Back up whatever is currently at the destination before clobbering it.
  if (fs.existsSync(outPath)) {
    const bak = `${outPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(outPath, bak);
    console.log(`\nbacked up existing -> ${path.basename(bak)}`);
  }
  fs.writeFileSync(outPath, json);
  console.log(`wrote ${outPath}`);
}

main();
