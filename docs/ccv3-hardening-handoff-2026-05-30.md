# CCv3 Full Hardening & Improvement — Handoff (2026-05-30)

> **Purpose of this doc:** Orient the *next* session to implement the CCv3 hardening program. This session was **review + diagnosis only** — no system changes beyond two earlier-shipped fixes (tldr popup, `@pageindex/mcp` removal) and these two docs. Read this top-to-bottom, then pick a scope tier (§6) and start at §3 Step 1.

**Goal:** A lean, correct, *used-correctly* CCv3 — the foundation for all agentic work (code, research, PM/planning, huge-info management). **Priority pillar: context & huge-info management.** **Posture: balanced** (remove confirmed-dead, archive maybe-dead reversibly, consolidate dupes).

**Source artifacts unified here:**
1. 5-auditor lean audit → `docs/ccv3-lean-audit-2026-05-30.md`
2. v3 "Cohesive Intelligence System" design → `~/.claude/plans/we-have-recently-done-refactored-storm.md`
3. Two shipped ROADMAP commits — `091f19f`, `bf91c19` (on local `main`, unpushed)
4. Cross-model Codex adversarial pass (15 findings + 6 gates) → `.claude/cache/agents/codex-adversary/latest-output.md`

---

## 1. System diagnosis — intent vs reality

**Data-integrity correction (important):** an earlier "memory empty (3 rows) / PageIndex empty" reading was a `pg_stat` stale-estimate artifact. Authoritative `count(*)`: `archival_memory`=**569** (+184 archived), `pageindex_trees`=**177**, `pageindex_nodes`=**2,418**, `sessions`=**1,117**, `file_claims`=**6,720**. Memory and the homegrown PageIndex DB are *populated* — the gaps are reliability and verified-value, not emptiness. Lesson for the next session: always `count(*)`, never trust `pg_stat_user_tables.n_live_tup` for usage calls.

| Subsystem | Set up? | Used as intended? | Headline gap (evidence) |
|---|---|---|---|
| Memory (DB recall) | YES | MOSTLY | 27.5% inject rate; **32% subprocess timeout**, BGE daemon down 35%, 9–12s latency |
| Memory (agent-side recall) | WIRED | **NO** | `agent-recall.jsonl` = 1 test entry; agents run blind (highest-value gap) |
| Memory (security) | — | **VULN** | `memory-awareness.ts:622-633` + `agent-recall-injector.ts:135-160` raw-content prompt-injection |
| TLDR warm-cache hook | WIRED | **NO** | no `meta.json` ever created → `isCacheStale()` infinite no-op loop |
| RLM | YES | **NO** | last run 2026-04-23; covers the huge-info niche but dormant |
| Knowledge-tree | YES (fresh) | **PARTIALLY** | components point at `test-screenshots/routes`, `spark-frontend-experiment/nexus/oauth` (test-dir noise, observed live) |
| PageIndex (homegrown) | YES (2,418 nodes) | **UNVERIFIED** | navigator fires every prompt; no log of query-hit vs static-fallback |
| Per-prompt hot path | — | **HEAVY** | 13 UserPromptSubmit hooks, 2 heavy subprocesses, ~700–1,400 chars/prompt |
| Sync (`sync-to-active.sh`) | — | **FOOTGUN (live)** | rebuilds active dist from stale active src → `architecture-stats-sync.ts` already diverged |
| Ralph state | — | **STALE (live)** | `ccv3-visualization` 11/11 done but `active=true` → 3 phantom injections/session |
| ralph-delegation-enforcer | registered | **ADVISORY-ONLY** | never blocks since 2026-04-23; RULES.md still claims it blocks |
| Cross-terminal coord | YES | **YES** | 1,117 sessions / 6,720 claims working — but `C:/` vs `C:\` path-sep + dual `getSessionId` fragility |
| ROADMAP corruption | — | **FIXED** | commits `091f19f` (advisory-only) + `bf91c19` (note-preservation) — tested; validate the audit |
| Dedup/dead weight | — | **PRESENT** | `skill-creator`==`skill-forge`, deprecated/structural-FAIL skills, 2 dead MCP servers + 6 dup entries, vibe-trading agents in global dir, hardcoded Neon token |

Already done this session (not part of the remaining program): tldr SessionStart console-popup fixed (`tldr warm .`, no shell/`--background`, detached + `windowsHide`); `@pageindex/mcp` hosted server removed from all 5 config locations (zero usage; was the `localhost:8090` OAuth popup).

---

## 2. The three workstreams

### WS-0 — Present-day bugs + live hazards (fix what's actively broken/dangerous NOW)
Independently valuable regardless of the bus. Sources: v3 §16 + lean audit P0.
- **0.1** Consolidate dual `getSessionId()` → `shared/session-bus-id.ts` (v3 §13 Q7). **Carries live risk — see G5 + findings #1/#11/#12/#15.**
- **0.2** Patch memory prompt-injection in `memory-awareness.ts:622-633` + `agent-recall-injector.ts:135-160` (XML-wrap data-only, 500-char cap, strip control chars, drop trailing imperatives, regression test). **Specify the escaping algorithm — finding #13.**
- **0.3 (audit P0)** Make the `sync-to-active.sh` fix **structural** — *delete* the `npm run build` block (not just default `--skip-build`). Finding #3.
- **0.4 (audit P0)** Deactivate the stale `ccv3-visualization` Ralph state (`session-deactivate`) + fix `session-start-recovery.ts:125` (`completedTasks < totalTasks`).
- **0.5 (audit P0)** Regenerate continuous-claude knowledge-tree from a real component description (Memory/Hooks/Agents/Skills/Workflows/Observability), not test-dir discovery.

### WS-1 — Lean prune / consolidate (hygiene + reliability layer)
Source: lean audit P1–P3. De-risks the substrate by shrinking the surface first.
- **P1** Per-prompt hot-path: guard/condition `pageindex-navigator` (instrument hit-vs-fallback first); merge the 3 Ralph UPS hooks into 1 with early-exit; early-exit `sentry-error-context` / `braintrust_hooks.py`; fold `user-confirmation-detector` into `smarter-everyday`.
- **P2** Memory reliability: persistent BGE daemon + fail-fast (<3s); **activate agent-side recall** (gated behind 0.2 — see G3). TLDR: remove the broken warm-cache hook (on-demand only). RLM: document as the large-overflow tool, keep dormant. PageIndex: decide keep/archive *after* P1 instrumentation.
- **P3** Dedup/dead-code: archive `skill-creator`/`create-better-skills`/`claude-in-chrome`; delete `*.bak`; remove `tdd-migration-pipeline` ghost; reconcile `math/*` (move or de-register); wire orphan skills (`recall`/`remember`/`qa-*`/`hook-audit`/...); move vibe-trading agents (`quant-analyst`/`risk-officer`/`paper-trader`) to that project; archive structural-FAIL skills (`agentica-*`, `excalidraw-mcp`, `wiring`); remove `next-devtools`+`idearalph` MCP + dedupe the 6 duplicate `.claude/mcp.json` entries; **move Neon token to `${NEON_API_KEY}` (security)**; fix excalidraw port 3002 conflict; add `cmd /c` to git/fetch MCP.
- **P-docs** Fix RULES.md / `plan-to-ralph-enforcement.md` enforcement-claim mismatch (ralph-delegation-enforcer is advisory-only).

### WS-2 — v3 Cohesive Intelligence substrate (strategic spine = the context-pillar priority)
Source: the v3 doc. L0–L5 model with a session Context Bus. Phases A→E, each independently gated; each has standalone value (can stop at A, or B.5).
- **A** Foundations: `shared/context-bus.ts` (single-writer) + `session-bus-id.ts`; `intel-bus.jsonl`; boundary doc; audit-script baseline; vitest. (3–5 days)
- **B** Facade: `scripts/code-intel.mjs` Node CLI; bus-read in memory/agent-recall; bus-populating hooks; `code-intel-enforcer` (warn mode). **B.5** patch top-5 instruction surfaces.
- **C** Codegraph as first L3 specialist (Windows contract test first) → **C.5** flip enforcer to deny (telemetry-gated ≥80% adoption).
- **D** Memory bridge: `archival_memory.metadata.bus_snapshot` (never `content`); WRRF recall boost. **Needs a GIN index — finding #6.**
- **E** Cohesion observability: `intel-bus-stats.mjs` + weekly `/loop 7d` digest (assign an owner).

---

## 3. UNIFIED SEQUENCING — the integration output (Codex-hardened)

**Verdict: the three workstreams CANNOT run in parallel as written.** Minimum-safe order with the 6 hard gates:

| Step | Action | Gate | Why |
|---|---|---|---|
| 1 | WS-0.3 structural sync fix (delete build step) | **G1** | else every new WS-2 hook silently never fires |
| 2 | WS-0.2 memory injection fix (+ test) | **G3, G4** | must precede WS-1 P2 agent-recall; same files — serialize |
| 3 | WS-1 P1 UPS-hook prune (+ manifest check) | **G2** | else WS-2 Phase A's new UPS hooks get pruned |
| 4 | WS-0.1 session-id consolidation **WITH Postgres `file_claims` migration / dual-read** | **G5** | else live cross-terminal conflict detection breaks (6,720 rows) |
| 5 | WS-2 Phase A context bus | — | now safe: sync fixed, UPS pruned, session-id consolidated |
| 6 | WS-1 P2 agent-recall activation | — | now safe: injection fix already shipped |
| 7 | WS-1 P3 skill archive — **cross-checked vs Phase B.5 targets** | **G6** | else B.5 patches an already-archived skill |
| 8 | WS-2 Phase B → C → D → E, each per its own telemetry gate | — | D needs the GIN index first |

WS-0.4 (stale Ralph), WS-0.5 (knowledge-tree), and the Hygiene Gate (§5) are independent — run them anytime early.

**The 6 gates, stated plainly:**
- **G1** — Sync fix must be structural before any WS-2 hook work.
- **G2** — Finish the UPS-hook prune (with a registration manifest check) before Phase A adds new UPS hooks.
- **G3** — Injection fix (0.2) ships + test-verified before agent-recall activation (P2).
- **G4** — 0.2 and P2 must NOT be developed in parallel against the same files (the May-2026 hook-regression pattern).
- **G5** — Session-id consolidation includes a `file_claims` migration or dual-read before any shim deploys.
- **G6** — P3 skill-archive list is cross-checked against Phase B.5 patch targets before archiving.

---

## 4. Findings to carry into implementation (don't lose these)

**Cross-model agreement (Claude + Codex, high confidence):**
- **#1** Session-id migration breaks `file_claims` — Phase 0.1 drops `COORDINATION_SESSION_ID`; 6,720 live rows keyed old. Need an old→new migration OR a coordination-shim keeping the old chain for `session-register.ts`/`file-claims.ts`. (See #15.)
- **#2/#4** Injection fix is a blocking prereq for agent-recall; both touch the same files — serialize, never parallel.
- **#3** Sync fix must be structural (delete `npm run build` from `sync-to-active.sh:196-205`), not an advisory flag.
- **#6** Phase D needs a GIN index on `metadata->'bus_snapshot'->'symbol_ids'`; validate with `EXPLAIN (ANALYZE, BUFFERS)` at simulated 10K rows.
- **#7** `SubagentStop` has no output contract — define a JSON/sentinel block, update `kraken` to emit it, log `bus_updates_extracted=0` when missing (else the bus silently never updates for 100% of current agents).
- **#8** 50ms bus-read budget will be blown by Windows Defender (200–500ms file locks) — instrument latency from day 1; gate Phase C on >70% read success.
- **#9/#10** Bus files have no TTL/cleanup; shim removal has no versioning gate (require a Postgres count check before removal).

**Claude-only — Windows-specific (Codex missed; verify in Phase 0.1):**
- **#11** `session-id.ts:27` uses `process.env.HOME || '/tmp'` — **HOME is unset on Windows** → silent `/tmp` fallback. Root cause of the `C:/` vs `C:\` claim inconsistency. Use `USERPROFILE`.
- **#12** `cwd_inode` in the deterministic-hash fallback **returns 0 on NTFS** → no cross-project isolation on Windows. Use `sha256(fs.realpathSync(dir).toLowerCase())`.
- **#13** Phase 0.2 escaping algorithm unspecified — recommend HTML-encode `< > & "` in the content field only; test with `</context>` AND `<context trust="elevated">`.
- **#14** Phase A has no gate checklist — minimum blocking set: atomic bus writes (`writeStateWithLock`), `CCV3_BUS_OFF` kill switch, 50ms fail-open, 0.1 consolidation, 0.2 fix.
- **#15** Shim contract unspecified — coordination callers MUST keep the old `COORDINATION_SESSION_ID`-first chain for the whole transition; bus callers use the new chain. Two exported functions, not one.

---

## 5. Hygiene gate (early)
- After WS-0.3, verify `architecture-stats-sync.ts` (commit `158ad4c`) is **registered in settings.json + built + synced** (it's the live footgun casualty).
- Triage working-tree scratch — delete: `dump_meta.txt`, `status_dump.{txt,py}`, `final_status.{txt,py}`, `final_check.txt`, `eval_log_tail.txt`, `ps_kill_log.txt`. Resolve the pre-staged index set (commit or unstage). ROADMAP.md churn is expected.
- Push 5 commits to **`fork`** (Rev4nchist/Continuous-Claude-v3) — **NEVER `origin`** (parcadei). Delete `fix/roadmap-hooks` after (identical to main).

---

## 6. Open decisions for the next session
1. **Scope tier** — full v3 arc (Phase 0–E, ~3–4 wks) vs. "smaller" (Phase 0 + A, gate B–E) vs. "smallest" (Phase 0 only). The v3 doc recommends **Phase 0 + A first**; WS-0 + the hygiene/lean P0 wins are cheap and high-signal regardless.
2. **WRRF source weights** are unfitted guesses — log to `bus-wrrf.jsonl` for 30 days, fit empirically (v3 §17.1).
3. **PageIndex homegrown** keep-vs-archive — decided by the P1 instrumentation result.
4. **RLM** as the canonical huge-info tool — confirm + document, or retire.

## 7. Key references
- v3 design: `~/.claude/plans/we-have-recently-done-refactored-storm.md` (§10 phases, §13 Q1–Q16, §15 mitigation matrix, §16 Phase-0 bugs)
- Lean audit: `docs/ccv3-lean-audit-2026-05-30.md`
- Codex raw output: `.claude/cache/agents/codex-adversary/latest-output.md`
- Critical files: `shared/session-id.ts:13-120`, `shared/session-isolation.ts:23-89`, `memory-awareness.ts:622-633`, `agent-recall-injector.ts:135-160`, `scripts/sync-to-active.sh:38,196-205`, `shared/atomic-write.ts:42-143`, `shared/host-ram.ts:42-58`, `recall_learnings.py:740-779`
- Already shipped (local `main`, unpushed): `091f19f`, `bf91c19`

## 8. Verification protocol (for the implementing session)
Each step ships behind its gate with: vitest green, `audit-braintrust-emits.sh` baseline intact, a fresh-session smoke test (no console popup, no stale-Ralph noise, expected hooks fire), and — for WS-0.1 — a `file_claims` cross-terminal conflict test BEFORE and AFTER migration. Nothing flips to enforcement `deny` mode without telemetry showing ≥80% adoption.
