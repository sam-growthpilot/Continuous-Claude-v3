/**
 * Tests for the lock-wait CAP + observability bag added to mutateStateWithLock
 * (WS-2 Phase B.0). These pin the NEW, backward-compatible options surface:
 *
 *   mutateStateWithLock(filePath, transformFn, opts?: MutateLockOptions)
 *     opts.lockTimeoutMs?  -- passed to acquireLockSync; DEFAULT STAYS 5000
 *     opts.onLockOutcome?  -- fired ALWAYS with { acquired, wait_ms }
 *     opts.onWriteTiming?  -- fired on the success path only with { write_ms }
 *
 * The point of B.0 is that a per-tool bus write can no longer HANG the hook on
 * the 5s default and can no longer drop SILENTLY: the caller gets an observable
 * outcome for every attempt, and a held lock returns within the configured cap
 * (here 200ms) WITHOUT clobbering the target file.
 *
 * To simulate "another process holds the lock" we pre-create <path>.lock with a
 * fresh mtime (so the 10s stale-detector does not reclaim it during the short
 * wait). The acquire then spins until the cap and returns false.
 *
 * Runner is vitest; ASCII only; Windows-safe temp paths.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mutateStateWithLock, releaseLockSync } from '../shared/atomic-write.js';

let dir: string;
let target: string;
let lockFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccv3-lockcap-'));
  target = join(dir, 'state.json');
  lockFile = target + '.lock';
});

afterEach(() => {
  // Make sure no lock file leaks between tests.
  try {
    releaseLockSync(target);
  } catch {
    /* ignore */
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe('mutateStateWithLock -- backward-compatible default (opts omitted)', () => {
  it('still writes normally when no opts are passed (5000 default unchanged)', () => {
    const out = mutateStateWithLock(target, () => JSON.stringify({ revision: 1 }));
    expect(out).toBe(true);
    expect(JSON.parse(readFileSync(target, 'utf-8')).revision).toBe(1);
  });

  it('an empty opts bag behaves identically to omitting it', () => {
    writeFileSync(target, JSON.stringify({ revision: 4 }), 'utf-8');
    const out = mutateStateWithLock(
      target,
      (current) => {
        const obj = JSON.parse(current as string);
        obj.revision += 1;
        return JSON.stringify(obj);
      },
      {},
    );
    expect(out).toBe(true);
    expect(JSON.parse(readFileSync(target, 'utf-8')).revision).toBe(5);
  });
});

describe('mutateStateWithLock -- onLockOutcome / onWriteTiming on the happy path', () => {
  it('fires onLockOutcome { acquired:true } and onWriteTiming on a normal write', () => {
    const outcomes: Array<{ acquired: boolean; wait_ms: number }> = [];
    const timings: Array<{ write_ms: number }> = [];

    const out = mutateStateWithLock(
      target,
      () => JSON.stringify({ ok: true }),
      {
        onLockOutcome: (o) => outcomes.push(o),
        onWriteTiming: (o) => timings.push(o),
      },
    );

    expect(out).toBe(true);
    // Exactly one lock outcome, acquired, with a non-negative wait.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].acquired).toBe(true);
    expect(typeof outcomes[0].wait_ms).toBe('number');
    expect(outcomes[0].wait_ms).toBeGreaterThanOrEqual(0);
    // Write timing fired exactly once on the success path.
    expect(timings).toHaveLength(1);
    expect(typeof timings[0].write_ms).toBe('number');
    expect(timings[0].write_ms).toBeGreaterThanOrEqual(0);
  });

  it('does NOT fire onWriteTiming when the transform returns null (no-op write)', () => {
    const outcomes: Array<{ acquired: boolean; wait_ms: number }> = [];
    const timings: Array<{ write_ms: number }> = [];
    const out = mutateStateWithLock(target, () => null, {
      onLockOutcome: (o) => outcomes.push(o),
      onWriteTiming: (o) => timings.push(o),
    });
    expect(out).toBe(false);
    // Lock WAS acquired (and reported), but no write happened -> no write timing.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].acquired).toBe(true);
    expect(timings).toHaveLength(0);
  });
});

describe('mutateStateWithLock -- held lock + small cap returns fast, no clobber', () => {
  it('returns false within ~cap and reports { acquired:false, wait_ms>=cap }', () => {
    // Seed a precious file we must NOT clobber.
    writeFileSync(target, JSON.stringify({ precious: true, revision: 7 }), 'utf-8');

    // Simulate another process holding the lock: pre-create a fresh lock file.
    writeFileSync(lockFile, `${process.pid}\n${Date.now()}`, 'utf-8');

    const outcomes: Array<{ acquired: boolean; wait_ms: number }> = [];
    const timings: Array<{ write_ms: number }> = [];

    const t0 = Date.now();
    let transformCalled = false;
    const out = mutateStateWithLock(
      target,
      () => {
        transformCalled = true;
        return JSON.stringify({ precious: false, revision: 999 });
      },
      {
        lockTimeoutMs: 200,
        onLockOutcome: (o) => outcomes.push(o),
        onWriteTiming: (o) => timings.push(o),
      },
    );
    const elapsed = Date.now() - t0;

    // Lock not acquired -> safe abort (no write).
    expect(out).toBe(false);
    // The transform never ran (we never got the lock).
    expect(transformCalled).toBe(false);
    // Returned within the cap window (generous slack for busy-spin under CPU
    // contention; the point is "<< the 5000ms default", not a tight upper bound).
    expect(elapsed).toBeLessThan(3000);
    expect(elapsed).toBeGreaterThanOrEqual(150);

    // onLockOutcome fired with acquired:false and a wait at/above the cap.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].acquired).toBe(false);
    expect(outcomes[0].wait_ms).toBeGreaterThanOrEqual(200);
    // No write timing on the dropped path.
    expect(timings).toHaveLength(0);

    // The precious file was NOT clobbered.
    const onDisk = JSON.parse(readFileSync(target, 'utf-8'));
    expect(onDisk.precious).toBe(true);
    expect(onDisk.revision).toBe(7);
  });

  it('does not create the target file at all when the lock is held (absent file case)', () => {
    // No seed: target absent. Held lock -> still no write, file stays absent.
    writeFileSync(lockFile, `${process.pid}\n${Date.now()}`, 'utf-8');
    const outcomes: Array<{ acquired: boolean; wait_ms: number }> = [];
    const out = mutateStateWithLock(target, () => JSON.stringify({ x: 1 }), {
      lockTimeoutMs: 200,
      onLockOutcome: (o) => outcomes.push(o),
    });
    expect(out).toBe(false);
    expect(existsSync(target)).toBe(false);
    expect(outcomes[0].acquired).toBe(false);
  });
});
