/**
 * Tests for the atomic-write `mutateStateWithLock` primitive (WS-2 Phase A,
 * review finding #1: CAS-under-one-lock).
 *
 * The existing writeStateWithLock / acquireLockSync / releaseLockSync /
 * atomicWriteSync surface is exercised indirectly by the hooks that use it; the
 * NEW primitive added here is mutateStateWithLock(path, transformFn), which must
 * perform read -> apply -> write ALL inside a SINGLE lock hold so two writers
 * can never observe the same pre-image and clobber each other (lost update /
 * TOCTOU). This file pins that primitive's contract:
 *
 *  - acquires the lock exactly ONCE, reads current content under it, applies
 *    transformFn(current | null), writes atomically, releases in finally
 *  - transformFn returning null is a NO-OP (no file written / no clobber)
 *  - the lock is HELD across the whole read->write window (proven by a reentrant
 *    acquire attempt failing while the transform runs)
 *  - a genuinely-absent file presents `null` to the transform (ENOENT path)
 *  - fail-open: a throwing transform never corrupts the file and never throws
 *    out of the primitive
 *
 * Runner is vitest; ASCII only; Windows-safe temp paths.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  mutateStateWithLock,
  acquireLockSync,
  releaseLockSync,
} from '../shared/atomic-write.js';

let dir: string;
let target: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccv3-atomic-'));
  target = join(dir, 'state.json');
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe('mutateStateWithLock -- single-lock read/apply/write', () => {
  it('presents null to the transform when the file is absent and writes the result', () => {
    let seen: string | null = 'unset';
    const out = mutateStateWithLock(target, (current) => {
      seen = current;
      return JSON.stringify({ revision: 1 });
    });
    expect(seen).toBeNull(); // genuinely-absent -> null pre-image
    expect(out).toBe(true); // a write happened
    expect(JSON.parse(readFileSync(target, 'utf-8')).revision).toBe(1);
  });

  it('presents the existing content to the transform and overwrites atomically', () => {
    writeFileSync(target, JSON.stringify({ revision: 5 }), 'utf-8');
    let seen: string | null = null;
    mutateStateWithLock(target, (current) => {
      seen = current;
      const obj = JSON.parse(current as string);
      obj.revision += 1;
      return JSON.stringify(obj);
    });
    expect(JSON.parse(seen as unknown as string).revision).toBe(5);
    expect(JSON.parse(readFileSync(target, 'utf-8')).revision).toBe(6);
  });

  it('treats a null transform return as a NO-OP (no file created, no clobber)', () => {
    // Absent file + transform decides not to write.
    const out = mutateStateWithLock(target, () => null);
    expect(out).toBe(false);
    expect(existsSync(target)).toBe(false);
  });

  it('a null transform return does NOT clobber an existing file', () => {
    writeFileSync(target, JSON.stringify({ keep: 'me', revision: 9 }), 'utf-8');
    const out = mutateStateWithLock(target, () => null);
    expect(out).toBe(false);
    const onDisk = JSON.parse(readFileSync(target, 'utf-8'));
    expect(onDisk.keep).toBe('me');
    expect(onDisk.revision).toBe(9);
  });

  it('HOLDS the lock across the entire read->write window', () => {
    // While the transform runs, a competing lock acquire on the SAME path must
    // fail (proving the lock is held for the whole critical section, not just
    // the write). We use a 0ms timeout so the probe returns immediately.
    let lockHeldDuringTransform: boolean | undefined;
    mutateStateWithLock(target, (current) => {
      const acquired = acquireLockSync(target, 0);
      if (acquired) {
        // Should not happen; release so we don't leak a lock file.
        releaseLockSync(target);
        lockHeldDuringTransform = false;
      } else {
        lockHeldDuringTransform = true;
      }
      return JSON.stringify({ ok: true, current });
    });
    expect(lockHeldDuringTransform).toBe(true);
    // Lock is released after the call (a fresh acquire now succeeds).
    expect(acquireLockSync(target, 0)).toBe(true);
    releaseLockSync(target);
  });

  it('releases the lock even when the transform throws, and does not corrupt the file', () => {
    writeFileSync(target, JSON.stringify({ revision: 3 }), 'utf-8');
    expect(() =>
      mutateStateWithLock(target, () => {
        throw new Error('boom inside transform');
      }),
    ).not.toThrow();
    // File untouched.
    expect(JSON.parse(readFileSync(target, 'utf-8')).revision).toBe(3);
    // Lock was released in finally -> a fresh acquire succeeds.
    expect(acquireLockSync(target, 0)).toBe(true);
    releaseLockSync(target);
  });

  it('serializes two mutations so neither pre-image is lost (sequential, lock-backed)', () => {
    // Two increments through the primitive must compose: 0 -> 1 -> 2, never
    // 0 -> 1 -> 1. (The single-lock contract is what makes this safe under real
    // concurrency; here we prove the read-inside-lock semantics compose.)
    writeFileSync(target, JSON.stringify({ revision: 0 }), 'utf-8');
    const bump = (current: string | null): string => {
      const obj = current ? JSON.parse(current) : { revision: 0 };
      obj.revision += 1;
      return JSON.stringify(obj);
    };
    mutateStateWithLock(target, bump);
    mutateStateWithLock(target, bump);
    expect(JSON.parse(readFileSync(target, 'utf-8')).revision).toBe(2);
  });
});
