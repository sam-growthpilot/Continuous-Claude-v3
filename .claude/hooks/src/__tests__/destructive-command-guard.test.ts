/**
 * destructive-command-guard — Phase 1a SAFE-floor tests (D2g-02 / GAP3-01)
 *
 * Verifies: (1) curated destructive set is caught incl. compound commands;
 * (2) routine dev commands are NOT false-flagged; (3) fail-CLOSED in unattended
 * contexts (deny, never an interactive ask that would hang); (4) ask in
 * interactive; (5) SKIP_DESTRUCTIVE_GUARD override.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyDestructive,
  isUnattended,
  decide,
  stripQuotedStrings,
  parseExecutable,
  extractShellWrapperPayloads,
} from '../destructive-command-guard.js';

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
  it('SKIP_DESTRUCTIVE_GUARD=1 env → allow even destructive', () => {
    expect(decide('rm -rf x', { permission_mode: 'default' }, { SKIP_DESTRUCTIVE_GUARD: '1' }).decision).toBe('allow');
  });
});

describe('F3 — split-flag recursive deletion is caught (not just -rf)', () => {
  const splitDestructive = [
    'rm -f -r build',
    'rm -i -r build',
    'rm --force --recursive build',
    'rm --force -r build',
    'sudo rm -f -r /var/x',
    'cd x && rm -f -r y',
    'git clean -d -f',
    'git clean -x -d -f',
    'docker rm --force mycontainer',
  ];
  for (const cmd of splitDestructive) {
    it(`flags split-flag: ${cmd.slice(0, 40)}`, () => {
      expect(classifyDestructive(cmd)).not.toBeNull();
    });
  }
  it('still does NOT flag non-recursive single-file rm', () => {
    expect(classifyDestructive('rm -f .git/index.lock')).toBeNull();
    expect(classifyDestructive('rm -i config.json')).toBeNull();
  });
});

describe('F2 — SKIP override only as a LEADING prefix, never a substring', () => {
  it('leading prefix → allow', () => {
    expect(decide('SKIP_DESTRUCTIVE_GUARD=1 rm -rf build', { permission_mode: 'bypassPermissions' }, {}).decision).toBe('allow');
  });
  it('substring elsewhere does NOT bypass (the exploit)', () => {
    expect(decide('echo SKIP_DESTRUCTIVE_GUARD=1 && rm -rf build', { permission_mode: 'bypassPermissions' }, {}).decision).toBe('deny');
    expect(decide('rm -rf build # SKIP_DESTRUCTIVE_GUARD=1', { permission_mode: 'bypassPermissions' }, {}).decision).toBe('deny');
  });
});

describe('Phase 1b — shell-wrapper recursion (closes the stripQuotedStrings blind spot)', () => {
  const wrapped = [
    'bash -c "rm -rf /tmp/x"',
    "bash -c 'rm -rf build'",
    'sh -c "rm -rf node_modules"',
    'bash -lc "git reset --hard HEAD~2"',          // combined flag cluster ending in c
    'bash --norc -c "git push --force origin main"',
    'sudo bash -c "rm -rf /var/x"',
    'powershell -Command "rm -rf C:/tmp/x"',
    'pwsh -c "rm -rf /x"',
    'cmd /c "rm -rf build"',
    'cmd.exe /c "git clean -fdx"',
    'cd /tmp && bash -c "rm -rf y"',               // wrapper in a later segment
    'bash -c "cd src && rm -rf dist"',             // destructive inside the payload
    'bash -c "bash -c \\"rm -rf deep\\""',         // nested wrapper (depth recursion)
  ];
  for (const cmd of wrapped) {
    it(`flags wrapped: ${cmd.slice(0, 44)}`, () => {
      expect(classifyDestructive(cmd)).not.toBeNull();
    });
  }
});

describe('Phase 1b — command-substitution recursion (the commit-message backtick incident class)', () => {
  const subst = [
    'git commit -m "deploy $(rm -rf build)"',      // $() in double quotes EXECUTES
    'echo "cleanup `git reset --hard`"',           // backtick in double quotes EXECUTES
    'x=$(rm -rf build)',
    'VAR="$(git push --force origin main)"',
  ];
  for (const cmd of subst) {
    it(`flags substitution: ${cmd.slice(0, 44)}`, () => {
      expect(classifyDestructive(cmd)).not.toBeNull();
    });
  }
});

describe('Phase 1b — find … | xargs rm (bulk delete, even without a recursive flag)', () => {
  it('flags find … | xargs rm -rf', () => {
    expect(classifyDestructive('find . -name "*.tmp" | xargs rm -rf')).not.toBeNull();
  });
  it('flags find … -print0 | xargs -0 rm (no -rf — the real gap)', () => {
    expect(classifyDestructive('find . -type f -print0 | xargs -0 rm')).not.toBeNull();
  });
  it('does NOT flag xargs without rm', () => {
    expect(classifyDestructive('ls | xargs echo')).toBeNull();
    expect(classifyDestructive('find . -name x | xargs grep foo')).toBeNull();
  });
});

describe('Phase 1b — recursion does NOT reintroduce string-literal false-positives', () => {
  const safe = [
    'git commit -m "fix: explain bash -c usage and rm -rf semantics"',  // wrapper TEXT in a message
    `echo 'run: bash -c "rm -rf x"'`,                                   // single-quoted literal, not a command position
    `git commit -m 'note: $(rm -rf x) is dangerous'`,                   // $() in SINGLE quotes does NOT execute
    `echo 'do not run: \`git reset --hard\`'`,                          // backtick in SINGLE quotes does NOT execute
    'node -e "console.log(\'rm -rf and git push --force\')"',           // node -e is JS, not a shell wrapper
    'docker exec pg psql -c "SELECT 1"',                                // psql -c is not a shell wrapper
    'bash scripts/sync-to-active.sh',                                   // bash <script> has no -c flag
  ];
  for (const cmd of safe) {
    it(`allows: ${cmd.slice(0, 44)}`, () => {
      expect(classifyDestructive(cmd)).toBeNull();
    });
  }
});

describe('parseExecutable — quote-aware segmentation + substitution extraction', () => {
  it('splits on unquoted separators', () => {
    expect(parseExecutable('a && b; c | d || e').segments).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('does not split on separators inside quotes', () => {
    expect(parseExecutable('echo "a; b && c"').segments).toEqual(['echo "a; b && c"']);
  });
  it('extracts $() and backtick substitutions OUTSIDE single quotes', () => {
    expect(parseExecutable('x=$(rm -rf a)').substitutions).toContain('rm -rf a');
    expect(parseExecutable('echo "`git reset --hard`"').substitutions).toContain('git reset --hard');
  });
  it('does NOT extract substitutions inside single quotes (bash treats them literally)', () => {
    expect(parseExecutable("echo '$(rm -rf a)'").substitutions).toEqual([]);
    expect(parseExecutable("echo '`rm -rf a`'").substitutions).toEqual([]);
  });
});

describe('extractShellWrapperPayloads — only real wrappers at a command position', () => {
  it('extracts the payload of bash -c', () => {
    expect(extractShellWrapperPayloads('bash -c "rm -rf x"')).toEqual(['rm -rf x']);
  });
  it('extracts across a compound command', () => {
    expect(extractShellWrapperPayloads('cd /tmp && bash -c "rm -rf y"')).toEqual(['rm -rf y']);
  });
  it('does NOT treat "bash -c" text inside a quoted arg as a wrapper', () => {
    expect(extractShellWrapperPayloads('echo "bash -c rm -rf"')).toEqual([]);
  });
});
