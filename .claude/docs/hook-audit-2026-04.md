# Hook Audit — 2026-04-26 (Phase 2)

Source: `scripts/audit_hook_state.mjs` (read-only) →
`.claude/cache/hook-audit-2026-04-26.json` (full per-file rows).

## Totals (post-batch-2)

| Metric | Initial | Current |
|---|---|---|
| `dist/*.mjs` | 132 | 102 |
| `src/*.ts` (top-level, excl. `shared/`, `__tests__/`, `_archived/`) | 102 | 102 |
| Registered commands in `~/.claude/settings.json` | 70 | 70 |

## Classification summary

| Kind | Initial | Post-batch-2 | Meaning |
|---|---|---|---|
| **LIVE** | 70 | 70 | Registered + has source. Untouched. |
| **STUB-NEEDED-LATER** | 0 | 0 | (None — sentry/linear placeholders all have source.) |
| **ZOMBIE** | 30 | **0** | All archived to `_archived/2026-04-26-{agent-teams-prototype,orphan-experiments}/`. |
| **SOURCE-ONLY** | 27 | 27 | Batch 3 target — has source, not registered. |
| **LIB** | 5 | 5 | Phase 3 candidates for `src/lib/`. |

> The session-start `Hook Health` monitor flagged `sentry-error-context`,
> `sentry-deploy-release`, and `linear-branch-context` as MISSING. That's a
> build/sync gap (active `~/.claude/hooks/dist/` lacks the `.mjs`), not a stub —
> source exists in the repo and they're classified LIVE here. Fix: `npm run
> build` in `.claude/hooks/` followed by sync.

---

## LIB — Phase 3 prep (do not move yet)

These have source and are imported by other hooks. Phase 3 will move them to
`src/lib/`. No action in Phase 2.

| Module | # Importers | Importers (top-level only) |
|---|---|---|
| `daemon-client` | 11 | arch-context-inject, edit-context-inject, impact-refactor, import-validator, post-edit-diagnostics, post-edit-notify, session-start-dead-code, signature-helper, smart-search-router, tldr-context-inject, tldr-read-enforcer |
| `hook-trace` | 1 | memory-awareness |
| `skill-router` | 1 | skill-activation-prompt |
| `skill-validation-prompt` | 1 | skill-activation-prompt |
| `transcript-parser` | 1 | pre-compact-continuity |

Note: the source plan also nominated `diagnostics` for `src/lib/`. The audit
classifies it as SOURCE-ONLY (not currently imported). Flag for re-eval at
Phase 3 — if nothing imports it after a quick grep, archive instead of move.

---

## ZOMBIE — orphan dist `.mjs` (proposed: DELETE after final eyeball)

No source, not registered, not imported. Safe to delete *if* the eyeball pass
confirms each is genuinely unused. Group A (clear v4 swarm experiments) is the
lowest-risk batch; Group B (generic-named) needs a manual look.

### Group A — v4 swarm/coordination experiments (17 files, clear archive)
Inherited from a prior multi-agent design that was abandoned. None are
referenced by any current hook or settings.json entry. These appear to be
prototypes for what is now the official Claude Code "Agent Teams" feature
(https://code.claude.com/docs/en/agent-teams), so we archive (not delete) for
future revival.

- `agent-state-broadcast`
- `composition-gate-hook`
- `pattern-orchestrator`
- `phase-gate`
- `post-task-complete`
- `pre-edit-context`
- `resource-gate`
- `session-end-cleanup-swarms`
- `stop-coordinator`
- `stop-swarm-coordinator`
- `subagent-learning`
- `subagent-start`
- `subagent-start-swarm`
- `subagent-stop`
- `subagent-stop-continuity`
- `subagent-stop-swarm`
- `test-multi-agent`

> Note: `pre-tool-use-broadcast` was originally listed here but is correctly
> SOURCE-ONLY (it has a `.ts` source). It belongs in the SOURCE-ONLY archive
> batch (batch 3), not the ZOMBIE archive batch.

### Group B — needs eyeball before delete
Generic names or feature-flavored. Read the `.mjs` for any unique logic before
removing.

- `auto-learning`
- `drift-detector`
- `erotetic-clarification`
- `failure-detection`
- `post-tool-use`              ← generic name; verify nothing routes here
- `pre-tool-use`               ← same
- `session-start-recall`       ← memory-related; double-check vs session-start-continuity
- `skill-context-inject`       ← may overlap with skill-activation-prompt
- `spec-anchor`
- `spec-intent-detector`
- `tldr-rebuild-prompt`
- `user-confirm-learning`
- `working-on-sync`

---

## SOURCE-ONLY — has source, not wired, not imported

Three buckets: WIRE (clearly useful, just not registered), ARCHIVE (move to
`src/_archived/`), or KEEP-FOR-PHASE-4 (planned use).

### Likely WIRE candidates (have real logic + import shared modules)
These import `daemon-client` or other working modules — they're functional, just
unregistered. Decide per-hook whether to register or archive.

- `arch-context-inject`         (imports daemon-client)
- `edit-context-inject`         (imports daemon-client)
- `impact-refactor`             (imports daemon-client)
- `post-edit-notify`            (imports daemon-client; cousin of post-edit-diagnostics)
- `session-start-dead-code`     (imports daemon-client)
- `signature-helper`            (imports daemon-client)

### Phase 4 candidates (referenced by the plan)
- `session-start-parallel`      ← Phase 4 will *split this into 2 hooks*. Leave.
- `compiler-in-the-loop`        ← paired pre/post; possibly Phase 4 reliability work
- `compiler-in-the-loop-stop`

### Probably archive (uncertain or experimental)
- `browser-learning-extractor`
- `code-field-protocol`
- `dashboard-reporter`
- `diagnostics`                 ← maybe LIB but no current importers
- `git-memory-check`
- `handoff-index`
- `hook-error-pipeline`
- `import-error-detector`       ← cousin of import-validator (LIVE) — verify uniqueness
- `path-rules`
- `plan-mode-discovery`
- `post-learning-prompt`
- `prd-task-template-enforcer`
- `pre-tool-use-broadcast`      ← also a ZOMBIE entry (no dist either) — pure source-only
- `react-perf-context`
- `session-end-cleanup`         ← cousin of session-end-cleanup-swarms (ZOMBIE)
- `skill-install-registrar`
- `test-build`
- `typescript-preflight`

---

## Apply plan — non-destructive archive (gated on user approval)

Strategy: **archive, do not delete.** All hook artifacts move to
`.claude/hooks/_archived/<date>-<group>/` with a revival README. The
`_archived/` tree is excluded by esbuild (top-level `src/*.ts` glob) and by the
sync script (`hooks/*.mjs` top-level glob). Audit script also excludes it.

1. **Batch 1 — `agent-teams-prototype/` (17 ZOMBIE Group A `.mjs`):**
   `git mv` to `.claude/hooks/_archived/2026-04-26-agent-teams-prototype/dist/`.
   These are v4 swarm/subagent prototypes that prefigure Claude Code's official
   Agent Teams feature; archive preserves them for revival when we adopt that
   API. One commit: `chore(hooks): archive 17 v4 agent-teams-prototype swarm hooks`.
2. **Batch 2 — `orphan-experiments/` (13 ZOMBIE Group B `.mjs`):** eyeball each
   `.mjs` for unique logic, then `git mv` to
   `.claude/hooks/_archived/2026-04-26-orphan-experiments/dist/`. One commit
   per surprise, else one bulk commit.
3. **Batch 3 — `source-only-experiments/` (~18 SOURCE-ONLY `.ts` + companion
   `.mjs`):** per-file decisions. The 6 likely-WIRE candidates and 3 Phase 4
   candidates stay in place. The remaining ~18 archive together to
   `.claude/hooks/_archived/2026-04-26-source-only-experiments/{src,dist}/`.
4. **Verification:** re-run `node scripts/audit_hook_state.mjs` after each
   batch; expect ZOMBIE → 13 → 0 and SOURCE-ONLY shrinking to ~9 (likely-WIRE
   + Phase 4 candidates only). LIB unchanged.

LIB moves stay deferred to **Phase 3** per the plan.

### Revival recipe (in each archive group's README)

```bash
cd .claude/hooks/_archived/<date>-<group>
mv dist/*.mjs ../../dist/
[ -d src ] && mv src/*.ts ../../src/
cd ../../.. && npm --prefix .claude/hooks run build
```

---

## Notes

- Audit excludes `shared/`, `__tests__/`, and `_archived/` from `src/` traversal;
  it does not recurse into subdirectories of `src/` (Phase 3 will introduce
  `src/lib/` later).
- Registration matching tolerates `~/.claude/`, `C:/.../.claude/`, and forward
  or back slashes. False negatives surface as ZOMBIE — eyeball Group B confirms.
- `~/.claude/settings.json` is authoritative for "registered" because the repo
  copy is intentionally not synced (per `.claude/rules/sync-known-gaps.md`).
- Full per-file JSON: `.claude/cache/hook-audit-2026-04-26.json`.
