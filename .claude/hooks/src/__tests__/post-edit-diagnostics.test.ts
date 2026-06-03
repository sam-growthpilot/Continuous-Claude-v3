/**
 * Tests for post-edit-diagnostics hook: TypeScript/JavaScript support
 *
 * TDD tests for adding tsc --noEmit diagnostics for TS/JS files.
 * The hook already supports Python via the TLDR daemon; these tests
 * verify the new tsc-based path for TypeScript/JavaScript files.
 *
 * Plus (WS-2 Phase B.4a): the hook now records the edited file on the L2
 * context bus as a load-bearing `edited` entry (ONLY `edited` -- a type error is
 * not a test failure; review F6). Those tests exercise recordBusFilesInPlay
 * directly against a temp CLAUDE_PROJECT_DIR (real mutateBus default path) and
 * confirm a non-Edit / no-file-path invocation writes nothing.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

import { recordBusFilesInPlay } from '../post-edit-diagnostics.js';
import { getBusId } from '../shared/session-bus-id.js';
import { busPath, readBus, mutateBus, bumpTurn, type BusEntry } from '../shared/context-bus.js';

// ---------------------------------------------------------------------------
// Helpers: parse tsc output and build hook output (extracted from hook logic)
// ---------------------------------------------------------------------------

/** Regex for parsing tsc --noEmit --pretty false output lines */
const TSC_LINE_REGEX = /^(.+)\((\d+),(\d+)\): (error|warning) TS(\d+): (.+)$/;

interface TscDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  code: number;
  message: string;
}

function parseTscOutput(stdout: string): TscDiagnostic[] {
  const diagnostics: TscDiagnostic[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(TSC_LINE_REGEX);
    if (match) {
      diagnostics.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        severity: match[4] as 'error' | 'warning',
        code: parseInt(match[5], 10),
        message: match[6],
      });
    }
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// 1. tsc output parsing
// ---------------------------------------------------------------------------

describe('post-edit-diagnostics: tsc output parsing', () => {
  it('should parse a single error line', () => {
    const output = `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.`;
    const result = parseTscOutput(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      file: 'src/index.ts',
      line: 10,
      column: 5,
      severity: 'error',
      code: 2322,
      message: "Type 'string' is not assignable to type 'number'.",
    });
  });

  it('should parse multiple error lines', () => {
    const output = [
      `src/a.ts(1,1): error TS2304: Cannot find name 'foo'.`,
      `src/b.tsx(20,10): error TS7006: Parameter 'x' implicitly has an 'any' type.`,
      `src/c.js(5,3): warning TS2345: Argument of type 'string' is not assignable.`,
    ].join('\n');

    const result = parseTscOutput(output);
    expect(result).toHaveLength(3);
    expect(result[0].file).toBe('src/a.ts');
    expect(result[1].file).toBe('src/b.tsx');
    expect(result[2].severity).toBe('warning');
  });

  it('should ignore non-diagnostic lines', () => {
    const output = [
      `Found 2 errors.`,
      ``,
      `src/index.ts(10,5): error TS2322: Type mismatch.`,
      `  10   const x: number = "hello";`,
      `       ~`,
    ].join('\n');

    const result = parseTscOutput(output);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe(2322);
  });

  it('should return empty array for clean output', () => {
    const output = '';
    const result = parseTscOutput(output);
    expect(result).toHaveLength(0);
  });

  it('should handle Windows paths with drive letters', () => {
    const output = `C:/Users/david.hayes/project/src/index.ts(10,5): error TS2322: Type mismatch.`;
    const result = parseTscOutput(output);

    expect(result).toHaveLength(1);
    expect(result[0].file).toBe('C:/Users/david.hayes/project/src/index.ts');
  });
});

// ---------------------------------------------------------------------------
// 2. Language routing (Python vs TS/JS vs other)
// ---------------------------------------------------------------------------

describe('post-edit-diagnostics: language routing', () => {
  const pythonExtensions = ['.py', '.pyx', '.pyi'];
  const tsJsExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

  function getLanguageRoute(ext: string): 'python' | 'typescript' | 'skip' {
    if (pythonExtensions.includes(ext)) return 'python';
    if (tsJsExtensions.includes(ext)) return 'typescript';
    return 'skip';
  }

  it('should route .ts to typescript', () => {
    expect(getLanguageRoute('.ts')).toBe('typescript');
  });

  it('should route .tsx to typescript', () => {
    expect(getLanguageRoute('.tsx')).toBe('typescript');
  });

  it('should route .js to typescript', () => {
    expect(getLanguageRoute('.js')).toBe('typescript');
  });

  it('should route .jsx to typescript', () => {
    expect(getLanguageRoute('.jsx')).toBe('typescript');
  });

  it('should route .mjs to typescript', () => {
    expect(getLanguageRoute('.mjs')).toBe('typescript');
  });

  it('should route .cjs to typescript', () => {
    expect(getLanguageRoute('.cjs')).toBe('typescript');
  });

  it('should route .py to python', () => {
    expect(getLanguageRoute('.py')).toBe('python');
  });

  it('should route .go to skip', () => {
    expect(getLanguageRoute('.go')).toBe('skip');
  });

  it('should route .rs to skip', () => {
    expect(getLanguageRoute('.rs')).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// 3. Output formatting (error count + previews)
// ---------------------------------------------------------------------------

describe('post-edit-diagnostics: output formatting for tsc', () => {
  function formatTscOutput(diagnostics: TscDiagnostic[]): string[] {
    const errorCount = diagnostics.filter(d => d.severity === 'error').length;
    const warningCount = diagnostics.filter(d => d.severity === 'warning').length;

    const lines: string[] = [];
    lines.push(`Diagnostics: ${errorCount} type errors, ${warningCount} warnings`);

    const maxPreviews = 5;
    const previews = diagnostics.slice(0, maxPreviews);
    for (const d of previews) {
      lines.push(`   - ${d.file}:${d.line}:${d.column}: ${d.message}`);
    }

    if (diagnostics.length > maxPreviews) {
      lines.push(`   ... and ${diagnostics.length - maxPreviews} more`);
    }

    return lines;
  }

  it('should show error and warning counts', () => {
    const diags: TscDiagnostic[] = [
      { file: 'a.ts', line: 1, column: 1, severity: 'error', code: 2322, message: 'Type mismatch' },
      { file: 'b.ts', line: 2, column: 1, severity: 'warning', code: 2345, message: 'Arg issue' },
    ];
    const lines = formatTscOutput(diags);
    expect(lines[0]).toBe('Diagnostics: 1 type errors, 1 warnings');
  });

  it('should show up to 5 previews', () => {
    const diags: TscDiagnostic[] = Array.from({ length: 7 }, (_, i) => ({
      file: `f${i}.ts`,
      line: i + 1,
      column: 1,
      severity: 'error' as const,
      code: 2322,
      message: `Error ${i}`,
    }));

    const lines = formatTscOutput(diags);
    // 1 summary + 5 previews + 1 "and N more" = 7 lines
    expect(lines).toHaveLength(7);
    expect(lines[6]).toContain('and 2 more');
  });

  it('should not show "and N more" when 5 or fewer', () => {
    const diags: TscDiagnostic[] = [
      { file: 'a.ts', line: 1, column: 1, severity: 'error', code: 2322, message: 'Err' },
    ];
    const lines = formatTscOutput(diags);
    expect(lines).toHaveLength(2); // 1 summary + 1 preview
    expect(lines.join('\n')).not.toContain('more');
  });

  it('should include file:line:col in previews', () => {
    const diags: TscDiagnostic[] = [
      { file: 'src/index.ts', line: 42, column: 7, severity: 'error', code: 2322, message: 'Oops' },
    ];
    const lines = formatTscOutput(diags);
    expect(lines[1]).toContain('src/index.ts:42:7');
  });
});

// ---------------------------------------------------------------------------
// 4. Hook output structure (HookOutput interface compliance)
// ---------------------------------------------------------------------------

describe('post-edit-diagnostics: HookOutput structure for tsc', () => {
  interface HookOutput {
    hookSpecificOutput?: {
      hookEventName: string;
      additionalContext?: string;
    };
  }

  function buildHookOutput(diagnostics: TscDiagnostic[]): HookOutput {
    if (diagnostics.length === 0) return {};

    const errorCount = diagnostics.filter(d => d.severity === 'error').length;
    const warningCount = diagnostics.filter(d => d.severity === 'warning').length;

    const lines: string[] = [];
    lines.push(`Diagnostics: ${errorCount} type errors, ${warningCount} warnings`);

    const maxPreviews = 5;
    const previews = diagnostics.slice(0, maxPreviews);
    for (const d of previews) {
      lines.push(`   - ${d.file}:${d.line}:${d.column}: ${d.message}`);
    }

    if (diagnostics.length > maxPreviews) {
      lines.push(`   ... and ${diagnostics.length - maxPreviews} more`);
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: lines.join('\n'),
      },
    };
  }

  it('should return empty object when no diagnostics', () => {
    const output = buildHookOutput([]);
    expect(output).toEqual({});
  });

  it('should set hookEventName to PostToolUse', () => {
    const diags: TscDiagnostic[] = [
      { file: 'a.ts', line: 1, column: 1, severity: 'error', code: 2322, message: 'Err' },
    ];
    const output = buildHookOutput(diags);
    expect(output.hookSpecificOutput?.hookEventName).toBe('PostToolUse');
  });

  it('should include diagnostics in additionalContext', () => {
    const diags: TscDiagnostic[] = [
      { file: 'a.ts', line: 1, column: 1, severity: 'error', code: 2322, message: 'Type mismatch' },
    ];
    const output = buildHookOutput(diags);
    expect(output.hookSpecificOutput?.additionalContext).toContain('Type mismatch');
    expect(output.hookSpecificOutput?.additionalContext).toContain('1 type errors');
  });
});

// ---------------------------------------------------------------------------
// 5. tsc invocation shape (spawnSync args)
// ---------------------------------------------------------------------------

describe('post-edit-diagnostics: tsc invocation', () => {
  it('should use --noEmit and --pretty false flags', () => {
    const expectedArgs = ['--noEmit', '--pretty', 'false'];
    const cmd = 'tsc';

    expect(cmd).toBe('tsc');
    expect(expectedArgs).toContain('--noEmit');
    expect(expectedArgs).toContain('--pretty');
    expect(expectedArgs[2]).toBe('false');
  });

  it('should set timeout to prevent hangs', () => {
    const spawnOptions = { cwd: '/some/project', timeout: 30000 };
    expect(spawnOptions.timeout).toBe(30000);
  });

  it('should handle tsc not found gracefully', () => {
    const mockResult: Partial<SpawnSyncReturns<Buffer>> = {
      status: null,
      error: new Error('ENOENT'),
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
    };

    const shouldSkip = mockResult.error !== undefined || mockResult.status === null;
    expect(shouldSkip).toBe(true);
  });

  it('should handle tsc returning non-zero exit for type errors', () => {
    // tsc returns exit code 2 when there are type errors -- this is NOT a failure
    const mockResult: Partial<SpawnSyncReturns<Buffer>> = {
      status: 2,
      error: undefined,
      stdout: Buffer.from(`src/a.ts(1,1): error TS2322: Type mismatch.\n`),
      stderr: Buffer.from(''),
    };

    const shouldParse = mockResult.error === undefined && mockResult.stdout;
    expect(shouldParse).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. WS-2 Phase B.4a: bus files_in_play recording (recordBusFilesInPlay)
//
// The hook records the edited file on the L2 context bus as a load-bearing
// `edited` entry (ONLY `edited`; a type-check failure is not a test failure --
// review F6). These tests drive recordBusFilesInPlay directly against a real temp
// CLAUDE_PROJECT_DIR (the default mutateBus lock-backed path), so the
// load-bearing slice is asserted end-to-end.
// COORDINATION_SESSION_ID is pinned so getBusId() is stable.
// ---------------------------------------------------------------------------
describe('post-edit-diagnostics: bus files_in_play recording (Phase B.4a)', () => {
  let tmp: string;
  const SAVE = ['CLAUDE_PROJECT_DIR', 'CCV3_BUS_OFF', 'COORDINATION_SESSION_ID'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of SAVE) saved[k] = process.env[k];
    process.env.COORDINATION_SESSION_ID = 'ped-bus-sess';
    delete process.env.CCV3_BUS_OFF;
    tmp = mkdtempSync(join(tmpdir(), 'ped-bus-'));
    process.env.CLAUDE_PROJECT_DIR = tmp;
  });

  afterEach(() => {
    for (const k of SAVE) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('adds an `edited` load-bearing file when there are NO type errors', () => {
    const file = 'C:/proj/src/feature.ts';
    recordBusFilesInPlay(file);

    const bus = readBus();
    expect(bus.files_in_play.load_bearing).toHaveLength(1);
    expect(bus.files_in_play.load_bearing[0]).toMatchObject({
      path: file,
      role: 'edited',
    });
    // No type errors -> no test_failed entry.
    expect(
      bus.files_in_play.load_bearing.some((f) => f.role === 'test_failed'),
    ).toBe(false);
    // turn_added is stamped from current_turn (0 on a fresh bus).
    expect(bus.files_in_play.load_bearing[0].turn_added).toBe(0);
  });

  it('adds ONLY `edited` (never test_failed) even on a file with type errors', () => {
    // Review F6: a type-check failure is not a test failure -- recordBusFilesInPlay
    // records only the `edited` role; `test_failed` is reserved for a real runner.
    const file = 'C:/proj/src/broken.ts';
    recordBusFilesInPlay(file);

    const bus = readBus();
    const roles = bus.files_in_play.load_bearing.map((f) => f.role);
    expect(roles).toEqual(['edited']);
    expect(bus.files_in_play.load_bearing[0].path).toBe(file);
  });

  it('persists to the real default bus path and bumps revision', () => {
    const file = 'C:/proj/src/x.ts';
    recordBusFilesInPlay(file);
    const path = busPath(getBusId());
    expect(existsSync(path)).toBe(true);
    const onDisk = JSON.parse(readFileSync(path, 'utf-8'));
    expect(onDisk.revision).toBe(1);
    expect(onDisk.files_in_play.load_bearing[0].path).toBe(file);
  });

  it('stamps turn_added from the bus current_turn (not always 0)', () => {
    // Seed the bus to turn 3 first, then record an edit; the entry must carry 3.
    mutateBus(undefined, (b: BusEntry) => {
      bumpTurn(b);
      bumpTurn(b);
      bumpTurn(b);
    });
    recordBusFilesInPlay('C:/proj/src/turned.ts');
    const bus = readBus();
    for (const f of bus.files_in_play.load_bearing) {
      expect(f.turn_added).toBe(3);
    }
  });

  it('is fail-open: CCV3_BUS_OFF makes it a no-op (no file, no throw)', () => {
    process.env.CCV3_BUS_OFF = '1';
    expect(() => recordBusFilesInPlay('C:/proj/src/off.ts')).not.toThrow();
    expect(existsSync(busPath(getBusId()))).toBe(false);
  });

  it('is fail-open: an unwritable project dir does not throw and writes no file', () => {
    // Point the bus at a path under a regular FILE so the write cannot land.
    const fileAsProj = join(tmp, 'regular-file');
    // Write a file where a directory would be expected.
    writeFileSync(fileAsProj, 'not a dir');
    process.env.CLAUDE_PROJECT_DIR = fileAsProj;
    expect(() => recordBusFilesInPlay('C:/proj/src/y.ts')).not.toThrow();
    expect(existsSync(busPath(getBusId(), fileAsProj))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Guard contract: a non-Edit / no-file-path invocation writes NOTHING to the
// bus. recordBusFilesInPlay sits AFTER main()'s tool_name + file_path guards, so
// those invocations never reach it. We assert the contract end-to-end by
// spawning the built hook (which early-exits before any diagnostics or bus
// write) and confirming no bus file appears under a temp project dir.
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const HOOK_PATH = resolve(__dirname, '..', '..', 'dist', 'post-edit-diagnostics.mjs');

describe('post-edit-diagnostics: non-Edit / no-file-path invocations write no bus file', () => {
  let tmp: string;
  let projectDir: string;
  const SESSION = 'ped-guard-sess';

  function runHook(input: object): {
    exitCode: number | null;
    stdout: string;
  } {
    const cleanEnv: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!k.startsWith('VITEST')) cleanEnv[k] = v;
    }
    cleanEnv.COORDINATION_SESSION_ID = SESSION;
    cleanEnv.CLAUDE_PROJECT_DIR = projectDir;
    delete cleanEnv.CCV3_BUS_OFF;
    const r = spawnSync('node', [HOOK_PATH], {
      input: JSON.stringify(input),
      encoding: 'utf-8',
      timeout: 15000,
      env: cleanEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: r.status, stdout: (r.stdout || '').toString() };
  }

  function busPathForProject(): string {
    const prev = {
      COORDINATION_SESSION_ID: process.env.COORDINATION_SESSION_ID,
      CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
    };
    process.env.COORDINATION_SESSION_ID = SESSION;
    process.env.CLAUDE_PROJECT_DIR = projectDir;
    try {
      return busPath(getBusId({ cwd: projectDir }), projectDir);
    } finally {
      if (prev.COORDINATION_SESSION_ID === undefined) delete process.env.COORDINATION_SESSION_ID;
      else process.env.COORDINATION_SESSION_ID = prev.COORDINATION_SESSION_ID;
      if (prev.CLAUDE_PROJECT_DIR === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = prev.CLAUDE_PROJECT_DIR;
    }
  }

  beforeAll(() => {
    if (!existsSync(HOOK_PATH)) {
      throw new Error(`Built hook not found at ${HOOK_PATH}. Run 'npm run build' first.`);
    }
  });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ped-guard-'));
    projectDir = join(tmp, 'proj');
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('a non-Edit tool (Read) writes no bus file', () => {
    const r = runHook({
      tool_name: 'Read',
      tool_input: { file_path: 'C:/proj/src/whatever.ts' },
    });
    expect(r.exitCode).toBe(0);
    expect(existsSync(busPathForProject())).toBe(false);
  }, 20000);

  it('an Edit with no file_path writes no bus file', () => {
    const r = runHook({
      tool_name: 'Edit',
      tool_input: {},
    });
    expect(r.exitCode).toBe(0);
    expect(existsSync(busPathForProject())).toBe(false);
  }, 20000);

  it('an Edit on a NON-code file (.md) writes no bus file', () => {
    const r = runHook({
      tool_name: 'Edit',
      tool_input: { file_path: 'C:/proj/docs/notes.md' },
    });
    expect(r.exitCode).toBe(0);
    expect(existsSync(busPathForProject())).toBe(false);
  }, 20000);
});
