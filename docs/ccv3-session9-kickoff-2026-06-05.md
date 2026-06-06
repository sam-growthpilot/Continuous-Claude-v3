# CCv3-Hardening — Session 9 Kickoff (2026-06-05)

Self-sufficient orientation for the next session. Read this top-to-bottom; you
should not need to re-open the five prior handoffs unless you want depth. Chosen
finish line for this push: **through Phase C (codegraph)**. Repo reconciliation
is **mandatory step 0**.

Two hard constraints, always:
- Push to **`fork`** (Rev4nchist), **never `origin`** (parcadei = upstream).
- Do **NOT** change the BGE model or dim (`BAAI/bge-large-en-v1.5`, dim 1024).

---

## Paste-ready kickoff prompt

```
Continue ccv3-hardening. Read docs/ccv3-session9-kickoff-2026-06-05.md in full first.

Then execute in order:
1. STEP 0 (mandatory): repo reconciliation — open the herd-fix PR, commit the real
   loose work in logical commits, delete the junk files, fix .gitignore, rename the
   '#'-prefixed doc. End with a clean `git status` and one open PR. Confirm before any rm.
2. P1 bus-bias decision — re-run the warm hybrid quality gate, trace the +33.6% vs
   measured +7.0% provenance, apply the rollback thresholds, decide keep/tune/rollback,
   and record the verdict in ROADMAP + a memory entry.
3. WS-0/WS-1 loose ends (gate-aware: respect G5/G6).
4. Phase C — build + wire codegraph as the first L3 specialist, with the Windows
   edit-freshness contract test, then start the 4-week telemetry watch.

Constraints: push fork never origin; never change BGE model/dim (1024). Use /maestro or
/ralph for the multi-step build; delegate implementation to kraken, verify independently.
Definition of done is in the kickoff doc §6.
```

---

## 1. Ground-truth state (verified 2026-06-05 via 3 scouts + git/test forensics)

### Done + merged
| Item | Evidence |
|------|----------|
| WS-0.2 memory prompt-injection fix | `61625aa`, `a16e7f9` |
| WS-0.3 sync footgun (PARTIAL — `--skip-build` no-op only) | `2702bbd` |
| WS-0.4 stale Ralph deactivation | `e48dc92` |
| WS-1 P1 per-prompt hot-path lean | `7d858cf` |
| WS-1 P2 agent-recall activation + fail-fast | `017929a`, `28184c3`, `a08014a` |
| WS-2 **Phase A** context-bus substrate (wired to NO consumer) | `cb9c14a` |
| WS-2 **Phase B** facade + bus read/write + inert enforcer | PR #5 `1295fd4`, PR #6 `0a2e75b` |
| Embedding-daemon **warmth** fix (TMPDIR/TEMP rendezvous) | PR #7 `3a398236` |

### Done THIS session — NOT yet merged (no PR exists)
Branch **`feature/embedding-daemon-herd-fix`** (currently checked out), 2 commits ahead of `main`:
- `ea1b03c` — atomic spawn lock (`openSync wx` + stale reclaim, pre-validate before lock, unlink-on-failure) + no-shell Windows spawn (resolved abs uv path, `windowsHide`, no `cmd.exe`).
- `c1b110d` — test kill-switch `CCV3_EMBEDDING_NO_SPAWN=1` so `npm test` never spawns real daemons.

Verified: 1 warm daemon (PID was 17936; ping `ready:true`), `node scripts/bus-quality-gate.mjs hybrid` → `WARM` + PASS, embedding-client suite 35/35 green, daemon count flat across a full test run. T1 probe confirmed zero console windows + child survives parent exit.

### Open / not started
- **P1 — bus-bias lift decision** (highest priority): warm gate showed **+7.0% top-score / flat 69%→69% hit-rate**, NOT the documented **+33.6% / 63%→88%**. Daemon is now genuinely warm, so this is cleanly runnable. Decide **keep / tune / rollback**.
- **WS-0.1 session-id consolidation** — blocked by **G5** (needs `file_claims` migration or dual-read; ~6,720 live rows on the old `COORDINATION_SESSION_ID` chain). Note: `f6a654e` already fixed the Windows HOME→USERPROFILE fallback; the *consolidation* is still open.
- WS-0.3 **structural** sync fix — delete the `npm run build` block from `sync-to-active.sh` (the `--skip-build` no-op was only a partial fix).
- WS-0.5 knowledge-tree regen for continuous-claude.
- WS-1 P3 dedup / dead-code / skill-archive / **Neon token security** (respect **G6**).
- WS-1 P-docs — enforcement-claim mismatch fix in RULES.md.
- **Phase C** (codegraph) — confirmed **net-new build** (`glob codegraph*` = none). Facade already stubbed for it (§5).

### Pre-existing risks / "devil in the details"
- **Test suite:** full `vitest run` = 7 files failed / 12 tests failed / 1858 passed / 7 skipped. 3 failures are the known node:test stubs (`extractLedgerSection`, `findSessionHandoff`, `mainHandoffFirst` — "no test suite found", 0 real failures). ~4 real failing files + 1 worker crash are **pre-existing**, unrelated to the herd branch. The herd/embedding tests are green.
- Full parallel `vitest run` **hangs** on a Windows daemon/socket suite — add a per-test timeout (medium priority).
- **Post-commit forward-sync race** leaves active hook `dist/` stale — hash-verify + `cp` the affected `.mjs` to `~/.claude/hooks/dist/` after every hook commit until root-fixed. (Last session also hit a hung `sync-to-active.sh` chain + stale `index.lock`; if `git` reports a lock and only `fsmonitor--daemon` is live, the lock is stale.)

---

## 2. STEP 0 — Repo reconciliation (MANDATORY, do first)

The tree is messy: real uncommitted work tangled with junk and an unmerged branch. Clean base before any feature work. **Confirm before every `rm`.**

**2.1 Open the herd-fix PR** (branch is already pushed to fork):
```
gh pr create --repo Rev4nchist/Continuous-Claude-v3 --base main --head feature/embedding-daemon-herd-fix --title "fix(memory): herd-proof embedding-daemon spawn + test kill-switch" --body "Atomic wx spawn lock + no-shell Windows spawn (ea1b03c); test kill-switch CCV3_EMBEDDING_NO_SPAWN so npm test never spawns real daemons (c1b110d). Second root cause after PR #7's rendezvous fix. 35/35 embedding tests green; daemon count flat across full run; T1 probe = zero windows."
```
You should see a PR URL. (If `gh` targets upstream by default, the explicit `--repo Rev4nchist/...` keeps it on the fork.)

**2.2 Commit the real loose work** — recommended on a separate `chore/` branch off `main` so it doesn't collide with the herd PR. Logical commits, each its own:
- `opc/scripts/core/store_learning.py` (+141 lines — new `_emit_store_quality_score()` Braintrust scoring). Run the emit guard after: `bash scripts/audit-braintrust-emits.sh`.
- `docs/fastmcp-connector-playbook.md` (+41 — FastMCP AzureProvider production path).
- The ~10 uncommitted handoff/project docs in `docs/` (incl. this kickoff + session-6/7/8 + hardening-handoff + lean-audit) + `ROADMAP.md`.
- `docs/architecture/system-visualization/{architecture.json,index.html}` (viz artifacts).

**2.3 Delete junk** (shell-artifact files — confirm first):
- `` opc/`append` `` and `opc/{api_name` — accidental command-substitution debris.

**2.4 .gitignore + rename:**
- Add `.codex/` (Codex CLI local config) and `tools/PerfView.exe` (~50MB binary) to `.gitignore`.
- Rename `docs/# Evaluation of Current Memory System.md` → `docs/ccv3-memory-system-evaluation.md` (leading `#` is a shell hazard), then commit.
- The 3 `M .claude/hooks/dist/*.mjs` are **CRLF-only noise** (0-byte diff) — ignore or `git checkout` them.

End state: clean `git status`, one open PR, junk gone.

---

## 3. The finish-line path (sequenced, gate-annotated)

### (a) P1 — bus-bias lift decision  [headline quality task]
1. Re-run warm: `node scripts/bus-quality-gate.mjs hybrid` (expect `WARM` + READ-ONLY ASSERTION PASS, archival_memory row count unchanged — was **579** this session).
2. **Trace the +33.6% provenance** — it's cited in `docs/ccv3-ws2-phaseB-plan-2026-06-02.md` and PR #5. Leads to check: corpus drift (574 → 579 rows since the original run), a different/smaller case set vs the 13 cases in `bus-quality-gate.mjs` (8 `repr` + 5 `STRG`), or a cold-but-mislabeled baseline.
3. Apply the §8 rollback thresholds (from the Phase B plan): flip `CCV3_BUS_OFF=1` and re-measure if hit-rate drops vs baseline, top-score regresses >~10%, injected-stale rate too high, observable added latency, or a `bus_write_dropped` storm under normal use.
4. **Decide: keep / tune the focus-term weighting / rollback.** Record the verdict in `ROADMAP.md` and a memory entry (`store_learning.py`, type `ARCHITECTURAL_DECISION`).

### (b) WS-0 / WS-1 loose ends  (gate-aware)
- WS-0.3 structural: delete the `npm run build` block from `sync-to-active.sh` (the real G1 closure).
- WS-0.5: regen continuous-claude knowledge-tree (`knowledge_tree.py --project`).
- P-docs: fix the enforcement-claim mismatch in RULES.md.
- P3 dedup / dead-code / Neon-token security — **G6**: cross-check the skill-archive list against the Phase B.5 patch targets before archiving anything.
- **Defer WS-0.1** (session-id consolidation) unless you deliberately take on the **G5** `file_claims` migration / dual-read (6,720 rows; two exported functions — coordination callers keep the old chain, bus callers use the new one).

### (c) Phase C — codegraph  (net-new build; see §5)
Acceptance criteria (v3 design §10): Windows **platform contract test** (20× edit-then-immediate-query freshness must hold), **wire codegraph behind `/code-intel`** filling the fallback stubs at `scripts/code-intel.mjs:303-395`, then start the **4-week telemetry watch** on the §9 cohesion metrics. **C.5** (flip `CCV3_FACADE_MODE=deny`) is **gated** on intel-bus showing **≥80% facade-route adoption** + bypass→0 — that's a watch to start, NOT a ship this push.

---

## 4. The 6 hard gates (verbatim — do not violate)
- **G1** — Sync fix must be structural before any WS-2 hook work. *(partial; WS-0.3 still open)*
- **G2** — Finish the UPS-hook prune (with a registration manifest check) before Phase A adds new UPS hooks. *(satisfied)*
- **G3** — Injection fix (0.2) ships + test-verified before agent-recall activation (P2). *(satisfied)*
- **G4** — 0.2 and P2 must NOT be developed in parallel against the same files (the May-2026 hook-regression pattern). *(satisfied)*
- **G5** — Session-id consolidation includes a `file_claims` migration or dual-read before any shim deploys. **(BINDING — blocks WS-0.1)**
- **G6** — P3 skill-archive list is cross-checked against Phase B.5 patch targets before archiving. **(applies before P3)**

---

## 5. Phase C build brief (codegraph)

**What it is** (per `.claude/rules/code-intel-boundaries.md`): the L3 specialist that owns *"Find symbol X / Who calls X / code context for topic Z"* — broad, fast, FTS-first. Substrate: `.codegraph/codegraph.db` (SQLite) per project. Escalates to **Serena** for precise symbol identity (Serena is terminal authority). Owns symbol-callers; **TLDR** keeps `cfg`/`dfg`/`slice`/`dead`/`diagnostics`.

**It does not exist yet** — this is a build. The facade is already waiting for it:
- `scripts/code-intel.mjs:303-304` — `who-calls` / `find-symbol` help text notes "codegraph absent → tldr".
- `scripts/code-intel.mjs:362-395` — routing currently sets `escalated_from: 'codegraph'`, `routing_reason: 'codegraph absent (Phase C) → tldr …'`. These are the integration points to fill.

**Build shape:** an indexer that populates `.codegraph/codegraph.db` (symbol table + FTS) with edit-freshness (the 20× contract test exists to prove edit-then-immediate-query returns fresh results on Windows/NTFS — the platform that bit us before). Then replace the three facade fallbacks with real codegraph queries, keeping the Serena escalation path.

**Fold in v3 §17 open issues:** WRRF weight calibration (log `bus-wrrf.jsonl` 30 days post-C), the SCIP simultaneous rename+move edge case, Read-offset role misclassification (~10% acceptable).

---

## 6. Definition of done for THIS push
- [ ] Herd-fix PR merged to `fork/main`; `main` no longer behind.
- [ ] Working tree clean; junk gone; `.gitignore` + rename applied; loose real work committed.
- [ ] P1 bus-bias verdict made + recorded (ROADMAP + memory).
- [ ] Chosen WS-0/WS-1 loose ends closed (at minimum WS-0.3 structural, WS-0.5, P-docs).
- [ ] Codegraph **built + wired** behind `/code-intel`; Windows edit-freshness contract test green; 4-week telemetry watch started.
- [ ] Build clean, emit-guard 4/4, embedding + code-intel suites green, fresh-session smoke clean.

**Explicitly OUT of scope this push:** Phase C.5 flip-to-deny (telemetry-gated), Phase D (memory bridge + GIN index), Phase E (observability). Note them as the next horizon.

---

## 7. Pointer index
| What | Path |
|------|------|
| v3 "Cohesive Intelligence" design (§10 phases, §17 open issues) | `~/.claude/plans/we-have-recently-done-refactored-storm.md` |
| WS-2 Phase B plan (+ §8 rollback thresholds, warm-gate caveat) | `docs/ccv3-ws2-phaseB-plan-2026-06-02.md` |
| Full hardening handoff (WS-0/1/2, findings #1–#15) | `docs/ccv3-hardening-handoff-2026-05-30.md` |
| Lean audit | `docs/ccv3-lean-audit-2026-05-30.md` |
| Session 6/7/8 handoffs | `docs/ccv3-ws2-phaseB-SESSION6-HANDOFF-2026-06-04.md`, `docs/ccv3-session7-handoff-2026-06-04.md`, `docs/ccv3-session8-kickoff-2026-06-04.md` |
| L3 routing contract | `.claude/rules/code-intel-boundaries.md` |
| Facade CLI (Phase C integration points) | `scripts/code-intel.mjs` (303-395) |
| Context bus / session id / intel bus | `.claude/hooks/src/shared/{context-bus,session-bus-id,intel-bus}.ts` |
| Bus quality gate | `scripts/bus-quality-gate.mjs` |
| Embedding daemon + client | `opc/scripts/core/embedding_daemon.py`, `.claude/hooks/src/shared/embedding-client.ts`, `opc/scripts/core/recall_learnings.py` |
| Emit-invariant guard | `scripts/audit-braintrust-emits.sh` |

Remotes: `fork` = Rev4nchist (push here), `origin` = parcadei (never). Other branches: `ws2/phase-3-code-intel` (merged), `fork/ws2/phase-b-context-bus`.
