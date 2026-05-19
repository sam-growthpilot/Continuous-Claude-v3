import { describe, it, expect } from 'vitest';
import { formatCommitEntry } from '../git-commit-roadmap.js';

// Structural-equivalent local type (loose coupling — avoids binding to ParsedCommit internals)
type CommitLike = {
  type: string;
  scope: string | null;
  description: string;
  hash: string | null;
  isAmend: boolean;
  isMerge: boolean;
  isRevert: boolean;
};

const DATE = '2026-05-19';
const HASH = 'abc1234def';

describe('formatCommitEntry', () => {
  it('case 1: feat with scope produces "feat(memory): X" not "[feat](memory) X"', () => {
    const commit: CommitLike = {
      type: 'feat',
      scope: 'memory',
      description: 'add embedding daemon',
      hash: HASH,
      isAmend: false,
      isMerge: false,
      isRevert: false,
    };
    const result = formatCommitEntry(commit as never, DATE);
    expect(result).toBe(`- [x] feat(memory): add embedding daemon (${DATE}) \`${HASH.slice(0, 7)}\``);
  });

  it('case 2: feat without scope produces "feat: X"', () => {
    const commit: CommitLike = {
      type: 'feat',
      scope: null,
      description: 'new standalone feature',
      hash: HASH,
      isAmend: false,
      isMerge: false,
      isRevert: false,
    };
    const result = formatCommitEntry(commit as never, DATE);
    expect(result).toBe(`- [x] feat: new standalone feature (${DATE}) \`${HASH.slice(0, 7)}\``);
  });

  it('case 3: type === "other" (non-conventional) — no type prefix, no leading colon', () => {
    const commit: CommitLike = {
      type: 'other',
      scope: null,
      description: 'initial commit',
      hash: HASH,
      isAmend: false,
      isMerge: false,
      isRevert: false,
    };
    const result = formatCommitEntry(commit as never, DATE);
    expect(result).toBe(`- [x] initial commit (${DATE}) \`${HASH.slice(0, 7)}\``);
    expect(result).not.toContain(':');
  });

  it('case 4: no hash — omits trailing hash label', () => {
    const commit: CommitLike = {
      type: 'fix',
      scope: 'auth',
      description: 'patch token refresh',
      hash: null,
      isAmend: false,
      isMerge: false,
      isRevert: false,
    };
    const result = formatCommitEntry(commit as never, DATE);
    expect(result).toBe(`- [x] fix(auth): patch token refresh (${DATE})`);
    expect(result).not.toMatch(/`[a-f0-9]/);
  });

  it('case 5: negative — result never contains [word](word) broken-link pattern', () => {
    const commits: CommitLike[] = [
      { type: 'feat', scope: 'memory', description: 'X', hash: HASH, isAmend: false, isMerge: false, isRevert: false },
      { type: 'fix',  scope: 'auth',   description: 'Y', hash: HASH, isAmend: false, isMerge: false, isRevert: false },
      { type: 'docs', scope: 'api',    description: 'Z', hash: HASH, isAmend: false, isMerge: false, isRevert: false },
      { type: 'feat', scope: null,     description: 'W', hash: null,  isAmend: false, isMerge: false, isRevert: false },
    ];
    for (const c of commits) {
      const result = formatCommitEntry(c as never, DATE);
      // Must NOT match the broken [word](word) markdown-link pattern
      expect(result).not.toMatch(/\[\w+\]\(\w+\)/);
    }
  });
});
