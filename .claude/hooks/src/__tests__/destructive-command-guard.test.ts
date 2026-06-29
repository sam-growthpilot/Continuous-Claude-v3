/**
 * destructive-command-guard — Phase 1a SAFE-floor tests (D2g-02 / GAP3-01)
 *
 * Verifies: (1) curated destructive set is caught incl. compound commands;
 * (2) routine dev commands are NOT false-flagged; (3) fail-CLOSED in unattended
 * contexts (deny, never an interactive ask that would hang); (4) ask in
 * interactive; (5) SKIP_DESTRUCTIVE_GUARD override.
 */
import { describe, it, expect } from 'vitest';
import { classifyDestructive, isUnattended, decide, stripQuotedStrings } from '../destructive-command-guard.js';

describe('no false-positive on destructive keywords inside string literals', () => {
  it('git commit -m with destructive words in the message → allow', () => {
    const cmd = 'git commit -m "set (recursive rm, git reset --hard / force-push / clean -f)"';
    expect(classifyDestructive(cmd)).toBeNull();
  });
  it('echo of destructive text → allow', () => {
    expect(classifyDestructive(`echo "to undo: git reset --hard HEAD~1"`)).toBeNull();
  });
  it('node -e diagnostic containing destructive strings → allow', () => {
    expect(classifyDestructive(`node -e "console.log('rm -rf and git push --force')"`)).toBeNull();
  });
  it('BUT a real destructive op alongside a quoted message is still caught', () => {
    expect(classifyDestructive('git commit -m "ok" && rm -rf build')).toBe('recursive rm');
  });
  it('stripQuotedStrings removes both quote styles', () => {
    expect(stripQuotedStrings('a "x y" b \'z\' c')).toBe('a "" b \'\' c');
  });
});

describe('override via command-string prefix (PreToolUse hooks do not inherit inline env)', () => {
  it('SKIP_DESTRUCTIVE_GUARD=1 prefix in the command → allow even destructive, even unattended', () => {
    expect(decide('SKIP_DESTRUCTIVE_GUARD=1 rm -rf build', { permission_mode: 'bypassPermissions' }, {}).decision).toBe('allow');
  });
});

describe('classifyDestructive — catches high-blast-radius ops', () => {
  const destructive = [
    'rm -rf build',
    'rm -fr ./dist',
    'cd /tmp && rm -rf important',            // compound
    'git reset --hard HEAD~3',
    'git push --force origin main',
    'git push origin main -f',
    'git push --force-with-lease',
    'git push origin --delete oldbranch',
    'git clean -fdx',
    'git checkout -- src/app.ts',
    'git checkout .',
    'git branch -D feature/x',
    'git rebase main',
    'git stash clear',
    'git reflog expire --expire=now --all',
    'git gc --prune=now',
    'git filter-branch --tree-filter foo',
    'find . -name "*.tmp" -delete',
    'find . -type f -exec rm {} \\;',
    'dd if=/dev/zero of=/dev/sda',
    'mkfs.ext4 /dev/sdb1',
    'shred -u secrets.txt',
    'truncate -s 0 important.log',
    'docker system prune -a',
    'docker volume rm pgdata',
    'docker rm -f mycontainer',
    'sudo rm -rf /var/lib/x',                  // command-prefixed (sudo) still caught — unquoted
  ];
  for (const cmd of destructive) {
    it(`flags: ${cmd.slice(0, 42)}`, () => {
      expect(classifyDestructive(cmd)).not.toBeNull();
    });
  }
});

describe('classifyDestructive — does NOT false-flag routine dev', () => {
  const safe = [
    'git status',
    'git add -A',
    'git commit -m "fix"',
    'git push origin main',                    // non-force push
    'git log --oneline -5',
    'git diff HEAD',
    'git checkout -b new-feature',             // create branch, not discard
    'git checkout main',                       // switch branch
    'rm -f .git/index.lock',                   // single-file force, not recursive
    'rm package-lock.json',
    'npm run build',
    'node scripts/x.mjs',
    'cp a.ts b.ts',
    'mkdir -p out',
    'grep -r "DROP TABLE" migrations/',        // search text containing SQL, not exec
    'ls -la',
    'docker ps -a',
    'docker exec pg psql -c "SELECT 1"',
    'bash scripts/sync-to-active.sh',
    'cat findings.json',
  ];
  for (const cmd of safe) {
    it(`allows: ${cmd.slice(0, 42)}`, () => {
      expect(classifyDestructive(cmd)).toBeNull();
    });
  }
});

describe('isUnattended', () => {
  it('bypassPermissions → unattended', () => {
    expect(isUnattended({ permission_mode: 'bypassPermissions' }, {})).toBe(true);
  });
  it('CLAUDE_AGENT_ID (subagent) → unattended', () => {
    expect(isUnattended({ permission_mode: 'default' }, { CLAUDE_AGENT_ID: 'abc' })).toBe(true);
  });
  it('CI → unattended', () => {
    expect(isUnattended({ permission_mode: 'default' }, { CI: 'true' })).toBe(true);
  });
  it('interactive default → attended', () => {
    expect(isUnattended({ permission_mode: 'default' }, {})).toBe(false);
  });
  it('acceptEdits → attended', () => {
    expect(isUnattended({ permission_mode: 'acceptEdits' }, {})).toBe(false);
  });
});

describe('decide — ask interactive, deny unattended, never hang', () => {
  it('destructive + interactive → ask (prompt the human)', () => {
    expect(decide('git push --force', { permission_mode: 'default' }, {}).decision).toBe('ask');
  });
  it('destructive + bypass → deny (fail-closed, no hang)', () => {
    expect(decide('git push --force', { permission_mode: 'bypassPermissions' }, {}).decision).toBe('deny');
  });
  it('destructive + subagent → deny (fail-closed)', () => {
    expect(decide('rm -rf x', { permission_mode: 'default' }, { CLAUDE_AGENT_ID: 'a' }).decision).toBe('deny');
  });
  it('safe command → allow in every mode', () => {
    expect(decide('git status', { permission_mode: 'default' }, {}).decision).toBe('allow');
    expect(decide('git status', { permission_mode: 'bypassPermissions' }, {}).decision).toBe('allow');
  });
  it('SKIP_DESTRUCTIVE_GUARD=1 → allow even destructive', () => {
    expect(decide('rm -rf x', { permission_mode: 'default' }, { SKIP_DESTRUCTIVE_GUARD: '1' }).decision).toBe('allow');
  });
});
