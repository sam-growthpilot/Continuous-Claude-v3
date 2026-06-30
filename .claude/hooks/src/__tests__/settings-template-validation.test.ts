/**
 * settings.json.template validation (Phase 2 / SG-02, Codex #7)
 *
 * A broken template is invisible on the build machine but bricks every fresh
 * install (a hook command pointing at a missing .mjs throws MODULE_NOT_FOUND on
 * each matching tool call). This guard asserts:
 *  - the template is valid JSON
 *  - every {{CLAUDE_HOME}}/hooks/dist/<name>.mjs it registers exists in repo dist
 *  - the 5 deregistered (stale) hooks are no longer registered
 *  - the universal hooks promoted in Phase 2 are present
 *  - no stray {{PLACEHOLDER}} other than {{CLAUDE_HOME}} survives
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));      // .claude/hooks/src/__tests__
const claudeDir = path.resolve(here, '../../../');               // .claude
const distDir = path.resolve(here, '../../dist');                // .claude/hooks/dist
const tplPath = path.join(claudeDir, 'settings.json.template');

function templateHookNames(): string[] {
  const s = JSON.parse(readFileSync(tplPath, 'utf8'));
  const names: string[] = [];
  for (const evt of Object.keys(s.hooks || {})) {
    for (const b of s.hooks[evt]) {
      for (const h of b.hooks || []) {
        const m = (h.command || '').match(/dist\/([\w-]+)\.mjs/);
        if (m) names.push(m[1]);
      }
    }
  }
  return names;
}

/** Map each registered hook name -> the set of "event::matcher" it's registered under. */
function templateHookRegistrations(): Map<string, Set<string>> {
  const s = JSON.parse(readFileSync(tplPath, 'utf8'));
  const reg = new Map<string, Set<string>>();
  for (const evt of Object.keys(s.hooks || {})) {
    for (const b of s.hooks[evt]) {
      const matcher = b.matcher ?? '';
      for (const h of b.hooks || []) {
        const m = (h.command || '').match(/dist\/([\w-]+)\.mjs/);
        if (!m) continue;
        if (!reg.has(m[1])) reg.set(m[1], new Set());
        reg.get(m[1])!.add(`${evt}::${matcher}`);
      }
    }
  }
  return reg;
}

describe('settings.json.template', () => {
  it('is valid JSON', () => {
    expect(() => JSON.parse(readFileSync(tplPath, 'utf8'))).not.toThrow();
  });

  it('every registered hook dist exists in repo (no fresh-install MODULE_NOT_FOUND)', () => {
    const missing = templateHookNames().filter((n) => !existsSync(path.join(distDir, `${n}.mjs`)));
    expect(missing).toEqual([]);
  });

  it('does not register the 5 deregistered (stale) hooks', () => {
    const names = new Set(templateHookNames());
    for (const stale of ['auto-build', 'navigator-safety', 'pageindex-navigator', 'periodic-extract', 'sync-to-repo']) {
      expect(names.has(stale)).toBe(false);
    }
  });

  it('registers the Phase-2 universal hooks (incl. the safety guards)', () => {
    const names = new Set(templateHookNames());
    for (const want of ['destructive-command-guard', 'package-install-guard', 'post-edit-diagnostics', 'agent-recall-injector', 'telemetry-tracker', 'session-start-memory-loaders']) {
      expect(names.has(want)).toBe(true);
    }
  });

  it('contains only known wizard placeholders ({{CLAUDE_HOME}}, {{OPC_DIR}})', () => {
    const raw = readFileSync(tplPath, 'utf8');
    const known = new Set(['CLAUDE_HOME', 'OPC_DIR']); // substituted by wizard.py
    const placeholders = [...raw.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]);
    const stray = [...new Set(placeholders.filter((p) => !known.has(p)))];
    expect(stray).toEqual([]);
  });

  it('registers key hooks under the CORRECT event + matcher (not just dist-exists)', () => {
    // Verified against the template 2026-06-29. A hook silently moved to the wrong
    // event/matcher (the QW-04 Agent->Task matcher flip reverted, or a Bash guard
    // losing its Bash matcher) passes the dist-exists check above but breaks at
    // runtime — it would never fire on the tool it must gate. This contract catches
    // that drift. (event::matcher; UserPromptSubmit has no matcher -> empty.)
    const reg = templateHookRegistrations();
    const contract: Array<[string, string]> = [
      ['destructive-command-guard', 'PreToolUse::Bash'],
      ['package-install-guard', 'PreToolUse::Bash'],
      ['agent-model-guard', 'PreToolUse::Task'],
      ['agent-recall-injector', 'PreToolUse::Task'],
      ['tldr-context-inject', 'PreToolUse::Task'],
      ['plan-to-ralph-enforcer', 'PreToolUse::Edit|Write'],
      ['memory-awareness', 'UserPromptSubmit::'],
      ['post-edit-diagnostics', 'PostToolUse::Edit|Write'],
      ['agent-error-capture', 'PostToolUse::Task'],
      ['agent-verification', 'PostToolUse::Task'],
      ['ralph-task-monitor', 'PostToolUse::Task'],
      ['telemetry-tracker', 'PostToolUse::Skill|Task'],
      ['plan-exit-tracker', 'PostToolUse::ExitPlanMode'],
      ['epistemic-reminder', 'PostToolUse::Grep|Read'],
    ];
    for (const [name, expected] of contract) {
      const got = reg.get(name);
      expect(got, `${name} must be registered in the template`).toBeDefined();
      expect(
        [...(got ?? [])],
        `${name} must be under ${expected} (got: ${[...(got ?? [])].join(', ') || 'none'})`,
      ).toContain(expected);
    }
  });
});
