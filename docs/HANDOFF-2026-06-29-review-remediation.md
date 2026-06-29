---
type: session-handoff
session_date: 2026-06-29
branch: snapshot/ccv3-system-update
outcome: PARTIAL_PLUS
supersedes: HANDOFF-2026-06-28-threshold-execution.md
review: workflow ccv3-threshold-review (7 agents: 5 area + meta + Codex cross-model)
---

# Handoff — Review + Remediation of the threshold work (2026-06-29)

## What happened

Ran an adversarial multi-agent code review (5 principal-reviewers + a LIVE/honesty meta
auditor + a cross-model Codex adversary, then synthesis) over the 6 threshold-execution
commits `b895010..52de54d`. Verdict: **not-yet-stable** — the prior session's SAFE/HONEST
claims were **overstated**. Independently verified every fix-now finding against the code,
then fixed the 4 S1 + 1 S2. Tip = `1571960`, pushed to `fork`.

## Review verdict (pre-fix) and what was real

| Floor | Pre-fix | Notes |
|-------|---------|-------|
| LIVE | ✅ met | all 5 changed dist hooks byte-identical active==repo; matcher flip on all 3 surfaces |
| SAFE | ❌ NOT met | 4 confirmed S1 (below) — "RCE closed / human gate restored" was overstated |
| HONEST | ⚠️ partial | parity/tests/emit-invariant claims held; but "Closes D2g-02/GAP3-01" + "gate restored" were overclaims |
| USABLE | ⚠️ partial | the ~2s checkLocalMemory drop was real, but QW-04 silently revived two hot-path regressions |

Genuinely clean under independent verification: the matcher flip (QW-04), the template
reconciliation (Phase 2), and the recall sanitization (D5b-01 — confirmed it HTML-encodes
context-breakout and only wraps untrusted recall, leaving trusted local files unwrapped).

## Fixes shipped this session (commit `1571960`)

- **F1 (S1, GAP4-02)** — `daemon-client.ts queryDaemonSync` interpolated the model-controlled
  Grep pattern into `execSync` shell strings (powershell `-Command` / `echo | nc`) on the
  **daemon-UP path** Phase 1b never touched → RCE was only half-closed. Now `spawnSync` with
  the JSON payload on **stdin** (`shell:false`) via a testable `buildDaemonInvocation` helper.
  Rippled into the 13 dist bundles that import daemon-client. Verified: payload only in stdin.
- **F2 (S1, Codex 0.95)** — `SKIP_DESTRUCTIVE_GUARD=1` was a substring match anywhere →
  `echo SKIP_DESTRUCTIVE_GUARD=1 && rm -rf x` disabled the guard. Now leading-prefix only.
  Verified live: that exploit → **deny**; leading prefix → **allow**.
- **F3 (S1)** — recursive-rm / git-clean / docker regexes only saw the first flag token →
  split-flag forms slipped through. Rewrote to scan across flag tokens. Verified live:
  `rm -f -r build` → **deny**.
- **F5 (S2)** — `tldr-context-inject findProjectRoot` `while (current!=='/')` never terminated
  on a Windows drive root (live on every Task spawn after QW-04, ~5s hang). Now terminates on
  `dirname(current)===current`. Verified: terminates in ~1ms.
- **F4 (S1/HONEST)** — `permission-auto-allow` no longer blanket-allows Bash, so the guard's
  interactive `ask` is not auto-swallowed. Overclaims corrected here. ⚠️ **STILL NEEDS a
  default-mode smoke test** (see loose ends).

Tests added/updated: `buildDaemonInvocation` (2), destructive-guard split-flag + leading-SKIP
(75 total), `tldr-context-inject` termination. Emit invariant 4/4 throughout.

## START HERE — remaining loose ends

1. **F4 interactive-gate smoke test (needs a human, ~1 min).** Run Claude Code in **default
   (non-bypass) mode**, attempt `rm -rf <throwaway-dir>`, and confirm a permission PROMPT
   appears (not silent auto-approve). The fix is in place; only interactive verification
   remains. If it still auto-approves, the deeper fix is to stop `permission-auto-allow`
   firing on the guard's ask path.
2. **ST-05 resident recall daemon** — the only path to the USABLE ≤3s target (the ~10s
   memory hot-path is the per-call `uv`+python boot; F5 removed the separate ~5s tldr hang).
3. **Guard backlog (S2/S3, from the review):** `bash -c "rm -rf /"` / backtick-wrapped
   payloads bypass the guard (quote-strip blind spot — see incident below); `find … | xargs rm`
   and more split-flag git ops; make `agent-error-capture` fire-and-forget (10s sync store on
   every Task completion); add an integration test feeding real Task events to the 12 revived
   hooks; settings-template test should assert event+matcher correctness.
4. **Doc/dead-code cleanups (S3):** remove dead `checkLocalMemory`; fix `memory-sanitize`
   header ("Both" → 5 sites); `agent-model-guard` is misnamed.

## Incident (no damage, but a real lesson)

The F-fix commit's message contained **backtick-wrapped commands inside a double-quoted
`git commit -m "..."`** — bash ran them as command substitution (`git clean -d -f`, `rm -rf x`,
`docker rm --force`). Verified NO damage (0 untracked files existed → git clean removed nothing;
no `x`/`build` dir existed; no tracked deletions; commit content intact). Only the message was
mangled (amended cleanly via `-F file`). Root lesson: the destructive-guard **strips quoted
strings**, so it could NOT see the destructive content inside the `-m "..."` and allowed the
commit — but bash still executed the backtick subs. **Always use `git commit -F <file>` or
single-quoted `-m '...'`; never backticks/`$()` in a double-quoted `-m`.** This is the same
quote-strip blind-spot class as the `bash -c` backlog item.

## Constraints carried forward

Push `fork` not `origin` · never change BGE model/dim · Windows-safe · never full vitest (run
specific files; daemon-client.test.ts integration tests are slow — filter with `-t`) ·
emit-guard 4/4 after hook edits · verify before claiming done · do NOT touch
`feature/cma-integration` · `git commit -F file` (not backtick `-m`) · the destructive-guard
denies (not asks) in this bypass session — override per-command with a LEADING
`SKIP_DESTRUCTIVE_GUARD=1` prefix.
