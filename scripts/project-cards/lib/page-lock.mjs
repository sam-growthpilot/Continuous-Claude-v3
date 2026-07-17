// page-lock.mjs — a tiny file-based advisory lock shared by every writer of a
// contended Notion page. Generalized from the project-cards sweep's original
// single-instance `.sweep.lock` (sweep.mjs's acquireSweepLock/releaseSweepLock now
// DELEGATE here, so their behavior — and their tests — are unchanged).
//
// Two acquisition disciplines share ONE primitive (acquirePageLock — a single
// exclusive `wx` take with stale-holder replacement):
//   - single-instance (do-not-start-a-second): try ONCE; on 'held' the caller bows
//     out (the sweep exits 0). This is acquireSweepLock's discipline.
//   - bounded wait-then-proceed (availability > strictness): poll up to waitMs for a
//     live holder to release, then PROCEED ANYWAY with a loud warn — the lock only
//     REDUCES overlap on the shared hub page, it must never deadlock a pipeline.
//     acquirePageLockWaiting + the hub writers use this.
//
// The one named lock the reporting system shares — the Reporting Hub page, written
// by three independently-scheduled writers (the project-cards sweep's cockpit +
// gallery, report-registry refresh-pages' launcher, and the dashboard-sync job) —
// is exported here (HUB_LOCK_*) so both spines resolve the SAME absolute path.
// ESM, no external deps.
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// This module lives in scripts/project-cards/lib/ ; the project-cards ROOT is two up
// — the same dir sweep's .sweep.lock lives in, so .hub.lock sits beside it.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// --- shared hub-page lock (single source of truth for BOTH spines) ---
export const HUB_LOCK_PATH = join(ROOT, '.hub.lock');
export const HUB_LOCK_STALE_MS = 10 * 60_000; // a crashed holder's leftover after 10min
export const HUB_LOCK_WAIT_MS = 60_000;       // poll a live holder for up to 60s
export const HUB_LOCK_POLL_MS = 1_000;        // re-check the lock every 1s

// --- primitive: single exclusive take with stale-holder replacement ---

// Try to take `path` exclusively. Returns 'acquired' on a clean take,
// 'stale-replaced' when a lock older than staleMs (a crashed holder's leftover) was
// swept aside and re-taken, or 'held' when a live holder still owns it. Writes a
// {pid, ts} payload; an unreadable/corrupt lock counts as stale. Semantics are
// verbatim the original acquireSweepLock (which now delegates here).
export function acquirePageLock(path, { staleMs = 30 * 60_000, nowMs = Date.now() } = {}) {
  const payload = `${JSON.stringify({ pid: process.pid, ts: new Date(nowMs).toISOString() })}\n`;
  const tryTake = () => writeFileSync(path, payload, { flag: 'wx' });
  try {
    tryTake();
    return 'acquired';
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  // Lock exists — stale (crashed run) or genuinely held?
  let heldTs = NaN;
  try {
    heldTs = new Date(JSON.parse(readFileSync(path, 'utf8')).ts).getTime();
  } catch { /* unreadable/corrupt lock counts as stale */ }
  if (!Number.isFinite(heldTs) || nowMs - heldTs > staleMs) {
    try { unlinkSync(path); } catch { /* raced: fall through to retake attempt */ }
    try {
      tryTake();
      return 'stale-replaced';
    } catch {
      return 'held'; // another process re-took it between unlink and create
    }
  }
  return 'held';
}

export function releasePageLock(path) {
  try { unlinkSync(path); } catch { /* best-effort */ }
}

// --- synchronous sleep (no busy-spin) ---
// Block the thread for `ms` without burning CPU. The hub writers are short-lived
// CLIs that already block on spawnSync for every ntn/claude call, so a synchronous
// poll-sleep matches the surrounding style (there is no event loop to starve).
function sleepSync(ms) {
  if (!(ms > 0)) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms; // SharedArrayBuffer unavailable — bounded spin fallback
    while (Date.now() < end) { /* wait */ }
  }
}

// --- discipline: bounded wait-then-proceed ---

// Poll acquirePageLock up to waitMs, sleeping pollMs between attempts. Returns
// { acquired, status, waitedMs }:
//   - acquired:true  — we took the lock (status 'acquired' or 'stale-replaced');
//     the caller MUST releasePageLock(path) once its write is done.
//   - acquired:false — the wait elapsed with a live holder still owning it; the
//     caller PROCEEDS ANYWAY (availability > strictness) and releases NOTHING.
// The loop NEVER deadlocks: a held lock older than staleMs is stale-replaced on the
// next poll, and the deadline bounds the wait regardless. `now`/`sleep` are
// injectable so a test can drive the clock without waiting in real time.
export function acquirePageLockWaiting(path, {
  staleMs = HUB_LOCK_STALE_MS, waitMs = HUB_LOCK_WAIT_MS, pollMs = HUB_LOCK_POLL_MS,
  now = Date.now, sleep = sleepSync,
} = {}) {
  const deadline = now() + waitMs;
  let waitedMs = 0;
  for (;;) {
    const status = acquirePageLock(path, { staleMs, nowMs: now() });
    if (status !== 'held') return { acquired: true, status, waitedMs };
    if (now() >= deadline) return { acquired: false, status: 'held', waitedMs };
    sleep(pollMs);
    waitedMs += pollMs;
  }
}
