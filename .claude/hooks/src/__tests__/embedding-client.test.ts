/**
 * Tests for BGE Embedding Daemon Client.
 *
 * Validates:
 *   * Length-prefixed JSON framing (4-byte big-endian uint32 length + UTF-8 body).
 *   * Discovery file parsing.
 *   * PID liveness check.
 *   * Ping happy-path against a mock server.
 *   * Ping bails fast when daemon is unreachable.
 *   * isDaemonReady() short-circuits on missing discovery file.
 *
 * The mock server speaks the same length-prefixed protocol as the real
 * Python daemon at opc/scripts/core/embedding_daemon.py.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as net from 'net';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import {
  readDaemonInfo,
  isDaemonAlive,
  pingDaemon,
  embedText,
  isDaemonReady,
  __test,
  type DaemonInfo,
} from '../shared/embedding-client.js';

const DISCOVERY_PATH = __test.DAEMON_INFO_PATH;
const EXPECTED_MODEL = __test.EXPECTED_MODEL;
const EXPECTED_DIM = __test.EXPECTED_DIM;

/**
 * Read one length-prefixed frame from a socket, parse JSON.
 * Mirrors the Python daemon's _recv_frame.
 */
function recvFrame(sock: net.Socket): Promise<any> {
  return new Promise((res, rej) => {
    let buf = Buffer.alloc(0);
    let expectedLen: number | null = null;
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (expectedLen === null && buf.length >= 4) {
        expectedLen = buf.readUInt32BE(0);
      }
      if (expectedLen !== null && buf.length >= 4 + expectedLen) {
        const payload = buf.subarray(4, 4 + expectedLen).toString('utf-8');
        try {
          res(JSON.parse(payload));
        } catch (e) {
          rej(e);
        }
      }
    });
    sock.on('error', rej);
  });
}

/**
 * Write a length-prefixed frame on a socket.
 */
function sendFrame(sock: net.Socket, obj: unknown): void {
  const payload = Buffer.from(JSON.stringify(obj), 'utf-8');
  const hdr = Buffer.alloc(4);
  hdr.writeUInt32BE(payload.length, 0);
  sock.write(Buffer.concat([hdr, payload]));
}

/**
 * Start a mock TCP server that mirrors the Python daemon's request/reply.
 * Returns the bound port.
 */
function startMockServer(
  handle: (cmd: any) => any,
): Promise<{ server: net.Server; port: number }> {
  return new Promise((res, rej) => {
    const server = net.createServer((sock) => {
      recvFrame(sock)
        .then((req) => {
          const reply = handle(req);
          sendFrame(sock, reply);
          // Don't close immediately — let the client read first.
          setImmediate(() => sock.end());
        })
        .catch(() => {
          try { sock.destroy(); } catch { /* ignore */ }
        });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr && 'port' in addr) {
        res({ server, port: addr.port });
      } else {
        rej(new Error('failed to get bound port'));
      }
    });
    server.on('error', rej);
  });
}

/**
 * Save + restore the discovery file between tests so each test starts
 * from a known state.
 */
let savedDiscovery: Buffer | null = null;
beforeAll(() => {
  if (existsSync(DISCOVERY_PATH)) {
    const fs = require('fs');
    savedDiscovery = fs.readFileSync(DISCOVERY_PATH);
    fs.unlinkSync(DISCOVERY_PATH);
  }
});
afterAll(() => {
  if (savedDiscovery) {
    writeFileSync(DISCOVERY_PATH, savedDiscovery);
  }
});

beforeEach(() => {
  if (existsSync(DISCOVERY_PATH)) {
    try { unlinkSync(DISCOVERY_PATH); } catch { /* ignore */ }
  }
  __test.resetSpawnAttempted();
});

afterEach(() => {
  if (existsSync(DISCOVERY_PATH)) {
    try { unlinkSync(DISCOVERY_PATH); } catch { /* ignore */ }
  }
});

describe('readDaemonInfo', () => {
  it('returns null when discovery file is missing', () => {
    expect(readDaemonInfo()).toBeNull();
  });

  it('parses a well-formed discovery file', () => {
    const info: DaemonInfo = {
      pid: process.pid,
      port: 12345,
      started_at: Date.now() / 1000,
      model: EXPECTED_MODEL,
      dim: EXPECTED_DIM,
    };
    writeFileSync(DISCOVERY_PATH, JSON.stringify(info));
    const got = readDaemonInfo();
    expect(got).not.toBeNull();
    expect(got?.pid).toBe(info.pid);
    expect(got?.port).toBe(info.port);
    expect(got?.model).toBe(info.model);
    expect(got?.dim).toBe(info.dim);
  });

  it('returns null on malformed JSON', () => {
    writeFileSync(DISCOVERY_PATH, 'not-json');
    expect(readDaemonInfo()).toBeNull();
  });

  it('returns null on missing required fields', () => {
    writeFileSync(DISCOVERY_PATH, JSON.stringify({ pid: 1 }));
    expect(readDaemonInfo()).toBeNull();
  });
});

describe('isDaemonAlive', () => {
  it('returns true for the current process', () => {
    const info: DaemonInfo = {
      pid: process.pid,
      port: 0,
      started_at: 0,
      model: EXPECTED_MODEL,
      dim: EXPECTED_DIM,
    };
    expect(isDaemonAlive(info)).toBe(true);
  });

  it('returns false for an obviously-dead pid', () => {
    const info: DaemonInfo = {
      pid: 0, // never a valid pid
      port: 0,
      started_at: 0,
      model: EXPECTED_MODEL,
      dim: EXPECTED_DIM,
    };
    expect(isDaemonAlive(info)).toBe(false);
  });

  it('returns false for a very large pid that should not exist', () => {
    const info: DaemonInfo = {
      pid: 999999999,
      port: 0,
      started_at: 0,
      model: EXPECTED_MODEL,
      dim: EXPECTED_DIM,
    };
    expect(isDaemonAlive(info)).toBe(false);
  });
});

describe('pingDaemon', () => {
  it('returns null when nothing is listening on the port', async () => {
    // Pick a port we just bound + closed to maximize "not listening" probability.
    const probe = net.createServer();
    await new Promise<void>((res) => probe.listen(0, '127.0.0.1', () => res()));
    const port = (probe.address() as any).port;
    await new Promise<void>((res) => probe.close(() => res()));

    const info: DaemonInfo = {
      pid: process.pid,
      port,
      started_at: 0,
      model: EXPECTED_MODEL,
      dim: EXPECTED_DIM,
    };
    const reply = await pingDaemon(info, 200);
    expect(reply).toBeNull();
  });

  it('returns ping response from a mock server', async () => {
    const { server, port } = await startMockServer((req) => {
      if (req.cmd === 'ping') {
        return { ok: true, ready: true, model: EXPECTED_MODEL, dim: EXPECTED_DIM };
      }
      return { error: 'unknown' };
    });
    try {
      const info: DaemonInfo = {
        pid: process.pid,
        port,
        started_at: 0,
        model: EXPECTED_MODEL,
        dim: EXPECTED_DIM,
      };
      const reply = await pingDaemon(info, 2000);
      expect(reply).not.toBeNull();
      expect(reply?.ok).toBe(true);
      expect(reply?.ready).toBe(true);
      expect(reply?.model).toBe(EXPECTED_MODEL);
      expect(reply?.dim).toBe(EXPECTED_DIM);
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });

  it('reports not-ready when daemon model is still loading', async () => {
    const { server, port } = await startMockServer((req) => {
      if (req.cmd === 'ping') {
        return { ok: true, ready: false };
      }
      return {};
    });
    try {
      const info: DaemonInfo = {
        pid: process.pid,
        port,
        started_at: 0,
        model: EXPECTED_MODEL,
        dim: EXPECTED_DIM,
      };
      const reply = await pingDaemon(info, 2000);
      expect(reply?.ok).toBe(true);
      expect(reply?.ready).toBe(false);
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });
});

describe('isDaemonReady', () => {
  it('returns false when discovery file is missing', async () => {
    const ready = await isDaemonReady();
    expect(ready).toBe(false);
  });

  it('returns false when PID is dead', async () => {
    writeFileSync(
      DISCOVERY_PATH,
      JSON.stringify({
        pid: 999999999,
        port: 65535,
        started_at: 0,
        model: EXPECTED_MODEL,
        dim: EXPECTED_DIM,
      }),
    );
    const ready = await isDaemonReady();
    expect(ready).toBe(false);
  });

  it('returns false when model name does not match', async () => {
    // Discovery file points to current process (PID alive) but wrong model.
    writeFileSync(
      DISCOVERY_PATH,
      JSON.stringify({
        pid: process.pid,
        port: 65535,
        started_at: 0,
        model: 'wrong-model',
        dim: EXPECTED_DIM,
      }),
    );
    const ready = await isDaemonReady();
    expect(ready).toBe(false);
  });

  it('returns true when daemon responds ready=true', async () => {
    const { server, port } = await startMockServer((req) => {
      if (req.cmd === 'ping') {
        return { ok: true, ready: true, model: EXPECTED_MODEL, dim: EXPECTED_DIM };
      }
      return {};
    });
    try {
      writeFileSync(
        DISCOVERY_PATH,
        JSON.stringify({
          pid: process.pid,
          port,
          started_at: 0,
          model: EXPECTED_MODEL,
          dim: EXPECTED_DIM,
        }),
      );
      const ready = await isDaemonReady();
      expect(ready).toBe(true);
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });

  it('returns false when daemon ping responds with ready=false', async () => {
    const { server, port } = await startMockServer((req) => {
      if (req.cmd === 'ping') {
        return { ok: true, ready: false, model: EXPECTED_MODEL, dim: EXPECTED_DIM };
      }
      return {};
    });
    try {
      writeFileSync(
        DISCOVERY_PATH,
        JSON.stringify({
          pid: process.pid,
          port,
          started_at: 0,
          model: EXPECTED_MODEL,
          dim: EXPECTED_DIM,
        }),
      );
      const ready = await isDaemonReady();
      expect(ready).toBe(false);
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });
});

describe('embedText', () => {
  it('returns null when discovery file is missing', async () => {
    const vec = await embedText('test');
    expect(vec).toBeNull();
  });

  it('returns vector from a mock server', async () => {
    const fakeVec = new Array(EXPECTED_DIM).fill(0).map((_, i) => i * 0.001);
    const { server, port } = await startMockServer((req) => {
      if (req.cmd === 'embed' && typeof req.text === 'string') {
        return { vector: fakeVec, dim: fakeVec.length, elapsed_ms: 12.3 };
      }
      return { error: 'unknown' };
    });
    try {
      writeFileSync(
        DISCOVERY_PATH,
        JSON.stringify({
          pid: process.pid,
          port,
          started_at: 0,
          model: EXPECTED_MODEL,
          dim: EXPECTED_DIM,
        }),
      );
      const vec = await embedText('hello world');
      expect(vec).not.toBeNull();
      expect(vec?.length).toBe(EXPECTED_DIM);
      expect(vec?.[0]).toBe(0);
      expect(vec?.[1]).toBeCloseTo(0.001);
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });
});

describe('frame protocol', () => {
  it('sendFrame writes length-prefixed JSON', async () => {
    // Use a paired server/client to capture what sendFrame produces.
    const server = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (c) => {
        buf = Buffer.concat([buf, c]);
        if (buf.length >= 4) {
          const len = buf.readUInt32BE(0);
          if (buf.length >= 4 + len) {
            const json = buf.subarray(4, 4 + len).toString('utf-8');
            // Echo back the parsed object so the test can verify.
            sendFrame(sock, JSON.parse(json));
            sock.end();
          }
        }
      });
    });
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()));
    const port = (server.address() as any).port;
    try {
      const client = new net.Socket();
      const received: any = await new Promise((res) => {
        client.connect(port, '127.0.0.1', () => {
          __test.sendFrame(client, { cmd: 'echo', payload: 'hello' });
        });
        recvFrame(client).then(res);
      });
      expect(received).toEqual({ cmd: 'echo', payload: 'hello' });
      client.destroy();
    } finally {
      await new Promise<void>((res) => server.close(() => res()));
    }
  });
});
