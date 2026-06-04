/**
 * Smoke test for session-start-intel-prune (SessionStart wiring of pruneIntelBus).
 *
 * Asserts the WIRED path actually prunes: a rotated intel-bus generation older than the
 * 7-day retention window is deleted, a fresh one survives, and CCV3_BUS_OFF skips pruning.
 * Uses a real temp project dir + backdated mtime (not just "the hook fires").
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runPrune } from '../session-start-intel-prune.js';

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intel-prune-'));
  fs.mkdirSync(path.join(dir, '.claude', 'logs'), { recursive: true });
  return dir;
}

function writeRotated(dir: string, suffix: string, ageDays: number): string {
  const p = path.join(dir, '.claude', 'logs', `intel-bus.jsonl${suffix}`);
  fs.writeFileSync(p, '{"ts":"x","bus_id":"y","schema_version":1}\n');
  const when = (Date.now() - ageDays * 24 * 60 * 60 * 1000) / 1000;
  fs.utimesSync(p, when, when);
  return p;
}

describe('session-start-intel-prune', () => {
  const savedOff = process.env.CCV3_BUS_OFF;
  beforeEach(() => {
    delete process.env.CCV3_BUS_OFF;
  });
  afterEach(() => {
    if (savedOff === undefined) delete process.env.CCV3_BUS_OFF;
    else process.env.CCV3_BUS_OFF = savedOff;
  });

  it('prunes a rotated generation older than 7 days', () => {
    const dir = makeProject();
    const old = writeRotated(dir, '.1', 8); // 8 days old
    expect(fs.existsSync(old)).toBe(true);
    runPrune(dir);
    expect(fs.existsSync(old)).toBe(false);
  });

  it('keeps a fresh rotated generation', () => {
    const dir = makeProject();
    const fresh = writeRotated(dir, '.1', 1); // 1 day old
    runPrune(dir);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it('never touches the live log', () => {
    const dir = makeProject();
    const live = path.join(dir, '.claude', 'logs', 'intel-bus.jsonl');
    fs.writeFileSync(live, '{"ts":"x","bus_id":"y","schema_version":1}\n');
    const whenOld = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(live, whenOld, whenOld); // even an "old" live file must survive
    runPrune(dir);
    expect(fs.existsSync(live)).toBe(true);
  });

  it('CCV3_BUS_OFF=1 skips pruning (old generation survives)', () => {
    process.env.CCV3_BUS_OFF = '1';
    const dir = makeProject();
    const old = writeRotated(dir, '.1', 8);
    runPrune(dir);
    expect(fs.existsSync(old)).toBe(true);
  });
});
