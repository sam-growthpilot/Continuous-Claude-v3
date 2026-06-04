/**
 * Tests for bus-tool-populator (PostToolUse Read|Grep, WS-2 Phase B.4b).
 *
 * Two layers:
 *  - PURE extractor unit tests (extractReadFile / extractGrepHits) -- deterministic path
 *    selection, no bus dependency.
 *  - INTEGRATION: recordRead / recordGrep against a real temp-dir bus (env-pinned bus id),
 *    then read the bus file back to confirm the role landed in the right slice. Also asserts
 *    CCV3_BUS_OFF suppresses the write.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { extractReadFile, extractGrepHits, recordRead, recordGrep } from '../bus-tool-populator.js';

const SESSION_SIGNAL = 'bus-tool-pop-test';

let tempDir: string;
let projectDir: string;

function makeFile(rel: string): void {
  const abs = join(projectDir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, '// content\n');
}

async function busFilePath(): Promise<string> {
  const { getBusId } = await import('../shared/session-bus-id.js');
  const { busPath } = await import('../shared/context-bus.js');
  return busPath(getBusId({ cwd: projectDir }), projectDir);
}

const savedEnv = {
  COORDINATION_SESSION_ID: process.env.COORDINATION_SESSION_ID,
  CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
  CCV3_BUS_OFF: process.env.CCV3_BUS_OFF,
};

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'bus-tool-pop-'));
  projectDir = join(tempDir, 'proj');
  mkdirSync(projectDir, { recursive: true });
  process.env.COORDINATION_SESSION_ID = SESSION_SIGNAL;
  process.env.CLAUDE_PROJECT_DIR = projectDir;
  delete process.env.CCV3_BUS_OFF;
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('extractReadFile (pure)', () => {
  it('accepts an existing project file -> project-relative path', () => {
    makeFile('src/foo.ts');
    expect(extractReadFile(join(projectDir, 'src/foo.ts'), projectDir)).toBe('src/foo.ts');
  });
  it('rejects a non-existent file', () => {
    expect(extractReadFile(join(projectDir, 'nope.ts'), projectDir)).toBeNull();
  });
  it('rejects a noise path (node_modules)', () => {
    makeFile('node_modules/pkg/index.js');
    expect(extractReadFile(join(projectDir, 'node_modules/pkg/index.js'), projectDir)).toBeNull();
  });
  it('rejects a file outside the project', () => {
    const outside = join(tempDir, 'outside.ts');
    writeFileSync(outside, 'x');
    expect(extractReadFile(outside, projectDir)).toBeNull();
  });
  it('rejects undefined', () => {
    expect(extractReadFile(undefined, projectDir)).toBeNull();
  });
});

describe('extractGrepHits (pure)', () => {
  beforeEach(() => {
    makeFile('a.ts');
    makeFile('src/b.ts');
  });
  it('parses files_with_matches (bare path per line)', () => {
    const resp = 'a.ts\nsrc/b.ts\n';
    expect(extractGrepHits(resp, projectDir).sort()).toEqual(['a.ts', 'src/b.ts']);
  });
  it('parses content mode (path:line:text), stripping the suffix', () => {
    const resp = 'a.ts:12:const x = 1\nsrc/b.ts:3:export const y = 2';
    expect(extractGrepHits(resp, projectDir).sort()).toEqual(['a.ts', 'src/b.ts']);
  });
  it('dedupes repeated paths and ignores non-path text lines', () => {
    const resp = 'a.ts:1:foo\na.ts:2:bar\nthis is not a path\n';
    expect(extractGrepHits(resp, projectDir)).toEqual(['a.ts']);
  });
  it('returns [] for an object response with no paths', () => {
    expect(extractGrepHits({ matches: 0 }, projectDir)).toEqual([]);
  });
  it('rejects a valid-looking line whose path does not exist on disk', () => {
    expect(extractGrepHits('does/not/exist.ts:5:phantom\n', projectDir)).toEqual([]);
  });
  it('caps the number of hits', () => {
    for (let i = 0; i < 20; i++) makeFile(`f${i}.ts`);
    const resp = Array.from({ length: 20 }, (_, i) => `f${i}.ts`).join('\n');
    expect(extractGrepHits(resp, projectDir).length).toBeLessThanOrEqual(8);
  });
});

describe('integration: bus writes (real temp bus)', () => {
  it('recordRead adds a load-bearing read_for_context entry', async () => {
    makeFile('src/foo.ts');
    recordRead(join(projectDir, 'src/foo.ts'), projectDir);
    const bus = JSON.parse(readFileSync(await busFilePath(), 'utf-8'));
    const lb = bus.files_in_play.load_bearing;
    expect(lb.some((f: { path: string; role: string }) => f.path === 'src/foo.ts' && f.role === 'read_for_context')).toBe(true);
  });

  it('recordGrep adds ambient grep_hit entries', async () => {
    makeFile('a.ts');
    recordGrep('a.ts\n', projectDir);
    const bus = JSON.parse(readFileSync(await busFilePath(), 'utf-8'));
    const amb = bus.files_in_play.ambient;
    expect(amb.some((f: { path: string; role: string }) => f.path === 'a.ts' && f.role === 'grep_hit')).toBe(true);
  });

  it('CCV3_BUS_OFF=1 suppresses the bus write', async () => {
    process.env.CCV3_BUS_OFF = '1';
    makeFile('src/foo.ts');
    recordRead(join(projectDir, 'src/foo.ts'), projectDir);
    expect(existsSync(await busFilePath())).toBe(false);
  });
});
