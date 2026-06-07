# CCv3-Hardening — Session 9 Completion Handoff (2026-06-07)

Outcome: **SUCCEEDED.** The session-9 finish line — repo reconciliation → P1 bus-bias decision → WS-0/WS-1 loose ends → **build + wire codegraph behind `/code-intel`** — is complete. codegraph is LIVE as the first L3 specialist. Only C.3 (the 4-week telemetry watch) was deferred by user choice.

Plan (premortem-hardened, authoritative): `~/.claude/plans/we-have-been-working-starry-pony.md`.

---

## What shipped

### Step 0 — Repo reconciliation (DONE)
- **Herd-fix PR #8** opened (`feature/embedding-daemon-herd-fix`: `ea1b03c`+`c1b110d`).
- **Chore reconciliation PR #9** (`chore/session9-reconciliation`, 8 commits): committed the loose work (store_learning Braintrust scoring +132/−9, fastmcp playbook, viz, 10 docs, ONBOARDING/scripts/skills-lock), deleted **4** junk stderr-artifact files (the kickoff said 2 — `opc/Salesforce` + `opc/Safety\`` were extra), gitignored `.codex/` (a huge Codex CLI mirror) + `tools/PerfView.exe`, renamed the leading-`#` memory-eval doc + fixed its inbound ref, discarded 3 CRLF-only dist phantom diffs. Secret-scan clean.
- **WS-0.3 structural** was already done (verified — no `npm run build` in either sync script); the kickoff overstated it.
- Mid-session a roadmap hook **clobbered ROADMAP Current Focus with a foreign Salesforce/FastMCP goal** (from plan `abstract-coral`); caught + restored (commit `8201551`).

### P1 — Bus-bias lift decision (DONE, user-ratified)
- **Verdict: KEEP ENABLED.** Verified warm gate (daemon pid alive, BGE dim 1024, corpus 584, n=13): **+7.3% top-score / flat 69% hit-rate**, read-only PASS. Reproduces the 2026-06-04 warm run (+7.0%/flat).
- The documented **+33.6% / 63→88% does NOT reproduce — retired as a stale snapshot.** Decomposition: representative-only (n=8) ≈ +14.5% (≈ the original +15.3%); the 5 STRONG cases dilute to +7.3% because bias doesn't help already-strong matches.
- Recorded: ROADMAP + memory id `79da5d25`. Deferred: tune focus-term weighting (a few cases regress: Nia −24%, agent-recall −15%).

### WS-0 / WS-1 loose ends
- **WS-0.5** knowledge-tree regenerated + validated (361 dirs, `.bak` refs gone). **WS-0.3** closed (verified). **P3 Neon-token** scan clean.
- **Deferred:** P-docs (RULES.md is machine-local; the "enforcement-claim mismatch" is unspecified / likely already reads "soft"). P3 dedup/dead-code sweep (broad, low finish-line value). **WS-0.1 session-id consolidation stays deferred (G5 binding).**

### Phase C — codegraph LIVE behind /code-intel (DONE) — PR #10
Branch `feature/ws2-phase-c-codegraph` (off #9):
- **C.0** `2414b10` — `@colbymchenry/codegraph@0.9.9` pinned hooks devDep. Provenance clean (OSV zero on wrapper + win32 binary; **codegraph introduced 0 of the 6 audit vulns** — those are pre-existing vitest/esbuild dev-tooling). Windows-verified. `.codegraph/` gitignored. Lockfile committed.
- **C.1** `a13626d` — Windows platform contract **GATE GREEN (12/12)** (`.claude/rules/windows-platform.md`): 20/20 edit→`sync`→query freshness (20/20 stale under the no-sync control), WAL active, result-quality, spaced-paths, daemon coexistence.
- **C.2** `a0f8062` — facade wiring + **5 codex-review fixes**. Routes who-calls→`callers`, find-symbol→`query`, code-context→`query`+`impact` fused with tldr+recall+biasByFocus. Kill-switch `CCV3_KILLSWITCH`→`CCV3_CODEGRAPH_OFF`→absent→**unchanged TLDR fallback**. Facade suite **30/30**.

**Phase C platform findings (load-bearing — in `windows-platform.md` + `code-intel-boundaries.md`):**
1. `.cmd`/`.bat` shims **cannot** be `spawnSync`'d on modern Node (CVE-2024-27980/EINVAL) → invoke `node <pkg>/npm-shim.js` via `process.execPath`, array args, never `shell:true`.
2. ~3–4s Node+WASM cold-start tax **per call** → the facade amortizes via a cached O(1) git-HEAD probe, never by speeding codegraph.
3. Incremental `sync` **orphans cross-file caller edges** after a callee-file edit → `who-calls` re-syncs caller files / `index --force` / escalates to Serena (the facade emits a `serena_hint`).
4. Freshness is `sync`-load-bearing (no watcher in one-shot CLI). Stale-on-clean-HEAD-change is closed via a persisted `.codegraph/.indexed-head` stamp.

---

## Open for the next session

### Merges (user action) — order matters
1. **PR #8** (herd) → `fork/main`, after CodeRabbit.
2. **PR #9** (chore reconciliation) → `fork/main`.
3. **PR #10** (Phase C) → `fork/main` (it's based on #9, so merge #9 first or rebase).

### C.3 — 4-week telemetry watch (DEFERRED, not started)
Plan's Phase C C.3. Stand up a **durable** scheduler (NOT a bare `/loop`) + a checked-in manifest + a last-run health check (fail if no rows in 8d), logging the §9 cohesion metrics to `intel-bus.jsonl` + a new `bus-wrrf.jsonl` (30d, for WRRF weight calibration). It feeds the **C.5** flip-to-deny gate (≥80% facade adoption + bypass→0), which is OUT of scope. Start it anytime — it has no dependency on the merges.

### Follow-up hazards (non-blocking; found this session)
- **Junk-creator hook:** a `store_learning.py` invocation with **unquoted shell metacharacters** in `--content` creates the `opc/` junk files (one regenerated mid-session). Fix: quote the store invocation in the offending hook (likely a Codex-side or extraction hook).
- **Roadmap contamination-guard miss:** the `post-plan-roadmap` hook clobbered Current Focus with a foreign project's goal; the cross-project guard didn't catch it. Harden the guard / fix the plan-file selection.
- **Pre-existing dev-dep vulns** (NOT codegraph): `npm audit` in `.claude/hooks` shows vitest UI-server (critical), vite/rollup path-traversal (high) — the test-runner chain. `npm audit fix` deferred (test-suite-break risk). Address separately.
- **Stray `scripts/.claude/logs/intel-bus.jsonl`** — facade-test pollution when run from a nested cwd; not root-gitignored. Clean + add `**/.claude/logs/` to `.gitignore`, and scope the test's cwd.
- **Doubled `.ralph` path:** `ralph-state-v2.py -p continuous-claude` from the repo root created `continuous-claude/continuous-claude/.ralph/` (the `-p` resolves relative to cwd). Gitignored clutter — clean it; the `-p` arg wants `.` or an absolute path.

## Constraints (unchanged)
Push `fork` never `origin`. Do NOT change BGE model/dim (1024). Gates G5 (blocks WS-0.1), G6 (before P3 archiving) still binding.
