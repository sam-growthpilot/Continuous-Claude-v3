# CCv3 WS-2 Phase B — Implementation Plan (Activate the Context Bus)

**Date:** 2026-06-02 · **Status:** PLAN — awaiting approval before any code.
**Predecessors:** `docs/ccv3-ws2-phaseA-plan-2026-06-01.md` (substrate plan) · `docs/ccv3-hardening-state-2026-06-01.md` · v3 design `~/.claude/plans/we-have-recently-done-refactored-storm.md` (§3 specialist boundaries, §4 bus schema, §6 observability, §10 phases, §13 Q&A) · `~/.claude/plans/i-want-you-to-encapsulated-hare.md` (the hardened master plan + 12-row pre-mortem) · rule `.claude/rules/code-intel-boundaries.md`.

All anchors below were read directly this session (file:line verified, not grep-inferred).

---

## 0. Objective & scope boundary

Phase A shipped the **L2 Context Bus substrate** — atomic, observable, kill-switchable, Windows-correct, fully tested, but **wired to no production consumer**. Phase B **activates** it: the recall hooks READ the bus to bias retrieval, a small set of existing hooks WRITE the bus as tools run, and a `/code-intel` facade gives the bus a queryable front door. This is the "Cohesive Intelligence" payoff — the session's working set (focus symbols, files in play) starts informing what memory/recall surfaces.

**Phase B ships behind two safety properties that never change:** (1) `CCV3_BUS_OFF=1` kills all bus I/O instantly; (2) every bus touch is fail-open (an error returns empty / no-ops, never throws into the hot path). Phase A already guarantees both on the read/write primitives; B keeps them on every new caller.

**Explicitly OUT of Phase B:** codegraph substrate (Phase C), the memory bridge (Phase D), WRRF source weighting (Phase D), the `<70%-under-50ms` latency gate (Phase C — B only instruments). B does NOT flip any enforcement to `deny` (the B.5 enforcer defaults OFF and only ever warns).

---

## 1. Prerequisite state (verified 2026-06-02)

| Prereq | State | Anchor |
|---|---|---|
| Phase A substrate committed + green | ✅ | `cb9c14a`; emit-guard 4/4, build clean, bus suites 64/64 (intel-bus 12, session-bus-id 19, context-bus 33) |
| `readBus(busId?, opts?)` / `mutateBus(busId, fn, opts?)` + typed helpers | ✅ | `context-bus.ts` L348 / L453 / L634–672 (`setIntent`, `addFocusSymbol`, `addFileInPlay`, `addRecentFinding`) |
| `mutateBus` default path = single-lock atomic RMW | ✅ | `context-bus.ts` L486 `mutateViaLock` → `atomic-write.ts` `mutateStateWithLock` L172 |
| `acquireLockSync` accepts a `timeoutMs` (default 5000) | ✅ | `atomic-write.ts` L65; but `mutateStateWithLock` L176 calls it WITHOUT one → 5s busy-spin (B.4 fixes) |
| `appendIntelBus(event, opts?)` + 4 KB cap + newline-strip + fail-open | ✅ | `intel-bus.ts` L142 |
| intel-bus rotation / TTL / cleanup | ⬜ **absent** | B.4 adds (mitigation #5) |
| intel-bus secret-redaction / field allowlist | ⬜ **absent** (`[key: string]: unknown`, L83) | B.4 adds (mitigations #7/#12) |
| `bus_read_latency` instrument on reads | ✅ | `context-bus.ts` L364–366 (the write-side `wait_ms`/`write_ms` instrument is B.4) |
| Recall hooks to wire | ✅ | `agent-recall-injector.ts` (`handleAgentTask` L265, `buildAgentContext` L148); `memory-awareness.ts` (`main` L498, emit L602) |
| Bus-write host hook | ✅ | `post-edit-diagnostics.ts` PostToolUse `Edit\|Write` |
| PreToolUse `permissionDecision` precedent | ✅ | `no-haiku-enforcer.ts` (stdin→parse→`{}` allow / `permissionDecision:'deny'`) |
| `memory-sanitize` injection wrapper | ✅ | used in `memory-awareness.ts` L633–638 (`sanitizeMemoryContent`, `wrapMemoryContext`) — B.3 reuses on any bus-sourced string |
| `code-intel.mjs` / `code-intel/SKILL.md` / `code-intel-enforcer.ts` | ⬜ absent | this phase creates them |

---

## 2. Work breakdown (file-by-file, mitigations folded in)

Mitigation numbers reference the 12-row table in the master plan (`i-want-you-to-encapsulated-hare.md`).

### B.0 — Bus write-path hardening (`atomic-write.ts` + `context-bus.ts`) — **do first; B.4 depends on it**
The 200ms-cap / no-silent-drop mitigations (#2 + #3) live in the primitive, so they land before any populating hook uses them.

- **`atomic-write.ts`:** give `mutateStateWithLock` an options bag: `mutateStateWithLock(path, fn, { lockTimeoutMs?, onLockOutcome? })`. Thread `lockTimeoutMs` into `acquireLockSync(path, lockTimeoutMs)`. **Default stays 5000ms** so every existing caller (`writeStateWithLock` and friends) is byte-for-behavior unchanged — only the bus passes `200`. Report the lock outcome (`{ acquired: boolean, wait_ms }`) via `onLockOutcome` so the caller can tell a **lock-timeout drop** (alarm) from a **transient safe-abort** (fine) from a **legit no-op**. Instrument `atomicWriteSync` duration → `write_ms`.
- **`context-bus.ts`:** add an optional `lockTimeoutMs` to `BusOptions` (default **200** for the bus). In `mutateViaLock`, capture the lock outcome; if the lock **timed out** (not acquired within 200ms), emit a non-locking `bus_write_dropped` event to intel-bus (`{ query_type:'bus_write_dropped', reason:'lock_timeout', wait_ms }`) and return a result the caller can see as dropped — **never a silent `emptyBus`** (#3). Emit `mutateBus` timing (`wait_ms`/`write_ms`) on success too (#2).
- **Windows concurrent-write benchmark (#2):** a vitest/bench that fires N concurrent `mutateBus` calls and asserts (a) no lost update, (b) p95 total under the 200ms cap, (c) every dropped write produced exactly one `bus_write_dropped` row. This is the empirical proof the cap holds on NTFS + Defender.
- **Guard:** `context-bus.ts` is in the `audit-braintrust-emits.sh` surface set already (Phase A.4) — re-run after each edit.

### B.1 — `scripts/code-intel.mjs` (the facade CLI)
- **Model:** `scripts/cdp.mjs` — stateless Node CLI, `const cmd = process.argv[2]`, JSON-to-stdout via `out()/ok()/fail()` helpers, a `help()` commands map.
- **Typed subcommands, NOT loose regex (#10):** explicit verbs (`find-symbol`, `who-calls`, `code-context`, `flow`, `rename-preview`, `recall`, `bus`) each dispatched by exact match. Unknown/ambiguous verb → `fail()` with the supported list; **never guess a backend**.
- **Every response states the selected backend + routing reason (#10):** `{ success, backend:'codegraph'|'serena'|'tldr'|'ast-grep'|'archival_memory'|..., routing_reason:'<why>', escalated_from?, result:[...] }`. Routing follows the `code-intel-boundaries.md` table verbatim (codegraph broad-first → Serena precise; TLDR owns cfg/dfg/slice/dead; ast-grep owns AST find-replace; archival_memory owns "solved before?"). A multi-backend match emits a `clarify` response listing candidates — it does not silently pick one.
- **Bus-aware:** the facade READS the bus (`readBus`) to bias ranking (focus_symbols first) and appends one `intel-bus` event per call (`facade:'/code-intel'`, `specialist`, `query_type`, `result_count`, `duration_ms`, `correlation_id`). The facade does **not** write the L2 bus (single-writer rule §4 — only hooks write; the facade is invoked from the CLI, returns proposed updates, never `fs.writeFileSync` to the bus).

### B.2 — `.claude/skills/code-intel/SKILL.md`
Usage docs only (no behavior). When to reach for `/code-intel` vs raw Serena/TLDR/grep; the subcommand table; the routing/escalation contract; the kill switch. Cross-link `code-intel-boundaries.md`.

### B.3 — Bus-READ in the recall hooks (the activation)
Two readers, both **read-only on the bus** (writes stay in B.4 to keep the delicate file's edit surface minimal).

- **`agent-recall-injector.ts`:** after intent extraction (`extractIntent` ~L278) and before `recall(intent)` (L286), `readBus()` and pull `focus_symbols` (SCIP ids) + `files_in_play.load_bearing`. Use them to (a) bias the recall query and/or (b) add a "session focus" section to `buildAgentContext` (L148). Bus-sourced strings go through `memory-sanitize` (the same wrap used at L633 of memory-awareness) — bus content is untrusted (#prompt-injection 0.2 holds on the bus path; Phase A.5 already regression-tests this).
- **`memory-awareness.ts` (DELICATE — historical emit-regression victim):** insert the `readBus()` call in the **intent-build region (~L522–525)**, far from the emit at L602 and far from the inject at L625–648. Bias the recall query with `focus_symbols`; optionally inject a "session focus" line into `claudeContext` (L638), `memory-sanitize`-wrapped. **No whole-file Write; surgical Edit only; one agent at a time (G4); re-run `audit-braintrust-emits.sh` after every edit.**

- **Emit invariant (T1 + #6) — resolving the early-guard nuance (verified L498–654):** the 4 early guards (`CLAUDE_AGENT_ID` L504, short-prompt L510, slash L516, short-intent L528) `return` via `outputContinue()` **before any recall** and correctly do **not** emit. So the real invariant is **"every path that performs a recall emits exactly once,"** not "every `main()` path emits." Two-layer defense, NO risky refactor of the victim file:
  1. **Static (exists):** `audit-braintrust-emits.sh` asserts the literal `await emitBraintrustScore(` call-site is present — catches a regen that deletes it, at edit time.
  2. **Dynamic (new):** a vitest that (a) drives `main()` down a **recall path** with a mocked `emitBraintrustScore` and asserts it is called exactly once; (b) drives `main()` down **each early guard** and asserts emit is **not** called and `outputContinue` **is** — documenting the exemption so a future reader can't "fix" it into emitting on guards.
  - **Recommendation:** do **NOT** move the emit into a `finally` (a structural refactor of the regression-victim file carries more risk than it removes — the emit already runs on every recall path; the two guards above defend the actual failure mode, a regen dropping the call). The `finally`-refactor is offered as Q-B1 if you want literal structural positioning.

### B.4 — Bus-POPULATING hooks (extend existing; don't register N new ones — #4/T4)
Incremental, highest-signal-first. Each write uses the B.0-hardened `mutateBus` (200ms cap, no silent drop).

- **`edited` (+ `test_failed`) via `post-edit-diagnostics.ts`** (PostToolUse `Edit|Write`, confirmed has `file_path` + diagnostics in scope): after it emits its `additionalContext`, `mutateBus(addFileInPlay({path, role:'edited', turn_added}))`; if diagnostics show errors, also add `role:'test_failed'`. This is the cleanest, lowest-risk first write (one hook, structured exits).
- **`current_intent` / `user_mentioned`:** seeded once per turn. **Decision (Q-B2):** prefer a tiny dedicated UserPromptSubmit populator over adding a write to `memory-awareness.ts` (keep the victim file read-only on the bus). It also owns the **turn counter** (see staleness, below).
- **`grep_hit` / `read_for_context` — DEFERRED within B.4 (flagged, not silently dropped):** `grep_hit` needs a **PostToolUse:Grep** signal (the existing `smart-search-router` is **PreToolUse** → results aren't known yet; writing speculative hits is wrong). `read_for_context` needs a Read-tool signal. Both ship in a **B.4b** follow-on once `edited` proves the pattern, OR via one small PostToolUse hook — explicitly logged as scoped-out of B.4a so coverage isn't silently truncated (no-silent-caps discipline).

- **Bus staleness — "next-turn-only" (#4, verified architectural):** B.3 reads at **UserPromptSubmit**; B.4 writes at **PostToolUse** — so a read at turn N only ever sees writes from turn N-1 and earlier. The current turn's tool activity is invisible until the next prompt. Mitigation: a monotone **turn counter** (bumped once per UserPromptSubmit by the B.4 populator) stamps `turn_added` on writes; B.3 computes `source_age = current_turn - turn_added`, **suppresses** focus_symbols older than a threshold, and logs `source_age` + `stale_symbols_count` to intel-bus. (`FocusSymbol.turn_added` / `FileInPlay.turn_added` already exist in the v3 schema — Q-B3 confirms where the counter lives vs design §4.1.)

- **Telemetry allowlist + secret-redaction (#7/#12) — in `intel-bus.ts`:** B.4 events are built from an **explicit field set** (path, role, query_type, counts, ids, durations) — **never raw tool output or file content**. Add a central redaction pass in `appendIntelBus` (defense in depth for all callers): scrub secret patterns (`OPENAI_API_KEY`, `DATABASE_URL`, `sk-…`, `AKIA…`, generic `*_KEY=`/`*_TOKEN=`). **Test:** a `grep_hit`/`edited` event carrying a `.env`-shaped string lands in `intel-bus.jsonl` with the secret redacted; `OPENAI_API_KEY`/`DATABASE_URL` values never appear.

- **intel-bus lifecycle (#5/#1):** add **size-based rotation** (rotate `intel-bus.jsonl` → `.1` past N MB), **retention TTL** (drop rotated files older than X days), and **session-start cleanup** (a one-line call from an existing SessionStart hook). **Test:** 10k writes stay under the cap; rotation produces a valid tail; old rotations are pruned.

### B.5 — `code-intel-enforcer.ts` (PreToolUse) — **default OFF, never denies**
- **Model:** `no-haiku-enforcer.ts` (stdin→parse→`{}` allow / `hookSpecificOutput.permissionDecision`).
- **Default OFF (#7→enforcer / #8):** if `CCV3_FACADE_MODE` is unset → **always `{}` (allow)**. No env, no behavior. Test the unset path explicitly.
- **Never `deny` (#8):** even when enabled it only **warns** via `additionalContext` ("a `/code-intel` subcommand covers this; consider it") — it never returns `permissionDecision:'deny'`. Avoids the circular adoption gate (#9: you can't require the facade before it's proven).
- **Exact-route-match only (#9):** warn only when the intercepted call **exactly matches** a supported facade subcommand's domain (e.g. a structural ast-grep-able pattern) — not a fuzzy "looks like search." Test unset / enabled-warn / enabled-no-match / invalid-env (4 cases).
- **G6 cross-check:** before patching any surface, diff the warned routes against the P3 archive list so the enforcer never points at an archived skill.
- **Registration:** new PreToolUse entry in **active** `~/.claude/settings.json` via Node atomic read-modify-write (never the Edit tool — `windows-platform.md`), AND in repo `.claude/settings.json` (new-machine parity — state doc: registration changes hit BOTH). Matcher scoped to the tools it inspects (`Grep|Agent`), 5000ms timeout.

---

## 3. Gate checklist — Phase B "done" requires ALL

- [ ] B.0: `mutateStateWithLock` `lockTimeoutMs` threaded (default 5000 unchanged for existing callers; bus=200); lock-timeout → `bus_write_dropped` (never silent); `wait_ms`/`write_ms` instrumented; Windows concurrent-write bench green (no lost update, p95 < cap, 1 drop-row per dropped write)
- [ ] B.1: `code-intel.mjs` typed subcommands; every response carries `backend` + `routing_reason`; ambiguous → `clarify`; one intel-bus row per call
- [ ] B.2: SKILL.md documents routing + kill switch
- [ ] B.3: both recall hooks read the bus + bias recall; bus strings `memory-sanitize`-wrapped; **emit reachability vitest green** (recall path emits once; guards exempt); `audit-braintrust-emits.sh` 4/4 after every memory-awareness edit
- [ ] B.4: `edited`/`test_failed` written via post-edit-diagnostics; turn-counter staleness suppression + `source_age`/`stale_symbols_count` logged; secret-redaction test green (`OPENAI_API_KEY`/`DATABASE_URL` never in `intel-bus.jsonl`); rotation/TTL/cleanup + 10k-write test green; deferred roles (grep_hit/read_for_context) explicitly logged as scoped-out
- [ ] B.5: enforcer defaults OFF (unset→allow); never denies; exact-route-match warn-only; 4-case test; registered in BOTH settings.json
- [ ] Global: `CCV3_BUS_OFF=1` still no-ops every new caller; `npm run build` clean; `hook-manifest-check.mjs` OK; full vitest green; fresh-session smoke shows the bus populated by real `edited` writes AND read by recall, with zero added prompt latency
- [ ] **Quality gate (#12):** before/after recall eval run + within rollback thresholds (below) BEFORE B.3 is left enabled

---

## 4. Open design questions (flag for input; otherwise I take the Rec)

| # | Question | Recommendation |
|---|---|---|
| Q-B1 | Emit invariant: leave behavioral + add reachability vitest, or refactor into a `finally`? | **Leave behavioral + vitest + static guard.** A `finally` refactor of the regression-victim file adds more risk than it removes; the emit already runs on every recall path. |
| Q-B2 | Who seeds `current_intent`/turn-counter — a new tiny UPS hook or a write inside `memory-awareness.ts`? | **New tiny UPS populator.** Keeps the delicate file read-only on the bus (smaller blast radius). |
| Q-B3 | Turn counter — add `current_turn` to `BusEntry`, or reuse `compact_generation`/braintrust turn span? | **Add `current_turn` to BusEntry** (monotone, bumped once per UPS), reconciled against design §4.1 turn semantics. `turn_added` already exists on symbols/files. |
| Q-B4 | B.4 first slice = `edited` only, or `edited`+`grep_hit`+`read_for_context` together? | **`edited` (+`test_failed`) first**; grep_hit/read_for_context as B.4b after the pattern proves out. Lower risk, faster to a measurable signal. |
| Q-B5 | Build model | **kraken-TDD** per module (tests-first); main-context for the SKILL.md + settings registration + the eval harness. Per G4, never parallel-edit the same TS file. Cross-model `/review` before each commit. |
| Q-B6 | Redaction location — central in `appendIntelBus` or per-hook? | **Central** in `appendIntelBus` (every caller protected) + per-hook allowlist construction (no raw content reaches the appender). Defense in depth. |

---

## 5. Sequencing (each step: TDD → cross-model `/review` → commit)

1. **B.0** write-path hardening (`atomic-write.ts` opts + `context-bus.ts` 200ms cap + `bus_write_dropped` + Windows bench). Foundation for B.4.
2. **B.4 telemetry hardening** in `intel-bus.ts` (allowlist/redaction + rotation/TTL/cleanup + tests). Independent of consumers.
3. **B.1** `code-intel.mjs` + **B.2** SKILL.md (read-only facade; safe to land early; no hot-path touch).
4. **B.3** bus-read in `agent-recall-injector.ts` (less delicate of the two) + reachability test pattern.
5. **B.3** bus-read in `memory-awareness.ts` (DELICATE — surgical, emit-guard after, solo). 
6. **B.4a** `edited`/`test_failed` via post-edit-diagnostics + the turn-counter UPS populator + staleness suppression.
7. **Quality gate (#12):** run the before/after recall eval; decide enable vs roll back.
8. **B.5** enforcer (default OFF) + dual registration.
9. (Deferred) **B.4b** grep_hit/read_for_context if the eval shows the bus is earning its keep.

Estimated **2–3 days**. Stop-condition: after the B.3 quality gate, **re-measure before** committing to B.5/B.4b.

---

## 6. Risks & mitigations (the 12-row pre-mortem, mapped to steps)

| # | Risk | Sev | Step that lands the mitigation |
|---|------|-----|------|
| 1 | `memory-awareness.ts` emit dropped by a regen | HIGH | B.3 (reachability vitest + static guard + surgical/solo/G4) |
| 2 | Per-tool write latency (5s busy-spin) / uninstrumented | HIGH | B.0 (200ms cap + `wait_ms`/`write_ms` + Windows bench) |
| 3 | Silent dropped bus writes on lock timeout | HIGH | B.0 (`bus_write_dropped` + dropped flag, never silent `emptyBus`) |
| 4 | Bus read ≥1 turn stale | HIGH | B.4 (turn counter + `source_age` + stale suppression) |
| 5 | `intel-bus.jsonl` unbounded growth | HIGH | B.4 (rotation + TTL + session-start cleanup + 10k test) |
| 6 | `.codex/` over-broad deletion | HIGH | (Part 1 — done; surgical reg-only removal) |
| 7 | Telemetry secret leakage | MED | B.4 (central redaction + allowlist + secret test) |
| 8 | Enforcer denies when env unset | MED | B.5 (default OFF; unset→allow; 4-case test) |
| 9 | Enforcer noise + circular adoption gate | MED | B.5 (off by default; exact-route-match; warn-only) |
| 10 | Facade silent misroute | MED | B.1 (typed subcommands; backend+reason in every response; clarify on ambiguity) |
| 11 | "doc-only" commit hides a deletion | MED | (Part 1 — done; split commits) |
| 12 | No quality metric / rollback (adoption ≠ quality) | ELEPHANT | §8 rollback criteria + before/after eval before B.3 stays on |

**Paper tigers (Phase A settled):** busId traversal + CAS (fixed); multi-terminal contention (per-session `bus_id` → separate files, no shared lock).

---

## 7. Execution model

- **TDD** per module: failing test → implement → green → refactor.
- **Cross-model `/review` before each commit** (critic + plan-reviewer + codex-adversary; `[Codex]`-prefixed findings are the cross-model lift). Skip Codex only on a doc-only sub-commit.
- **memory-awareness.ts discipline:** surgical Edit (never whole-file Write), `audit-braintrust-emits.sh` after each edit, one agent at a time (G4).
- **Per-step commits** with explicit `-- <pathspec>`; `rm -f .git/index.lock && git commit -- <paths>` in one Bash call; don't parallelize a commit with an Agent call. Push target `fork` (Rev4nchist), never `origin`.
- **Edit repo files, not `~/.claude/`** (forward-sync is the only automatic direction). settings.json registration is the one exception that must hit BOTH active + repo.

---

## 8. Definition of done + rollback criteria (mitigation #12 — the elephant)

**Done:** the bus is **populated by real `edited` writes and read by recall**, behind the kill switch and fail-open, with the write path bounded (200ms, no silent drops), telemetry bounded (rotation) and safe (redacted), the facade routing transparently, and the enforcer inert-by-default. Build clean, emit-guard 4/4, full vitest green, fresh-session smoke clean with zero added prompt latency.

**Quality gate before B.3 stays enabled (adoption ≠ quality):**
- **Before:** fix a representative intent set; run recall **without** bus-bias; record mean top-score + hit-rate (the baseline).
- **After:** same set **with** bus-bias; record the same metrics + per-injection `source_age`, `injected`, `stale_symbols_count` from intel-bus.
- **Rollback thresholds (flip `CCV3_BUS_OFF=1` and re-measure if ANY trip):** recall hit-rate drops vs baseline; mean top-score regresses > ~10%; injected-stale rate exceeds a set fraction; any added prompt latency is observable; any `bus_write_dropped` storm under normal (non-stress) use.

Each subsequent phase (C/D) keeps its own telemetry gate; B does not commit to them.
