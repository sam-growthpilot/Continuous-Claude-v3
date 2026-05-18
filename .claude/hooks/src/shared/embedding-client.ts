/**
 * BGE Embedding Daemon Client (TypeScript)
 *
 * Talks to the long-lived BGE-large embedding daemon at
 * ``opc/scripts/core/embedding_daemon.py`` (Task #11 Path A).
 *
 * Protocol:
 *   * Transport: TCP loopback on 127.0.0.1:<port>, TCP_NODELAY.
 *   * Framing: 4-byte big-endian uint32 length prefix + JSON UTF-8 payload.
 *   * Frame size cap: 100 MB (mirror of daemon-side sanity cap).
 *
 * Discovery:
 *   * Daemon writes ``$TEMP/ccv3-embedding.json`` AFTER the model is loaded.
 *     File contents:
 *       { "pid": int, "port": int, "started_at": float,
 *         "model": "BAAI/bge-large-en-v1.5", "dim": 1024 }
 *   * Clients read this file to find the daemon. Absence (or stale PID)
 *     means "daemon not ready" and we fall back to text-only recall.
 *
 * Commands:
 *   * ``{"cmd":"ping"}`` -> ``{"ok":true,"ready":bool,"model":str,"dim":int}``
 *   * ``{"cmd":"embed","text":str}`` -> ``{"vector":[...],"elapsed_ms":float,"dim":int}``
 *   * ``{"cmd":"embed_batch","texts":[str,...]}`` -> ``{"vectors":[[...]],"count":int}``
 *   * ``{"cmd":"shutdown"}`` -> ``{"ok":true}``
 *
 * NB: This is a separate module from ``daemon-client.ts`` (which talks to
 * the TLDR daemon using newline-delimited JSON, not length-prefixed).
 * The two daemons share neither protocol nor lifecycle so they don't share
 * code -- only conventions.
 */

import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import * as net from 'net';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Discovery file path. Daemon writes this AFTER warmup. */
const DAEMON_INFO_PATH = join(tmpdir(), 'ccv3-embedding.json');

/** Frame size cap (matches Python daemon's 100 MB sanity check). */
const FRAME_SIZE_CAP_BYTES = 100 * 1024 * 1024;

/** Default ping timeout: 200ms (matches Python EMBED_DAEMON_PING_TIMEOUT_S). */
const DEFAULT_PING_TIMEOUT_MS = 200;

/** Default embed timeout: 1500ms (hot encode is ~30-100ms, slack for cold cases). */
const DEFAULT_EMBED_TIMEOUT_MS = 1500;

/** Expected model + dim for sanity-check. */
const EXPECTED_MODEL = 'BAAI/bge-large-en-v1.5';
const EXPECTED_DIM = 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Contents of the daemon discovery file. Matches the Python daemon's
 * ``_write_daemon_info`` output.
 */
export interface DaemonInfo {
  pid: number;
  port: number;
  started_at: number;
  model: string;
  dim: number;
}

/**
 * Response from the daemon's ``ping`` command.
 */
export interface PingResponse {
  ok: boolean;
  ready: boolean;
  model?: string;
  dim?: number;
}

// ---------------------------------------------------------------------------
// Frame protocol helpers (length-prefixed JSON)
// ---------------------------------------------------------------------------

/**
 * Send a length-prefixed JSON frame on a connected socket.
 *
 * Frame layout: 4-byte big-endian uint32 length + UTF-8 JSON payload.
 */
function sendFrame(sock: net.Socket, obj: unknown): void {
  const payload = Buffer.from(JSON.stringify(obj), 'utf-8');
  if (payload.length > FRAME_SIZE_CAP_BYTES) {
    throw new Error(`frame too large: ${payload.length} bytes`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  sock.write(Buffer.concat([header, payload]));
}

/**
 * Read a length-prefixed JSON frame from a socket. Resolves with the
 * parsed object once the full payload arrives or rejects on timeout/error.
 *
 * The socket is left open by this helper; the caller closes it when done.
 */
function recvFrame(sock: net.Socket, timeoutMs: number): Promise<any> {
  return new Promise((res, rej) => {
    let received = Buffer.alloc(0);
    let expectedLen: number | null = null;
    let settled = false;

    const finish = (cb: () => void) => {
      if (settled) return;
      settled = true;
      sock.removeAllListeners('data');
      sock.removeAllListeners('error');
      sock.removeAllListeners('close');
      sock.removeAllListeners('timeout');
      sock.setTimeout(0);
      cb();
    };

    sock.setTimeout(timeoutMs, () => {
      finish(() => rej(new Error('frame read timeout')));
    });

    sock.on('error', (err) => {
      finish(() => rej(err));
    });

    sock.on('close', () => {
      finish(() =>
        rej(new Error(`socket closed after ${received.length} bytes`)),
      );
    });

    sock.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      // Read the 4-byte header once enough data has arrived.
      if (expectedLen === null && received.length >= 4) {
        expectedLen = received.readUInt32BE(0);
        if (expectedLen > FRAME_SIZE_CAP_BYTES) {
          finish(() => rej(new Error(`frame too large: ${expectedLen} bytes`)));
          return;
        }
      }
      if (expectedLen !== null && received.length >= 4 + expectedLen) {
        const payload = received.subarray(4, 4 + expectedLen);
        try {
          const parsed = JSON.parse(payload.toString('utf-8'));
          finish(() => res(parsed));
        } catch (err) {
          finish(() => rej(err as Error));
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Discovery + liveness
// ---------------------------------------------------------------------------

/**
 * Read the daemon discovery file. Returns ``null`` if it's missing,
 * unreadable, or fails JSON parse.
 *
 * Does NOT check that the PID is alive -- use ``isDaemonAlive`` for that.
 */
export function readDaemonInfo(): DaemonInfo | null {
  if (!existsSync(DAEMON_INFO_PATH)) return null;
  try {
    const raw = readFileSync(DAEMON_INFO_PATH, 'utf-8');
    const obj = JSON.parse(raw);
    if (
      typeof obj !== 'object' ||
      obj === null ||
      typeof obj.pid !== 'number' ||
      typeof obj.port !== 'number' ||
      typeof obj.started_at !== 'number' ||
      typeof obj.model !== 'string' ||
      typeof obj.dim !== 'number'
    ) {
      return null;
    }
    return obj as DaemonInfo;
  } catch {
    return null;
  }
}

/**
 * Check if the daemon PID is alive. Cross-platform.
 *
 * On Node, ``process.kill(pid, 0)`` works on both Unix and Windows
 * (it returns a stat probe, never sends a signal). On Unix it raises
 * ESRCH for dead PIDs. On Windows it raises ENOENT for dead PIDs.
 * In both cases the throw means "not alive".
 */
export function isDaemonAlive(info: DaemonInfo): boolean {
  if (info.pid <= 0) return false;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch (err: any) {
    // EPERM means the process exists but we lack permission to signal it;
    // treat that as alive (rare in practice for a daemon we just spawned).
    if (err && err.code === 'EPERM') return true;
    return false;
  }
}

/**
 * Probe the daemon over TCP with a ping. Resolves with the ping response
 * or ``null`` on connect error / timeout / malformed reply.
 *
 * Returns ``ready=true`` only when the model is fully loaded daemon-side
 * (i.e. embed calls will run at hot-path latency).
 */
export async function pingDaemon(
  info: DaemonInfo,
  timeoutMs: number = DEFAULT_PING_TIMEOUT_MS,
): Promise<PingResponse | null> {
  return new Promise<PingResponse | null>((res) => {
    const sock = new net.Socket();
    let settled = false;

    const cleanup = (val: PingResponse | null) => {
      if (settled) return;
      settled = true;
      try {
        sock.setTimeout(0);
        sock.destroy();
      } catch {
        /* socket already closed */
      }
      res(val);
    };

    // Connect-side timeout. If we don't connect in `timeoutMs` we bail.
    const connectTimer = setTimeout(() => cleanup(null), timeoutMs);

    sock.once('error', () => {
      clearTimeout(connectTimer);
      cleanup(null);
    });

    sock.connect(info.port, '127.0.0.1', () => {
      clearTimeout(connectTimer);
      try {
        sock.setNoDelay(true);
      } catch {
        /* setNoDelay can throw on some Windows builds; safe to ignore */
      }
      try {
        sendFrame(sock, { cmd: 'ping' });
      } catch {
        cleanup(null);
        return;
      }
      recvFrame(sock, timeoutMs)
        .then((reply) => {
          if (
            reply &&
            typeof reply === 'object' &&
            typeof reply.ok === 'boolean' &&
            typeof reply.ready === 'boolean'
          ) {
            cleanup(reply as PingResponse);
          } else {
            cleanup(null);
          }
        })
        .catch(() => cleanup(null));
    });
  });
}

/**
 * Embed a single string via the daemon. Returns the vector or ``null``
 * on any failure (no daemon, dim mismatch, timeout, transport error).
 *
 * Callers that get ``null`` should fall back to text-only recall (or
 * in-process embedding, depending on context). We never throw from this
 * helper -- the hook budget is too tight to let an embedding bug crash
 * the prompt pipeline.
 */
export async function embedText(
  text: string,
  opts: { timeoutMs?: number } = {},
): Promise<number[] | null> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;
  const info = readDaemonInfo();
  if (!info) return null;
  if (!isDaemonAlive(info)) return null;

  return new Promise<number[] | null>((res) => {
    const sock = new net.Socket();
    let settled = false;

    const cleanup = (val: number[] | null) => {
      if (settled) return;
      settled = true;
      try {
        sock.setTimeout(0);
        sock.destroy();
      } catch {
        /* socket already closed */
      }
      res(val);
    };

    const connectTimer = setTimeout(() => cleanup(null), timeoutMs);

    sock.once('error', () => {
      clearTimeout(connectTimer);
      cleanup(null);
    });

    sock.connect(info.port, '127.0.0.1', () => {
      clearTimeout(connectTimer);
      try {
        sock.setNoDelay(true);
      } catch {
        /* ignore */
      }
      try {
        sendFrame(sock, { cmd: 'embed', text });
      } catch {
        cleanup(null);
        return;
      }
      recvFrame(sock, timeoutMs)
        .then((reply) => {
          if (
            reply &&
            typeof reply === 'object' &&
            Array.isArray(reply.vector) &&
            reply.vector.every((v: unknown) => typeof v === 'number')
          ) {
            cleanup(reply.vector as number[]);
          } else {
            cleanup(null);
          }
        })
        .catch(() => cleanup(null));
    });
  });
}

/**
 * One-call helper: returns ``true`` only when the daemon is alive AND
 * ready to serve embed requests at hot-path latency.
 *
 * Use this to gate "do hybrid (vector + FTS) recall this prompt vs fall
 * back to text-only".
 */
export async function isDaemonReady(): Promise<boolean> {
  const info = readDaemonInfo();
  if (!info) return false;
  if (!isDaemonAlive(info)) return false;
  // Sanity-check model + dim before doing the network ping. A daemon
  // running a different model would silently produce vectors that don't
  // match the archival_memory schema.
  if (info.model !== EXPECTED_MODEL || info.dim !== EXPECTED_DIM) return false;
  const reply = await pingDaemon(info);
  if (!reply) return false;
  if (!reply.ok || !reply.ready) return false;
  // Optional: re-verify the model from the ping reply (defends against
  // a daemon that wrote a stale discovery file).
  if (reply.model && reply.model !== EXPECTED_MODEL) return false;
  if (reply.dim && reply.dim !== EXPECTED_DIM) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Daemon spawn (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to the repo root containing the ``opc/``
 * project. We try, in order:
 *   1. ``$CLAUDE_PROJECT_DIR`` (set by Claude Code at session start).
 *   2. Walk up from this module's location looking for an ``opc/`` sibling.
 *
 * Returns ``null`` if we can't find a repo with ``opc/`` -- caller should
 * skip the spawn attempt.
 */
function resolveRepoRoot(): string | null {
  const envDir = process.env.CLAUDE_PROJECT_DIR;
  if (envDir && existsSync(join(envDir, 'opc'))) {
    return resolve(envDir);
  }
  // Walk up from this module's location. After esbuild bundling, the
  // ``__filename`` of the dist module will be something like
  // ``<repo>/.claude/hooks/dist/memory-awareness.mjs``. The repo root is
  // 3 levels up from there.
  //
  // We can't use ``__filename`` directly in ESM (esbuild emits ESM),
  // so we use ``import.meta.url`` via a workaround safe under both
  // bundler modes.
  try {
    // process.argv[1] is the entry script (dist/memory-awareness.mjs).
    const entry = process.argv[1];
    if (entry) {
      // Walk up looking for opc/
      let dir = resolve(entry);
      for (let i = 0; i < 10; i++) {
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
        if (existsSync(join(dir, 'opc', 'scripts', 'core', 'embedding_daemon.py'))) {
          return dir;
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Single-process guard for the spawn helper. If another hook call already
 * triggered a spawn in this Node process, we don't try again. The Python
 * daemon itself is idempotent across processes (the port is already in
 * use, so a second daemon would fail to bind), but skipping the spawn
 * call avoids the subprocess overhead.
 */
let _spawnAttempted = false;

/**
 * Fire-and-forget: spawn the embedding daemon detached, if it isn't
 * already running. Returns immediately -- does NOT wait for warmup.
 *
 * Strategy: this call is the "warm cache for the NEXT prompt" lever.
 * The caller has already decided to fall back to text-only for THIS
 * prompt because the daemon isn't ready.
 *
 * Idempotent: no-op if the discovery file is present and PID is alive
 * (the daemon is up). If the discovery file is present but PID is dead,
 * we still spawn -- the new daemon will overwrite the stale info file
 * after warmup.
 */
export function ensureDaemonRunning(): void {
  if (_spawnAttempted) return;
  _spawnAttempted = true;

  // Bail early if a healthy daemon is already running.
  const info = readDaemonInfo();
  if (info && isDaemonAlive(info)) return;

  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    console.error(
      '[embedding-client] cannot locate repo root; daemon will not be spawned',
    );
    return;
  }

  try {
    // ``uv run --project opc python <script> --daemon`` resolves the
    // sentence-transformers + torch deps from opc/.venv. ``stdio: ignore``
    // detaches the daemon's stdout/stderr so the parent doesn't block on
    // pipe writes. ``unref()`` lets the parent process exit without
    // waiting for the daemon -- which is exactly what we want for a hook
    // call.
    const child = spawn(
      'uv',
      ['run', '--project', 'opc', 'python', 'opc/scripts/core/embedding_daemon.py', '--daemon'],
      {
        cwd: repoRoot,
        detached: true,
        stdio: 'ignore',
        // shell: true is needed on Windows for `uv` (a .exe shim) to
        // resolve via PATH from a detached spawn -- without it, ENOENT.
        shell: process.platform === 'win32',
      },
    );
    child.on('error', (err) => {
      console.error(
        `[embedding-client] daemon spawn error: ${err.message ?? err}`,
      );
    });
    child.unref();
  } catch (err: any) {
    console.error(
      `[embedding-client] daemon spawn failed: ${err?.message ?? err}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Exports for tests
// ---------------------------------------------------------------------------

/**
 * Internal helpers exposed for tests. Not part of the public hook surface.
 */
export const __test = {
  DAEMON_INFO_PATH,
  FRAME_SIZE_CAP_BYTES,
  DEFAULT_PING_TIMEOUT_MS,
  DEFAULT_EMBED_TIMEOUT_MS,
  EXPECTED_MODEL,
  EXPECTED_DIM,
  sendFrame,
  recvFrame,
  resetSpawnAttempted: () => {
    _spawnAttempted = false;
  },
};
