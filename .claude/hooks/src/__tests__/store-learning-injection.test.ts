/**
 * QW-01 (S0) — store_learning.py shell-injection regression test.
 *
 * The "junk-creator" bug: four hook call sites built a `store_learning.py`
 * invocation as a SHELL STRING by interpolating untrusted content (agent
 * error text / user prompt), then ran it via execSync — which ALWAYS uses a
 * shell. On Windows cmd.exe, content containing `& | < > ^ % " $() ` (backticks)
 * broke the quoting and either executed injected commands or wrote malformed
 * "junk" files at the repo root.
 *
 * The fix converts each call site to spawnSync('uv', [...argv], { shell:false })
 * with every argument as a SEPARATE array element and NO manual escaping — so
 * the raw content is passed verbatim as one argv element and no shell can
 * interpret metacharacters.
 *
 * These tests assert, for each of the 3 hooks:
 *   1. spawnSync was called (NOT execSync) for the store path.
 *   2. The 2nd argument is an ARRAY (argv list).
 *   3. The element immediately after '--content' EQUALS the raw injected
 *      content byte-for-byte (no backslash escaping, no stripped chars).
 *   4. The options object has shell !== true.
 *
 * Plus a static-source regression guard: the post-fix sources contain no
 * `execSync(` building a store_learning command and no `.replace(/"/g`
 * escaping near these sites.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC_DIR = join(__dirname, '..');

// A nasty payload exercising every dangerous shell metacharacter across
// POSIX sh AND Windows cmd.exe: & | < > ^ % " $() `backticks` ; rm -rf.
const INJECTION = 'bad & rm -rf x; $(whoami) `id` "q" | cat > pwn.txt ^ %PATH% < /etc/passwd';

// Mock child_process so neither execSync nor spawnSync ever shells out for real.
const spawnSyncMock = vi.fn(() => ({
  status: 0,
  stdout: '',
  stderr: '',
  pid: 1234,
  output: ['', '', ''],
  signal: null,
}));
const execSyncMock = vi.fn(() => '');

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: spawnSyncMock,
    execSync: execSyncMock,
  };
});

// store_learning.py must "exist" for the existsSync guards in the hooks to pass.
// Create a real opc tree in a temp dir and point CLAUDE_OPC_DIR at it.
const OPC_DIR = mkdtempSync(join(tmpdir(), 'ccv3-qw01-opc-'));
mkdirSync(join(OPC_DIR, 'scripts', 'core'), { recursive: true });
writeFileSync(join(OPC_DIR, 'scripts', 'core', 'store_learning.py'), '# stub\n');
process.env.CLAUDE_OPC_DIR = OPC_DIR;

/** Find the argv element immediately after the given flag. */
function argAfter(argv: unknown, flag: string): string | undefined {
  if (!Array.isArray(argv)) return undefined;
  const i = argv.indexOf(flag);
  if (i === -1 || i + 1 >= argv.length) return undefined;
  return argv[i + 1] as string;
}

/** The first spawnSync call whose argv contains store_learning.py. */
function storeCall(): any[] | undefined {
  const calls = spawnSyncMock.mock.calls as unknown as any[][];
  return calls.find((c) => {
    const argv = c[1];
    return Array.isArray(argv) && argv.some((a: unknown) => typeof a === 'string' && a.includes('store_learning.py'));
  });
}

beforeEach(() => {
  spawnSyncMock.mockClear();
  execSyncMock.mockClear();
});

describe('QW-01: store_learning.py injection — no-shell spawnSync', () => {
  it('agent-error-capture.ts: stores via spawnSync with raw content argv', async () => {
    const mod: any = await import('../agent-error-capture.js');
    const fn = mod.storeLearning;
    expect(typeof fn, 'storeLearning must be exported for testing').toBe('function');

    // Drive the store path directly with the injection payload as the error context.
    fn('sess-1', 'kraken', 'do a thing', INJECTION);

    expect(execSyncMock, 'execSync must NOT be used for the store').not.toHaveBeenCalled();
    const call = storeCall();
    expect(call, 'spawnSync should have been called with store_learning.py').toBeDefined();

    const argv = call![1];
    expect(Array.isArray(argv)).toBe(true);

    // Raw content passed verbatim — must CONTAIN the injection unescaped.
    const content = argAfter(argv, '--content');
    expect(content).toContain(INJECTION);
    expect(content).not.toContain('\\"'); // no sh-style escaping leaked in

    const opts: any = call![2] || {};
    expect(opts.shell).not.toBe(true);
  });

  it('hook-error-pipeline.ts: stores via spawnSync with raw content argv', async () => {
    const mod: any = await import('../hook-error-pipeline.js');
    const fn = mod.captureHookError;
    expect(typeof fn, 'captureHookError must be exported').toBe('function');

    const err = new Error(INJECTION);
    fn('some-hook', err, 'sess-2', true);

    expect(execSyncMock).not.toHaveBeenCalled();
    const call = storeCall();
    expect(call, 'spawnSync should have been called with store_learning.py').toBeDefined();

    const argv = call![1];
    expect(Array.isArray(argv)).toBe(true);

    const content = argAfter(argv, '--content');
    expect(content).toContain(INJECTION);
    expect(content).not.toContain('\\"');

    const opts: any = call![2] || {};
    expect(opts.shell).not.toBe(true);
  });

  it('user-confirmation-detector.ts: USER_PREFERENCE store via spawnSync with raw content', async () => {
    const mod: any = await import('../user-confirmation-detector.js');
    const fn = mod.storeUserConfirmedLearning;
    expect(typeof fn, 'storeUserConfirmedLearning must be exported').toBe('function');

    await fn('sess-3', INJECTION, null, OPC_DIR);

    expect(execSyncMock).not.toHaveBeenCalled();
    const call = storeCall();
    expect(call, 'spawnSync should have been called with store_learning.py').toBeDefined();

    const argv = call![1];
    expect(Array.isArray(argv)).toBe(true);
    expect(argv.indexOf('--type')).toBeGreaterThanOrEqual(0);
    expect(argAfter(argv, '--type')).toBe('USER_PREFERENCE');

    const content = argAfter(argv, '--content');
    // The hook wraps the prompt: `User confirmed: "<prompt>"`; the raw prompt
    // (with all metachars) must survive verbatim inside that wrapper.
    expect(content).toContain(INJECTION);
    expect(content).not.toContain('\\"');

    const opts: any = call![2] || {};
    expect(opts.shell).not.toBe(true);
  });

  it('user-confirmation-detector.ts: WORKING_SOLUTION store via spawnSync with raw content', async () => {
    const mod: any = await import('../user-confirmation-detector.js');
    const fn = mod.storeVictoryFromConfirmation;
    expect(typeof fn, 'storeVictoryFromConfirmation must be exported').toBe('function');

    const state = {
      session_id: 'sess-4',
      state: 'CANDIDATE',
      tracked_file: 'foo.ts',
      attempts: 3,
      failures: [{ turn: 1, error: 'boom' }],
      candidate_turn: 2,
      last_edit_content: INJECTION,
      test_command: null,
      context: 'ctx',
      current_turn: 5,
    };

    await fn(state, INJECTION, OPC_DIR);

    expect(execSyncMock).not.toHaveBeenCalled();
    const call = storeCall();
    expect(call, 'spawnSync should have been called with store_learning.py').toBeDefined();

    const argv = call![1];
    expect(Array.isArray(argv)).toBe(true);
    expect(argAfter(argv, '--type')).toBe('WORKING_SOLUTION');

    const content = argAfter(argv, '--content');
    expect(content).toContain(INJECTION);
    expect(content).not.toContain('\\"');

    const opts: any = call![2] || {};
    expect(opts.shell).not.toBe(true);
  });
});

describe('QW-01: static-source regression guard', () => {
  const FILES = [
    'agent-error-capture.ts',
    'hook-error-pipeline.ts',
    'user-confirmation-detector.ts',
  ];

  for (const f of FILES) {
    it(`${f}: no execSync building a store_learning command, no sh-escaping`, () => {
      const p = join(SRC_DIR, f);
      expect(existsSync(p)).toBe(true);
      const src = readFileSync(p, 'utf-8');

      // No execSync(...) anywhere that could shell out for the store.
      expect(/execSync\s*\(/.test(src), `${f} still calls execSync(`).toBe(false);

      // No sh-style double-quote escaping near the store call sites.
      expect(/\.replace\(\/"\/g/.test(src), `${f} still does .replace(/"/g escaping`).toBe(false);

      // Must use spawnSync for the store.
      expect(/spawnSync\s*\(/.test(src), `${f} must use spawnSync`).toBe(true);
    });
  }
});
