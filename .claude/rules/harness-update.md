# Harness Update Rule

Governs version/model changes for every cross-model harness (Codex, Grok, future). Companion skill: `.claude/skills/harness-update/SKILL.md` (the executable playbook).

## The rule

1. **Any CLI upgrade or new-model enablement MUST go through `/harness-update <harness>`.** No ad-hoc allowlist edits, no "the docs say it's supported."
2. **Live probe on this account is the ONLY admission ticket** for a model id: positive probe (real call succeeds) + negative probe (fabricated id shows the documented rejection shape) + ground-truth cache read (`~/.codex/models_cache.json` / `~/.grok/models_cache.json`).
3. **Rollback pin before upgrade** — exact old version + reinstall command recorded in the harness's DESIGN-RESEARCH doc before touching the install.
4. **Auth is asserted before and after** every upgrade; a fallback to API-key billing is a STOP, never a workaround.
5. **The edit-point registries in the skill are authoritative.** Adding a new harness or moving a file means updating the registry table in the same change. `/harness-update <harness> --dry-run` must report "consistent" at the end of any harness-touching PR.
6. **Safety-guard probes are part of every re-verification** — e.g. Grok's `--tools` read-only guard and Codex's sandbox behavior. A guard regression means the harness ships NOTHING until redesigned.
7. **Grok auto-updates itself** — a version change may happen without anyone running an upgrade. Workers version-stamp their runs; on a version mismatch with the last verified version, run the playbook reactively before trusting the harness for write work.

## Evidence trail

| Harness | Design doc | Verified as of |
|---|---|---|
| Codex | `docs/codex-integration/DESIGN-RESEARCH.md` (§13 = latest) | 0.144.1, 2026-07-11 |
| Grok | `docs/grok-integration/DESIGN-RESEARCH.md` | 0.2.93, 2026-07-11 |
