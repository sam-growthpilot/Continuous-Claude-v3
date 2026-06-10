/**
 * Fork worker for the cross-process spawn-mutex test (mitigation F5).
 *
 * The parent esbuild-bundles embedding-client.ts with `child_process` aliased
 * to _cp-stub-template.mjs, so `spawn` here does NOT launch a real uv — it
 * atomically appends one byte to the shared counter file. This worker just:
 *   1. points the module's rendezvous dir at a shared temp dir (no live daemon)
 *   2. provides a fake but existing uv path so resolveUvPath() succeeds
 *   3. calls ensureDaemonRunning()
 *
 * _spawnAttempted is per-process, so it does NOT dedupe across forks. Only the
 * atomic openSync(lock, 'wx') mutex should let exactly ONE child reach spawn.
 *
 * argv: [node, worker.mjs, runDir, counterFile, uvFakePath, bundledModulePath]
 */
import { pathToFileURL } from 'node:url';

const runDir = process.argv[2];
const counterFile = process.argv[3];
const uvFake = process.argv[4];
const modulePath = process.argv[5];

process.env.CCV3_EMBEDDING_RUN_DIR = runDir;
process.env.CCV3_HERD_COUNTER = counterFile;
process.env.CCV3_UV_PATH = uvFake;

const mod = await import(pathToFileURL(modulePath).href);
mod.ensureDaemonRunning();

if (process.send) process.send('done');
