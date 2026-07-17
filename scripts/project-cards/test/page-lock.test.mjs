// page-lock.test.mjs — unit tests for the shared file-based page lock
// (lib/page-lock.mjs). Mirrors the acquireSweepLock tests in sweep.test.mjs style:
// a real temp lock file + a fake clock/sleep for the bounded-wait discipline (no
// real waiting). The sweep's own acquireSweepLock/releaseSweepLock delegation is
// covered by sweep.test.mjs; here we test the generalized primitives directly.
// Run: node scripts/project-cards/test/page-lock.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquirePageLock, releasePageLock, acquirePageLockWaiting,
  HUB_LOCK_PATH, HUB_LOCK_STALE_MS, HUB_LOCK_WAIT_MS, HUB_LOCK_POLL_MS,
} from '../lib/page-lock.mjs';

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log(`  ok - ${name}`);
}

const lockDir = mkdtempSync(join(tmpdir(), 'pc-pagelock-'));
const lockPath = join(lockDir, '.page.lock');
const STALE = 10 * 60_000;

// --- primitive: acquirePageLock / releasePageLock ----------------------------

test('acquirePageLock: clean acquire writes pid+ts payload; release removes it', () => {
  assert.equal(acquirePageLock(lockPath, { staleMs: STALE }), 'acquired');
  const payload = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.equal(payload.pid, process.pid);
  assert.ok(payload.ts);
  releasePageLock(lockPath);
  assert.ok(!existsSync(lockPath));
});

test('acquirePageLock: fresh lock held by another run -> held', () => {
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: new Date().toISOString() }), 'utf8');
  assert.equal(acquirePageLock(lockPath, { staleMs: STALE }), 'held');
  releasePageLock(lockPath);
});

test('acquirePageLock: lock older than staleMs is treated as stale and replaced', () => {
  const old = new Date(Date.now() - (STALE + 60_000)).toISOString();
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: old }), 'utf8');
  assert.equal(acquirePageLock(lockPath, { staleMs: STALE }), 'stale-replaced');
  assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).pid, process.pid);
  releasePageLock(lockPath);
});

test('acquirePageLock: corrupt/unreadable lock file counts as stale', () => {
  writeFileSync(lockPath, 'not json at all', 'utf8');
  assert.equal(acquirePageLock(lockPath, { staleMs: STALE }), 'stale-replaced');
  releasePageLock(lockPath);
});

test('acquirePageLock: staleMs boundary — a lock exactly at staleMs is still held', () => {
  const now = 10_000_000;
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: new Date(now - STALE).toISOString() }), 'utf8');
  // nowMs - heldTs === staleMs is NOT strictly greater -> held (not yet stale).
  assert.equal(acquirePageLock(lockPath, { staleMs: STALE, nowMs: now }), 'held');
  releasePageLock(lockPath);
});

// --- discipline: acquirePageLockWaiting (bounded wait-then-proceed) -----------

test('acquirePageLockWaiting: free lock -> acquired immediately (no wait)', () => {
  const r = acquirePageLockWaiting(lockPath, { staleMs: STALE, waitMs: 60_000, pollMs: 1_000 });
  assert.equal(r.acquired, true);
  assert.equal(r.status, 'acquired');
  assert.equal(r.waitedMs, 0);
  releasePageLock(lockPath);
});

test('acquirePageLockWaiting: stale holder is swept aside -> acquired (stale-replaced)', () => {
  const old = new Date(Date.now() - (STALE + 60_000)).toISOString();
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: old }), 'utf8');
  const r = acquirePageLockWaiting(lockPath, { staleMs: STALE, waitMs: 60_000, pollMs: 1_000 });
  assert.equal(r.acquired, true);
  assert.equal(r.status, 'stale-replaced');
  releasePageLock(lockPath);
});

test('acquirePageLockWaiting: live holder + wait elapses -> proceed anyway (acquired=false), releases nothing', () => {
  // A genuinely-held lock (fresh ts) that never releases. Drive a FAKE clock via the
  // injected sleep so the 60s wait resolves instantly across 60 polls.
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: new Date().toISOString() }), 'utf8');
  let t = 0;
  const now = () => t;
  const sleep = (ms) => { t += ms; };
  const r = acquirePageLockWaiting(lockPath, {
    staleMs: STALE, waitMs: 60_000, pollMs: 1_000, now, sleep,
  });
  assert.equal(r.acquired, false);
  assert.equal(r.status, 'held');
  assert.equal(r.waitedMs, 60_000);
  // the holder's lock file is untouched (we proceed WITHOUT owning it)
  assert.equal(JSON.parse(readFileSync(lockPath, 'utf8')).pid, 99999);
  releasePageLock(lockPath);
});

test('acquirePageLockWaiting: holder releases mid-wait -> acquired on the next poll', () => {
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: new Date().toISOString() }), 'utf8');
  let t = 0;
  const now = () => t;
  let polls = 0;
  // release the (fresh, non-stale) holder after 3 polls to prove the loop re-checks
  const sleep = (ms) => { t += ms; polls += 1; if (polls === 3) releasePageLock(lockPath); };
  const r = acquirePageLockWaiting(lockPath, {
    staleMs: STALE, waitMs: 60_000, pollMs: 1_000, now, sleep,
  });
  assert.equal(r.acquired, true);
  assert.equal(r.status, 'acquired');
  assert.equal(r.waitedMs, 3_000); // acquired on the 4th attempt, after 3 sleeps
  releasePageLock(lockPath);
});

test('acquirePageLockWaiting: waitMs=0 tries exactly once (no sleep) on a live holder', () => {
  writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: new Date().toISOString() }), 'utf8');
  let slept = 0;
  const r = acquirePageLockWaiting(lockPath, {
    staleMs: STALE, waitMs: 0, pollMs: 1_000, now: () => 0, sleep: () => { slept += 1; },
  });
  assert.equal(r.acquired, false);
  assert.equal(r.waitedMs, 0);
  assert.equal(slept, 0, 'no sleep when the deadline is immediate');
  releasePageLock(lockPath);
});

// --- shared hub-lock constants (single source of truth for both spines) ------

test('hub-lock constants: .hub.lock beside the sweep lock, 10min stale / 60s wait / 1s poll', () => {
  assert.ok(HUB_LOCK_PATH.endsWith('.hub.lock'), 'HUB_LOCK_PATH ends with .hub.lock');
  // resolves under scripts/project-cards (the same dir the sweep's .sweep.lock uses)
  assert.match(HUB_LOCK_PATH.replace(/\\/g, '/'), /scripts\/project-cards\/\.hub\.lock$/);
  assert.equal(HUB_LOCK_STALE_MS, 10 * 60_000);
  assert.equal(HUB_LOCK_WAIT_MS, 60_000);
  assert.equal(HUB_LOCK_POLL_MS, 1_000);
});

try { rmSync(lockDir, { recursive: true, force: true }); } catch { /* best-effort */ }

console.log(`\n${pass} passed`);
