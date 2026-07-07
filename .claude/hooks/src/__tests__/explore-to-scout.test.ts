/**
 * explore-to-scout — regression tests (previously ZERO coverage).
 *
 * Backstop hook: deny any Agent/Task spawn with subagent_type="Explore"
 * (Explore = Haiku), passthrough everything else. Root-cause friction
 * fixes live in smart-search-router + the use-scout-not-explore rule.
 */
import { describe, it, expect } from 'vitest';
import { decide } from '../explore-to-scout.js';

describe('explore-to-scout — denies Explore', () => {
  it('denies Task with subagent_type="Explore"', () => {
    const out = decide({ tool: 'Task', tool_input: { subagent_type: 'Explore' } });
    expect(out?.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out?.hookSpecificOutput.permissionDecisionReason).toContain('scout');
  });

  it('denies case-insensitively (explore / EXPLORE / ExPlOrE)', () => {
    for (const t of ['explore', 'EXPLORE', 'ExPlOrE']) {
      expect(decide({ tool: 'Task', tool_input: { subagent_type: t } })?.hookSpecificOutput.permissionDecision).toBe('deny');
    }
  });

  it('denies via the legacy Agent tool alias too', () => {
    expect(decide({ tool: 'Agent', tool_input: { subagent_type: 'Explore' } })?.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('reads the tool_name field variant', () => {
    expect(decide({ tool_name: 'Task', tool_input: { subagent_type: 'explore' } })?.hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

describe('explore-to-scout — passthrough (returns null)', () => {
  it('scout is allowed', () => {
    expect(decide({ tool: 'Task', tool_input: { subagent_type: 'scout' } })).toBeNull();
  });

  it('other subagent types are allowed', () => {
    expect(decide({ tool: 'Task', tool_input: { subagent_type: 'oracle' } })).toBeNull();
  });

  it('non-spawn tools are ignored even with subagent_type=Explore', () => {
    expect(decide({ tool: 'Bash', tool_input: { subagent_type: 'Explore' } })).toBeNull();
  });

  it('missing tool_input → passthrough', () => {
    expect(decide({ tool: 'Task' })).toBeNull();
  });
});
