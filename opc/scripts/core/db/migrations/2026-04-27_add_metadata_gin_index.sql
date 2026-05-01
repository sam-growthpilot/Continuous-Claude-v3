-- Migration: Add GIN index on archival_memory.metadata jsonb column.
-- Phase 4B of CCv3 Memory System Remediation Plan (2026-04-27).
--
-- Rationale:
--   No prior GIN index on `metadata` -- every metadata filter forced a full
--   sequential scan. Default `GIN(metadata)` (jsonb_ops) supports the
--   containment (@>), key-exists (?), and array-key-exists (?&, ?|)
--   operators, which covers the dominant query shapes used by recall.
--
-- Operator support:
--   metadata @> '{"type":"X"}'        -> uses idx_archival_metadata
--   metadata ? 'type'                  -> uses idx_archival_metadata
--   metadata->>'type' = 'X'            -> seqscan (NOT supported by jsonb_ops)
--                                          callers should prefer the @> form.
--
-- We use the default jsonb_ops (not jsonb_path_ops) because callers may use
-- both `@>` and `?` operators across the codebase. jsonb_path_ops would be
-- smaller/faster for `@>` only -- revisit if profiling shows that pattern
-- dominates exclusively.
--
-- Idempotent: IF NOT EXISTS guards re-runs on fresh installs.

CREATE INDEX IF NOT EXISTS idx_archival_metadata
    ON archival_memory
    USING GIN (metadata);

-- For one-off application against a live DB, prefer:
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_archival_metadata
--       ON archival_memory USING GIN (metadata);
-- (CONCURRENTLY cannot run inside a transaction block; bare CREATE INDEX
-- here is the migration-runner-friendly form.)
