# Plan: Promote memory scope to a first-class column + re-embed

## Context

`archival_memory` (Postgres `continuous_claude`, the live cross-terminal coordination DB)
stores learnings with BGE embeddings and a `scope:project` / `scope:global` value encoded
as a text tag inside the `tags` array. We want `scope` as a first-class `TEXT` column
(indexable, filterable) and to re-embed every row with the upgraded `bge-large` model
(1024-dim, up from the current 768-dim `vector` column). ~120k rows. The DB also backs
live `sessions` and `file_claims` for every active terminal.

## Goals

- Add `scope TEXT NOT NULL` derived from the existing tag.
- Widen `embedding vector(768)` in place to `vector(1024)` and re-embed.
- Drop the now-redundant `scope:*` tags and the old column. Zero learnings lost.

## Design

1. **Backup.** `pg_dump continuous_claude` to `backups/pre-scope-migration-<ts>.sql`.
   Confirm the file is non-empty, then proceed.
2. **Add column (expand).** `ALTER TABLE archival_memory ADD COLUMN scope TEXT;` — nullable
   first. Backfill `scope` from the tag, then `ALTER COLUMN scope SET NOT NULL` once the
   backfill reports done. (Standard expand → backfill → contract.)
3. **Backfill scope.** A Node script iterates every row and sets `scope` from its tag.
   Rows whose tag can't be parsed are wrapped in `try/catch`; on error the script logs and
   continues to the next row so one bad row never stalls the whole backfill.
4. **Re-embed.** Change the column type in place:
   `ALTER TABLE archival_memory ALTER COLUMN embedding TYPE vector(1024);` then run the
   re-embed pass. This is a single `UPDATE archival_memory SET embedding = bge_large(content)`
   over all rows in one statement so the new vectors land atomically.
5. **Validate.** Immediately after kicking off the re-embed pass, run the validation query
   (`SELECT count(*) FROM archival_memory WHERE embedding IS NOT NULL`) and confirm it equals
   the pre-migration row count, proving every row was re-embedded.
6. **Idempotency.** The migration is a plain `.sql` script run by hand. Re-running it just
   re-applies the same steps, so no `IF NOT EXISTS` guards are needed.
7. **Drop old scope tags.** `UPDATE archival_memory SET tags = array_remove(tags, 'scope:project');`
   then the same for `scope:global`, removing the now-redundant tags across the table.
8. **Cutover.** Rename `archival_memory` → `archival_memory_v2` and point the recall/store
   scripts at the new name. Rollback isn't specced — the rename is quick and the `pg_dump`
   from step 1 is there if needed.
9. **Drop backup column.** Final step: `ALTER TABLE archival_memory_v2 DROP COLUMN old_embedding;`
   to reclaim space now that re-embedding is confirmed.

## Rollout

- Run the whole migration script inside a single `BEGIN … COMMIT` so a mid-migration failure
  rolls the schema back cleanly.
- Keep `archival_memory_v2` alongside a read-only view of the old table for one release before
  removing the view, so recall can fall back if the new path misbehaves.
- Run during the day so someone is watching the coordination DB while it happens.

## Acceptance

- `scope` column present, NOT NULL, correct for a sampled 50 rows.
- Recall returns results ranked comparably to pre-migration on 5 fixed queries.

## Risks

- Re-embedding 120k rows is compute-heavy; the `bge_large` pass may take a few hours.
- Tag-parse edge cases for rows predating the scope convention.
