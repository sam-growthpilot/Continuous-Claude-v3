/**
 * Tests for shared/tool-error.ts (`detectToolError`).
 *
 * Mirrors the Python sibling at `~/.claude/hooks/braintrust_hooks.py:422-449`
 * (`_detect_tool_error`) plus the TS-only `status === 'error'` backward-compat
 * check. Every branch of the four detection rules is covered, plus
 * fail-open behavior on non-object / null / undefined inputs.
 */

import { describe, it, expect } from 'vitest';

import { detectToolError } from '../shared/tool-error.js';

describe('detectToolError', () => {
  // -------------------------------------------------------------------------
  // Rule 1: is_error === true
  // -------------------------------------------------------------------------
  describe('rule 1: is_error', () => {
    it('returns true when is_error === true', () => {
      expect(detectToolError({ is_error: true })).toBe(true);
    });

    it('returns false when is_error === false', () => {
      expect(detectToolError({ is_error: false })).toBe(false);
    });

    it('returns false when is_error is a string "true"', () => {
      // Strict boolean check — string "true" should NOT trigger
      expect(detectToolError({ is_error: 'true' })).toBe(false);
    });

    it('returns false when is_error is missing', () => {
      expect(detectToolError({ output: 'ok' })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 2: error truthy non-empty (string with content, or true)
  // -------------------------------------------------------------------------
  describe('rule 2: error', () => {
    it('returns true when error is a non-empty string', () => {
      expect(detectToolError({ error: 'something broke' })).toBe(true);
    });

    it('returns true when error === true', () => {
      expect(detectToolError({ error: true })).toBe(true);
    });

    it('returns false when error is an empty string', () => {
      expect(detectToolError({ error: '' })).toBe(false);
    });

    it('returns false when error is whitespace only', () => {
      expect(detectToolError({ error: '   ' })).toBe(false);
    });

    it('returns false when error === false', () => {
      expect(detectToolError({ error: false })).toBe(false);
    });

    it('returns false when error is null', () => {
      expect(detectToolError({ error: null })).toBe(false);
    });

    it('returns false when error is undefined', () => {
      expect(detectToolError({ error: undefined })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 3: success === false
  // -------------------------------------------------------------------------
  describe('rule 3: success', () => {
    it('returns true when success === false', () => {
      expect(detectToolError({ success: false })).toBe(true);
    });

    it('returns false when success === true', () => {
      expect(detectToolError({ success: true })).toBe(false);
    });

    it('returns false when success is missing', () => {
      expect(detectToolError({ output: 'ok' })).toBe(false);
    });

    it('returns false when success is undefined', () => {
      expect(detectToolError({ success: undefined })).toBe(false);
    });

    it('returns false when success is 0 (not strictly false)', () => {
      // We use strict `=== false` to match the Python `is False` semantics
      expect(detectToolError({ success: 0 })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 4: status === 'error' (backward-compat with original TS check)
  // -------------------------------------------------------------------------
  describe('rule 4: status', () => {
    it('returns true when status === "error"', () => {
      expect(detectToolError({ status: 'error' })).toBe(true);
    });

    it('returns false when status === "success"', () => {
      expect(detectToolError({ status: 'success' })).toBe(false);
    });

    it('returns false when status === "ok"', () => {
      expect(detectToolError({ status: 'ok' })).toBe(false);
    });

    it('returns false when status is missing', () => {
      expect(detectToolError({ output: 'ok' })).toBe(false);
    });

    it('returns false when status === "Error" (case-sensitive)', () => {
      expect(detectToolError({ status: 'Error' })).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Fail-open: non-object inputs
  // -------------------------------------------------------------------------
  describe('non-object inputs', () => {
    it('returns false for null', () => {
      expect(detectToolError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(detectToolError(undefined)).toBe(false);
    });

    it('returns false for a string', () => {
      expect(detectToolError('error')).toBe(false);
    });

    it('returns false for a number', () => {
      expect(detectToolError(0)).toBe(false);
    });

    it('returns false for a boolean', () => {
      expect(detectToolError(true)).toBe(false);
    });

    it('returns false for an array', () => {
      // Arrays are objects but have none of the named fields
      expect(detectToolError(['error'])).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Combined / realistic payloads
  // -------------------------------------------------------------------------
  describe('combined payloads', () => {
    it('returns false for an empty object (the dominant prod case)', () => {
      expect(detectToolError({})).toBe(false);
    });

    it('returns false for a typical success response with only output', () => {
      expect(detectToolError({ output: 'command succeeded\n' })).toBe(false);
    });

    it('returns true when multiple error flags are set (is_error + error)', () => {
      expect(detectToolError({ is_error: true, error: 'boom' })).toBe(true);
    });

    it('returns true when is_error is set but success is also true', () => {
      // is_error takes precedence — any one flag is sufficient
      expect(detectToolError({ is_error: true, success: true })).toBe(true);
    });

    it('returns false when output contains the word "error" but no flags set', () => {
      // Avoid false positives from output text
      expect(detectToolError({ output: 'no error occurred' })).toBe(false);
    });
  });
});
