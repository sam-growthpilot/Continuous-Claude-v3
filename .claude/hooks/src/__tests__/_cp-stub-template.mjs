/**
 * child_process stub used ONLY by the fork-based herd test.
 *
 * The herd test bundles embedding-client.ts with esbuild and aliases
 * `child_process` to this stub so that:
 *   - `spawn` does NOT launch a real `uv` subprocess; instead it atomically
 *     appends one byte to the counter file at $CCV3_HERD_COUNTER. Counting the
 *     bytes across N forked children tells us how many reached the spawn.
 *   - `execFileSync` ('where uv') returns the fake uv path at $CCV3_UV_PATH so
 *     resolveUvPath() succeeds deterministically without touching the real PATH.
 *
 * Real fs is used for the marker so the count is durable across processes.
 */
import { openSync, writeSync, closeSync } from 'node:fs';

export function spawn() {
  const counter = process.env.CCV3_HERD_COUNTER;
  if (counter) {
    const fd = openSync(counter, 'a');
    try {
      writeSync(fd, 'X');
    } finally {
      closeSync(fd);
    }
  }
  return {
    on() {
      return this;
    },
    unref() {
      return this;
    },
    pid: 4242,
  };
}

export function execFileSync() {
  // Pretend `where uv` found the fake uv path. resolveUvPath prefers the
  // CCV3_UV_PATH env override before ever calling this, so this is a backstop.
  return process.env.CCV3_UV_PATH || '';
}

export default { spawn, execFileSync };
