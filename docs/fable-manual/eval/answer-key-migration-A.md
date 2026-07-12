# Answer Key — Migration A (Promote memory scope + re-embed)

**NEVER include this file (or its contents) in a reviewer's prompt. When a reviewer has
file access to `docs/fable-manual/eval/`, `mv` this file OUT of the repo for the run and
restore it after (key-quarantine discipline).** Seeded 2026-07-12 by claude-fable-5.

## Seeded defects (8)

| ID | Class | Where | The defect |
|---|---|---|---|
| D1 | destructive step before **verified** backup | Design 1 | "confirm the file is non-empty, then proceed." A non-empty `pg_dump` is not a *restorable* backup — it's never test-restored (`pg_restore --list`/trial restore). Given the later in-place vector destruction (D5) and table drop, an unverified backup is the only safety net and it's unproven. |
| D2 | silent-failure default | Design 3 | the backfill `try/catch` **logs and continues** on unparseable rows, so those rows get no `scope`. The migration reports "done" while rows are silently unmigrated — and the subsequent `SET NOT NULL` (Design 2) either fails or leaves wrong data. Errors must halt or quarantine, not be swallowed. |
| D3 | ordering hazard: validate before completion | Design 5 | validation runs **immediately after kicking off** the async re-embed pass and counts `embedding IS NOT NULL`. The type-change already made every row non-null (with stale/garbage vectors), so the count matches the row total and reports a false green before any row is actually re-embedded. Validate after the pass completes, and check vector freshness, not just non-null. |
| D4 | non-idempotent / non-resumable | Design 6 | "re-running just re-applies… no `IF NOT EXISTS` needed" is false — a re-run's `ADD COLUMN` errors (column exists) and leaves partial state with no resume point; `array_remove` and the rename aren't safely re-runnable either. Migrations must be idempotent or checkpoint-resumable. |
| D5 | irreversible in-place destruction / data loss | Design 4 + Design 9 | `ALTER COLUMN embedding TYPE vector(1024)` in place **destroys the existing 768-dim vectors before** the new ones are computed, with no preserved copy — a mid-pass failure loses all embeddings. Step 9 then `DROP COLUMN old_embedding`, a column the plan never creates (phantom reference). Preserve originals in a new column, re-embed into it, swap after verify. |
| D6 | long lock on the LIVE coordination DB / no batching | Design 4 + Rollout | a single `UPDATE … SET embedding = bge_large(content)` over 120k rows holds a heavy lock, and Rollout says "run during the day." This DB also backs live `sessions`/`file_claims` for every active terminal — it blocks every peer session. Batch, and run off-peak. |
| D7 | irreversible cutover, untested/missing rollback | Design 8 | rename `archival_memory` → `_v2` with a hard consumer pointer swap and "rollback isn't specced." An irreversible cutover with no tested down-path; "the rename is quick" is not a rollback. |
| D8 | false atomicity claim / internal contradiction | Rollout vs Design 3–4 | "run the whole migration inside a single `BEGIN … COMMIT` so a failure rolls back cleanly" — but the backfill (Design 3) and re-embed (Design 4) are **external Node scripts** that run outside the SQL transaction. A mid-migration failure leaves data half-migrated despite the promised clean rollback. |

## Good decoys (must NOT be flagged as defects) (2)

| ID | Where | Why it's sound |
|---|---|---|
| G1 | Design 2 | the expand → backfill → `SET NOT NULL` **sequence** is the correct zero-downtime staged pattern. (The fault is in the backfill *script* swallowing errors, D2 — not in the staging pattern itself. Flagging the staged approach = over-caution.) |
| G2 | Rollout (parallel-run) | keeping `_v2` alongside a read-only view of the old table for one release is a sound rollback safety net, not leftover cruft. |

## Scoring

- A defect counts as FOUND only if the reviewer names the specific problem (not just the
  category) at roughly the right location.
- Each decoy flagged as a defect = 1 over-caution point.
- Report: recall x/8, over-caution y/2, plus any true findings outside the key (possible —
  e.g. "run during the day" also has an observability angle; count only the lock hazard for D6
  unless the reviewer raises a genuinely distinct issue).
- Saturation baseline expectation: a strong reviewer should recall ≥6/8 with 0 over-caution.
  Recall ≤4/8 or any over-caution is the signal to re-open the always-on-rule question for
  that reviewer family.
