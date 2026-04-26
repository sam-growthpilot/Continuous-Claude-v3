/**
 * Shared subprocess runner for parallel SessionStart hooks.
 *
 * Extracted from the original session-start-parallel.ts during the
 * Phase 4 split so context-loaders and memory-loaders share one
 * implementation.
 */

import { spawn } from 'child_process';

export interface TaskResult {
  name: string;
  success: boolean;
  message?: string;
  output?: string;
  error?: string;
  duration: number;
}

export function runCommand(
  name: string,
  command: string,
  args: string[],
  stdinData: string,
  timeoutMs: number = 10000
): Promise<TaskResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      let output: string | undefined;
      try {
        const parsed = JSON.parse(stdout.trim());
        output = parsed.message;
      } catch {
        output = stdout.trim() || undefined;
      }

      resolve({
        name,
        success: code === 0,
        output,
        message: code === 0 ? 'OK' : `Exit ${code}`,
        error: stderr.trim() || undefined,
        duration: Date.now() - start,
      });
    });

    proc.on('error', (err) => {
      resolve({
        name,
        success: false,
        error: err.message,
        duration: Date.now() - start,
      });
    });

    proc.stdin?.write(stdinData);
    proc.stdin?.end();
  });
}
