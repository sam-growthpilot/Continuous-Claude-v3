# Windows Platform Rules

## codegraph Phase C — Windows platform contract (2026-06-06)

The WS-2 Phase C **GATE** for adopting `@colbymchenry/codegraph@0.9.9` as the first L3 specialist. Authored + run as the integration contract test `.claude/hooks/src/__tests__/codegraph-platform-contract.test.ts` (vitest, real binary, throwaway git fixture in OS temp). **Result: GATE GREEN — 12/12 assertions pass on Windows 11 / Node 24.4.1.**

### Recorded actuals (2026-06-06 full run; ~33-file TS+Py fixture)

| Assertion | Result | Recorded actual | Tripwire |
|-----------|--------|-----------------|----------|
| C1.a cold index | PASS | exit 0, DB created, **9.0s** | < 30s |
| C1.b warm query | PASS | exit 0, valid JSON, symbol found, **2.85s** | < 8s (see note) |
| C1.c peak RSS (best-effort) | PASS | **83.9 MB** | < 1GB (soft) |
| C1.d index DB size | PASS | **0.20 MB** (208,896 bytes) | < 50MB |
| C1.e/f drive-letter + spaced path | PASS | caller in `src/has space/spaced.ts`, path intact | array-arg proof |
| C1.g `.cmd` shim | PASS | `cmd.exe /c <cmd>` → `0.9.9` | runs |
| C1.h windowsHide | PASS | `windowsHide:true` on every spawnSync opts | structural |
| C1.i daemon coexistence | PASS | no `database is locked` (7 python procs live) | WAL concurrent reads |
| **C1.j 20× edit→sync→query freshness** | **PASS** | **20/20 fresh after sync; 20/20 stale under no-sync control** | 20/20 required |
| C1.j2 cross-file edge finding | PASS | incremental sync orphans edge; `index --force` restores it | characterization |
| **C1.k WAL journal** | **PASS** | **`journalMode=wal`, backend=`node-sqlite`** | must be wal |
| C1.RESULT-QUALITY (mitigation #8) | PASS | caller→callee pair found (after `--force`); query FTS finds callee | correctness |

### Platform findings (load-bearing for C.2 wiring)

1. **`.cmd`/`.bat` shims CANNOT be spawned directly on modern Node (CVE-2024-27980 hardening).** `spawnSync('<...>.bin/codegraph.cmd', args)` returns `status:null` + `EINVAL` on Node ≥18.20.2/≥20.12.2 unless `shell:true`. **Production `runCodegraph()` (C.2) must invoke the real JS entrypoint directly: `node <pkg>/@colbymchenry/codegraph/npm-shim.js <args...>` (via `process.execPath`), keeping args as an ARRAY.** The `.cmd` shim, when needed, runs via `cmd.exe /c <cmd> <args...>` (array args preserved). Do NOT set `shell:true` (defeats the spaced-path safety).

2. **Per-invocation Node + WASM tree-sitter cold-start tax ≈ 3-4s.** Each one-shot CLI call (`node npm-shim.js …`) pays full interpreter+WASM startup; the actual query is sub-second. So the spec's original 2s warm-query ceiling is unachievable for a one-shot process — the recorded 2.85s is dominated by startup, not query work. The C.2 facade amortizes this by caching the cheap O(1) freshness probe (`git rev-parse HEAD` + `git status --porcelain`), NOT by making codegraph faster. `status`/`sync` calls run ~6-8s each for the same reason.

3. **WAL confirmed active on local NTFS** (`C:\Users\…`). `status --json` reports `journalMode:"wal"`. If WAL is ever disabled → `database is locked` under the BGE daemon — remediation is **move the project to a local NTFS disk** (WAL is unavailable on network shares / WSL2 `/mnt`).

4. **Incremental-sync cross-file edge orphaning (real correctness limitation).** Editing a callee's file + `sync` ORPHANS the inbound cross-file caller edge from UNCHANGED caller files — because incremental sync content-hashes and skips re-parsing the unchanged caller, so its edge to the rewritten callee node is never re-linked. A plain `sync` does NOT restore it. **Remediation (both verified): `index --force` (full re-index) OR re-sync the caller file.** Implication for C.2: after a callee-file edit the facade must not trust `who-calls` to be complete from a plain `sync` — it should re-sync caller files, run a periodic `index --force`, or escalate to Serena for caller precision.

5. **Freshness IS load-bearing on `sync`** (not auto-DB-update): the no-sync control returned `[]` (stale) on all 20 iterations, proving `sync` does the work. After `sync`, 20/20 probes were found. No `database is locked` under the live BGE daemon (WAL concurrent reads hold).

### CLI shape reference (confirmed 0.9.9)
- `init [path]` — positional, indexes by default, NO `--json`; creates `.codegraph/codegraph.db`.
- `query <search> -p <path> -j` → JSON **array** of `{node:{name,filePath,qualifiedName,startLine,…}, score}`.
- `callers|callees <symbol> -p <path> -j [-l N]` → `{symbol, callers|callees:[{name,kind,filePath,startLine}]}` (default limit 20 — raise `-l` to avoid truncation).
- `status [path] -j` → `{fileCount,nodeCount,dbSizeBytes,backend,journalMode,nodesByKind,languages,…}`.
- `sync [path] -q` — on-demand reconcile (NO watcher); positional path; `-q` for hooks. `index [path] --force -q` — full re-index.

Test file: `.claude/hooks/src/__tests__/codegraph-platform-contract.test.ts`. Re-run: `cd .claude/hooks && npx vitest run src/__tests__/codegraph-platform-contract.test.ts --reporter=verbose` (~7 min; C1.j alone is ~350s of process-startup tax). Suite `describe.skip`s wholesale if the binary is absent (CI without it stays green).

## Never Edit `.claude.json` with the Edit tool [C:10]

Claude Code writes to `~/.claude.json` continuously (session stats, tip counters, feature flag caches, timestamps). The Edit tool will almost always fail with "File has been modified since read."

**Use Node.js atomic read-modify-write instead:**

```bash
node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/david.hayes/.claude.json', 'utf8'));
// ... modify data ...
fs.writeFileSync('C:/Users/david.hayes/.claude.json', JSON.stringify(data, null, 2) + '\n');
"
```

This reads, modifies, and writes in a single process — no race window.

## Python is not `python3` on Windows [H:8]

Windows does not have `python3` on PATH. The `python3` command triggers the Microsoft Store alias and fails.

| Platform | Command |
|----------|---------|
| Linux/macOS | `python3` |
| Windows | `python` or `node` (preferred) |

**Rule:** For cross-platform scripts, prefer `node` (always available in Claude Code). For Python specifically, use `python` not `python3`, or use `uv run python` which handles this correctly.

## MCP Servers: `npx` requires `cmd /c` wrapper [H:8]

On Windows, MCP server configs using `npx` directly will fail. Wrap with `cmd /c`:

```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "package-name@latest"]
}
```

NOT:

```json
{
  "command": "npx",
  "args": ["package-name@latest"]
}
```

Claude Code diagnostics will warn about this — fix immediately when seen.

## Git Bash paths require drive letter [H:9]

`/Users/david.hayes/...` does NOT work on Windows Git Bash — it resolves to `C:\Program Files\Git\Users\...` which doesn't exist.

Always use one of these formats:
- `/c/Users/david.hayes/...` (Git Bash native)
- `C:/Users/david.hayes/...` (Windows forward-slash)

| Wrong | Right |
|-------|-------|
| `cd /Users/david.hayes/project` | `cd /c/Users/david.hayes/project` |
| `cd "$HOME/project"` (if HOME unset) | `cd C:/Users/david.hayes/project` |

This is the #1 cause of `Exit code 1` errors across sessions. The `$HOME` variable works when set, but literal paths MUST include the drive letter.

## Parallel Bash commands: verify directory first [H:8]

When running multiple Bash commands in parallel that depend on a directory existing, verify access in a standalone command first. Otherwise one bad path cascades "Sibling tool call errored" to all parallel siblings.

**Pattern:**
1. First call: `ls C:/Users/david.hayes/project` (verify it exists)
2. Then parallel calls that use that directory

**Anti-pattern:** Launching 3 parallel `cd /Users/david.hayes/project && ...` commands — if the path is wrong, all 3 fail with cascade errors, tripling the noise.
