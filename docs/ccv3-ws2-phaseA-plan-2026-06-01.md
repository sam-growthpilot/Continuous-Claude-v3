# CCv3 WS-2 Phase A — Implementation Plan (Context-Bus Foundations)

**Date:** 2026-06-01 · **Status:** PLAN — awaiting approval before any code.
**Predecessors:** `docs/ccv3-hardening-state-2026-06-01.md` (current state) · `docs/ccv3-hardening-handoff-2026-05-30.md` (3-workstream plan, gates) · v3 design `~/.claude/plans/we-have-recently-done-refactored-storm.md` (§2 model, §4 bus schema, §6 observability, §10 phases, §13 Q&A).

---

## 0. Objective & scope boundary

Phase A builds the **L2 Context Bus substrate** — the session-scoped shared-state spine the v3 "Cohesive Intelligence" design is built on. It is the priority-pillar (context & huge-info) foundation.

**Phase A ships the substrate ONLY. It wires NO production consumer.** The bus is created, atomic, observable, kill-switchable, Windows-correct, and fully tested — but read/written by nothing in the live hot path yet. All specialist wiring (memory-awareness/agent-recall reading the bus, the populating hooks, the `/code-intel` facade) is **Phase B**. This keeps Phase A a low-risk, self-contained, independently-valuable deliverable with a clean stop/re-measure point after.

**Explicitly OUT of Phase A:** the facade CLI (B.1), bus-populating hooks (B.4), enforcement (B.5/C.5), codegraph (C), memory bridge (D), the SubagentStop *wiring* (B; A only defines its schema).

---

## 1. Prerequisite state (verified 2026-06-01)

| Prereq | State | Note |
|---|---|---|
| Gates G1 (sync structural), G2 (UPS prune+manifest), G3 (injection before recall), G4 (no parallel-edit) | ✅ satisfied | from Phase 0–3 |
| Gate G5 (session-id needs file_claims migration) | ✅ **de-risked** | Step 4 proved `session_id` is a transient non-key column — **no migration needed** |
| 0.2 injection fix (`shared/memory-sanitize.ts`) | ✅ present | A.5 regression-tests it on the bus path |
| `shared/atomic-write.ts` (`writeStateWithLock`) | ✅ present | A.1 builds the single-writer on it |
| `scripts/audit-braintrust-emits.sh` | ✅ present | A.4 adds `context-bus.ts` to its baseline |
| `shared/session-id.ts` + `shared/session-isolation.ts` | ✅ present (two impls) | A.0 consolidation target |
| `.claude/cache/session/` | ⬜ absent | A.1 creates it |
| JSONL appender precedent + backfill targets (`memory-recall.jsonl`, `codex-lift.jsonl`) | ✅ present | A.2 follows the pattern |
| `shared/context-bus.ts`, `shared/session-bus-id.ts`, `intel-bus.jsonl` | ⬜ absent | this phase creates them |

---

## 2. Work breakdown (file-by-file)

### A.0 — `shared/session-bus-id.ts` (prereq for A.1; was WS-0.1, de-risked)
- **What:** a clean `getBusId()` deriving a stable per-`(user, project, session)` id.
- **Windows-correct (findings #11/#12):** `process.env.USERPROFILE` (NOT `HOME` — unset on Windows → silent `/tmp`); per-project isolation via `sha256(fs.realpathSync(cwd).toLowerCase())` (NOT `cwd_inode`, which returns 0 on NTFS).
- **Boundary (finding #15):** this is a **second exported function**, NOT a merge. Coordination callers (`session-register.ts`/`file-claims.ts`) keep their existing `COORDINATION_SESSION_ID`-first chain untouched; only bus callers use `getBusId()`. The two existing impls stay (cleanly domain-separated); add a one-line header comment in each pointing to the boundary doc (A.3).
- **Risk:** low (no DB, no migration). **Tests:** A.5.

### A.1 — `shared/context-bus.ts` (single-owner writer)
- **Path:** `.claude/cache/session/<bus_id>/context.json`.
- **API (minimal):** `readBus(busId): BusEntry` · `mutateBus(busId, fn): BusEntry` (read-modify-write under lock) · typed helpers `addFocusSymbol`, `addFileInPlay`, `addRecentFinding`, `setIntent`.
- **Schema:** BusEntry v3 verbatim from §4.1 — `bus_id, current_intent, focus_symbols[], files_in_play{load_bearing[], ambient[]}, recent_findings[], open_threads[], schema_version=3, compact_generation, revision`. SCIP-style symbol identity (§4.1) and the 8-role `files_in_play` taxonomy (§4.2).
- **Atomicity (#14):** write via `atomic-write.ts writeStateWithLock`; **CAS** on the monotone `revision` counter (§13 Q4) — reject/retry on concurrent revision bump.
- **Re-read-on-every-call (§4.4):** no in-memory cache; every consumer re-reads `context.json`. Kills hook-ordering risk; survives compaction.
- **Kill switch (#14):** `CCV3_BUS_OFF=1` → all reads return empty `BusEntry`, all writes no-op. Fail-open by default on ANY error.
- **Latency budget (#8):** wrap reads/writes in a timer; if a read exceeds **50ms** (Windows Defender file-lock territory, 200–500ms), return empty + log the latency to intel-bus. Instrumented from day 1 (the real ≥70%-under-50ms gate is Phase C; A only builds the instrument).
- **Tests:** A.5.

### A.2 — `intel-bus.jsonl` writer + backfill
- **Path:** `.claude/logs/intel-bus.jsonl`. Event schema verbatim from §6 (`ts, bus_id, agent, facade, specialist, query_type, subject_id, result_count, rank, escalated_*, duration_ms, correlation_id, ..., schema_version=1, backfilled`).
- **Append safety (§6):** bare `appendFileSync` + **4 KB line-size assertion** + `\n` strip. Matches the 6+ existing CCv3 JSONL appenders (none corrupted in prod).
- **Backfill:** tag-copy existing `memory-recall.jsonl` + `codex-lift.jsonl` rows in with `backfilled:true` (excluded from gates, §13 Q15) so early dashboards aren't empty.
- **Tests:** A.5.

### A.3 — `.claude/rules/code-intel-boundaries.md` (L3 boundary doc)
- The §3 specialist-boundary table **verbatim** (codegraph / Serena / TLDR / ast-grep / archival_memory / PageIndex / knowledge-tree / Notion Bridge — who owns which query type, escalation, substrate).
- **Update for current reality:** note PageIndex is **on-demand only** (the per-prompt navigator was disabled 2026-06-01, Item 6). Add the `getBusId()` vs coordination-session-id boundary note (A.0).

### A.4 — `audit-braintrust-emits.sh` baseline
- Add `shared/context-bus.ts` to the guard's tracked set (defense against the May-2026 agent-rewrite collision — the same failure class G4 guards). The bus writer is exactly the kind of single-point file a later whole-file regen could silently gut.

### A.5 — Vitest
- **Bus writer atomicity:** two concurrent `mutateBus` calls → CAS rejects the stale one, no lost update, `revision` monotone.
- **JSONL append safety:** >4 KB line asserts/refuses; embedded `\n` stripped; concurrent appends don't interleave-corrupt.
- **session-bus-id resolution:** `USERPROFILE` honored; two different project paths → different bus_ids; same path different case → same bus_id (realpath+lowercase).
- **Prompt-injection regression:** content routed through the bus that later reaches an injection surface is still `memory-sanitize`-wrapped (0.2 holds); `</context>` and `<context trust="elevated">` payloads neutralized.
- **Kill switch + fail-open:** `CCV3_BUS_OFF=1` → no-op; forced fs error → empty `BusEntry`, never throws into the hot path.

---

## 3. Gate checklist — Phase A "done" requires ALL (finding #14 blocking-set + verification protocol §8)

- [ ] Atomic bus writes (`writeStateWithLock` + CAS `revision`) — proven by the concurrency test
- [ ] `CCV3_BUS_OFF` kill switch verified (set → all bus ops no-op)
- [ ] 50 ms fail-open verified (slow/failed read → empty `BusEntry`, latency logged)
- [ ] `session-bus-id.ts` present + Windows-correct (`USERPROFILE`, realpath hash) + two-function boundary intact
- [ ] 0.2 injection regression test green on the bus path
- [ ] `context-bus.ts` in `audit-braintrust-emits.sh` baseline; `audit-braintrust-emits.sh` 4/4 intact
- [ ] `npm run build` clean · `hook-manifest-check.mjs` OK · full vitest green
- [ ] Fresh-session smoke: a valid (empty) bus file appears at `.claude/cache/session/<bus_id>/context.json`, **zero** added prompt latency, no console noise

Nothing in Phase A flips any enforcement to `deny` (no enforcement exists until B.5/C.5).

---

## 4. Open design questions (flag for your input; otherwise I take the Rec)

| # | Question | Recommendation |
|---|---|---|
| Q-A1 | `session-bus-id` — fresh module vs reuse `session-isolation.ts`? | **Fresh** module, two-function split (finding #15). Lowest coupling; coordination chain untouched. |
| Q-A2 (#7) | `SubagentStop` output contract — define now or in B? | **Define the schema in A.3** (boundary doc) so kraken can adopt; **wire in B**. A ships the contract, not the hook. |
| Q-A3 | Bus TTL / cleanup (#9/#10) — session dirs accumulate forever | Add a tiny prune (drop `session/<id>/` older than 7 days) in A, OR document as an E.1 owner item. **Rec: small prune in A** (cheap, avoids unbounded growth). |
| Q-A4 | WRRF source weights | **No action in A** — not needed until Phase D; A only logs. |
| Q-A5 | Build solo vs delegated | **Rec: kraken TDD** for `context-bus.ts` + `session-bus-id.ts` (tests-first); main context for the boundary doc, baseline add, and backfill. Per G4, I will NOT run parallel agents editing the same TS file. |

---

## 5. Sequencing within Phase A

1. `session-bus-id.ts` (A.0) + its tests — unblock A.1
2. `context-bus.ts` (A.1): writer + CAS + kill switch + latency instrument + tests
3. `intel-bus.jsonl` writer (A.2) + 4 KB assertion + backfill + tests
4. `code-intel-boundaries.md` (A.3)
5. `audit-braintrust-emits.sh` baseline add (A.4)
6. Full gate-checklist pass (§3) + fresh-session smoke

Estimated **3–5 days**. Stop-condition honored: after A, **re-measure** before committing to B (per the audit's "Phase A alone may move the needle").

---

## 6. Risks & mitigations (Phase A-specific)

| Risk | Mitigation |
|---|---|
| Agent-rewrite collision on the single-point writer (the May regression class) | A.4 baseline guard + G4 (no parallel-edit of the same file) + run `audit-braintrust-emits.sh` after every TS hook edit |
| Windows file-lock latency blows the 50 ms budget | Instrument from day 1; fail-open returns empty; real gate deferred to C |
| Scope creep into B (wiring a consumer "while we're here") | Hard boundary in §0 — the bus is inert in prod until B; PRs that wire a reader are out of scope |
| `CCV3_BUS_OFF` not honored on some path → bus work leaks into hot path | Kill-switch test (A.5) covers read + write + error paths |

---

## 7. Execution model

- **TDD** (CLAUDE.md): failing test → implement → green → refactor, per module.
- **plan-to-ralph note:** if this plan is approved via `ExitPlanMode`, direct code edits are gated → execute via `/ralph` or delegated `kraken` (config/doc files pass through). If approved conversationally (this doc as the artifact), build directly via TDD. **Rec:** kraken-TDD the two TS modules, main-context the doc/baseline/backfill.
- **Verification after each step:** vitest for the module + `audit-braintrust-emits.sh` baseline intact + `npm run build` clean.

---

## 8. Definition of done

The Context Bus exists and is **atomic, observable, kill-switchable, Windows-correct, and fully tested — wired to no production consumer**. Verification baseline intact (emit-audit 4/4, hook-manifest OK, build clean, vitest green). A fresh session creates a valid empty bus at the correct path with zero added latency. We then **re-measure and decide Phase B vs stop** — each subsequent phase keeps its own telemetry gate.
