# Hook Audit — 2026-04-26 (Phase 2)

Source: `scripts/audit_hook_state.mjs` (read-only) →
`.claude/cache/hook-audit-2026-04-26.json` (full per-file rows).

## Totals

| Metric | Count |
|---|---|
| `dist/*.mjs` | 132 |
| `src/*.ts` (top-level, excl. `shared/`, `__tests__/`) | 102 |
| Registered commands in `~/.claude/settings.json` | 70 |

## Classification summary

| Kind | Count | Meaning |
|---|---|---|
| **LIVE** | 70 | Registered + has source. No action. |
| **STUB-NEEDED-LATER** | 0 | (None — sentry/linear placeholders all have source.) |
| **ZOMBIE** | 30 | Orphan `.mjs` (no source, not registered). Candidates for delete. |
| **SOURCE-ONLY** | 27 | Has source, not registered, not imported. Archive or wire per-file. |
| **LIB** | 5 | Has source + imported by ≥1 hook. Phase 3 candidates for `src/lib/`. |

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

### Group A — v4 swarm/coordination experiments (clear delete)
Inherited from a prior multi-agent design that was abandoned. None are
referenced by any current hook or settings.json entry.

- `agent-state-broadcast`
- `composition-gate-hook`
- `pattern-orchestrator`
- `phase-gate`
- `post-task-complete`
- `pre-edit-context`
- `pre-tool-use-broadcast` (also has SOURCE-ONLY — see below)
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

## Apply plan (gated on user approval)

1. **Phase 2a — Group A ZOMBIE delete (18 files):** straightforward. One commit
   `chore(hooks): delete v4 swarm-experiment dist orphans`.
2. **Phase 2b — Group B ZOMBIE eyeball + delete (13 files):** read each `.mjs`
   to confirm no unique logic before removing. One commit per surprise found,
   else one bulk commit.
3. **Phase 2c — SOURCE-ONLY decisions:** per-row decisions. Likely-WIRE bucket
   needs a separate "register or archive" judgment (probably archive — the plan
   prefers paranoid mode). Phase 4 candidates stay in place.
4. **Phase 2d — `_archived/` move:** move agreed SOURCE-ONLY entries to
   `.claude/hooks/src/_archived/<name>.ts` (excluded by audit and esbuild).
5. **Verification:** re-run `node scripts/audit_hook_state.mjs`; expect 0
   ZOMBIE, only Phase 4 candidates in SOURCE-ONLY, LIB unchanged. Then `npm run
   build` + `bash scripts/sync-to-active.sh` + the weekly health check.

LIB moves stay deferred to **Phase 3** per the plan.

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
