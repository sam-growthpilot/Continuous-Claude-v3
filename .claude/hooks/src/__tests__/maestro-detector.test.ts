/**
 * Tests for maestro-detector re-entrancy guard (R7, Phase 5c).
 *
 * Guard logic: if .claude/maestro-state.json exists and mtime is within
 * SESSION_WINDOW_MS (30 min), isMaestroActive() returns true and the hook
 * skips its suggestion.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { isMaestroActive, analyzeComplexity, countProcessPhases } from '../maestro-detector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SESSION = 'maestro-detector-test';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-det-test-'));
  // Create .claude subdir matching expected layout
  fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

function stateFilePath(): string {
  return path.join(tempDir, '.claude', 'maestro-state.json');
}

function writeStateFile(ageMsecAgo: number = 0): void {
  const content = JSON.stringify({ phase: 'interview', session_id: SESSION });
  fs.writeFileSync(stateFilePath(), content);
  // Back-date the mtime if needed
  if (ageMsecAgo > 0) {
    const ts = new Date(Date.now() - ageMsecAgo);
    fs.utimesSync(stateFilePath(), ts, ts);
  }
}

// ---------------------------------------------------------------------------
// Test 1: fresh state file suppresses the suggestion
// ---------------------------------------------------------------------------

describe('isMaestroActive', () => {
  it('returns true when state file exists and is fresh (mtime = now)', () => {
    writeStateFile(0); // written just now
    expect(isMaestroActive(tempDir)).toBe(true);
  });

  it('returns true when state file is 5 minutes old (within window)', () => {
    writeStateFile(5 * 60 * 1000);
    expect(isMaestroActive(tempDir)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 2: no state file — hook proceeds normally
  // ---------------------------------------------------------------------------

  it('returns false when state file does not exist', () => {
    // No state file written
    expect(isMaestroActive(tempDir)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Test 3: stale state file — hook proceeds normally
  // ---------------------------------------------------------------------------

  it('returns false when state file is older than 30 minutes', () => {
    writeStateFile(31 * 60 * 1000); // 31 minutes ago
    expect(isMaestroActive(tempDir)).toBe(false);
  });

  it('returns false (fail-open) when projectDir is completely invalid', () => {
    // Path that cannot exist
    expect(isMaestroActive('/this/path/does/not/exist/at/all')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sanity check: existing detection logic is unaffected
// ---------------------------------------------------------------------------

describe('analyzeComplexity', () => {
  it('scores a complex multi-phase prompt above threshold', () => {
    const prompt = 'Research the authentication architecture, design a new approach, implement the changes, and test the integration across the entire system';
    const { score, signals } = analyzeComplexity(prompt);
    expect(score).toBeGreaterThan(0.65);
    expect(signals.length).toBeGreaterThan(1);
  });

  it('scores a simple short question near zero', () => {
    const prompt = 'What is the capital of France';
    const { score } = analyzeComplexity(prompt);
    expect(score).toBeLessThan(0.65);
  });
});

describe('countProcessPhases', () => {
  it('counts multiple phases in a complex prompt', () => {
    const prompt = 'Research the problem, plan the solution, then build and test it';
    expect(countProcessPhases(prompt)).toBeGreaterThanOrEqual(3);
  });

  it('counts zero phases in a simple prompt', () => {
    expect(countProcessPhases('Hello world')).toBe(0);
  });
});
