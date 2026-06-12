/**
 * Shared search-context handshake directory (QW-02 / D2b-05).
 *
 * The smart-search-router hook (writer, PreToolUse:Grep) stores a per-session
 * search-context JSON here; tldr-read-enforcer (reader, PreToolUse:Read) reads
 * it back. Both MUST agree on this exact path or the handshake breaks.
 *
 * Previously a hardcoded POSIX literal `/tmp/claude-search-context`. On Windows
 * that resolved to `C:\tmp\...` (a path Node creates at the drive root), which
 * accumulated hundreds of per-session files with no cleanup. Relocating under
 * os.tmpdir() preserves POSIX behavior (os.tmpdir() === '/tmp') and fixes
 * Windows (os.tmpdir() === C:\Users\<user>\AppData\Local\Temp).
 */

import * as os from 'os';
import * as path from 'path';

/** Single source of truth for the search-context handshake directory. */
export const CONTEXT_DIR = path.join(os.tmpdir(), 'claude-search-context');
