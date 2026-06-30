# CCv3 System Update — Orientation & Coordination Hub

> **Branch:** `snapshot/ccv3-system-update` · **Review baseline:** `86b8f60` (2026-06-27) · **Current code state:** Session-2 foundation hardening, `dfaab16`+ (2026-06-29), pushed to `fork`.
> This branch is the CCv3 system-update workspace: a **coordinated work plan** plus the shipped remediation, so each session continues against one accurate end goal without re-deriving context. **The cycle is in its FINAL session — the canonical entry point is [`NEXT-SESSION-PLAN.md`](./NEXT-SESSION-PLAN.md).**

## What this is

The Fable-5 deep review (June 2026) audited the entire Continuous Claude v3 system and produced **190 confirmed findings**, a ratified **4-tier backlog**, and an elegance verdict of **"mixed — clean spine, baroque edges."** Wave 0 (the 3 S0 critical fixes) shipped. This library is the durable hand-off surface for executing the rest of the backlog over multiple sessions.

**The end goal (do not drift from this):** converge CCv3 into an *elegantly working system* where **the design contract IS the running behavior** — a single-writer context bus, a lean hot-path, one canonical implementation of each cross-cutting concern (session-id, store-learning, recall-injection), behavior evidence-locked from real telemetry, and zero always-loaded docs asserting enforcement that never fires. This is **prune-and-rewire on a sound core**, not a rewrite.

## The library (read in this order)

| Doc | Purpose |
|-----|---------|
| **[NEXT-SESSION-PLAN.md](./NEXT-SESSION-PLAN.md)** | **START HERE — the canonical handoff + live plan.** What shipped (Phases 0-3, ST-05 resident recall daemon, Session-2 foundation hardening), the FINAL-session checklist, and the precise next action. Supersedes all dated `HANDOFF-*` docs (archived under `docs/handoffs-archive/`). |
| **[BACKLOG.md](./BACKLOG.md)** | THE structural-arc execution plan — Tier 2 → Tier 3 → Deletions, every item with finding IDs, action, dependencies, and gates. The net-new work that remains after the FINAL session. |
| **[RESOURCE-MAP.md](./RESOURCE-MAP.md)** | Filesystem map + every artifact link (review report, findings.json, diagrams, the live deck, generators, key source files, the resident-recall-daemon foundation). "Where everything lives." |
| **[CURRENT-STATE.md](./CURRENT-STATE.md)** | **Dated snapshot (2026-06-27)** of the 6 pillars + WS-2 substrate — historical context for how the system looked at review time. See NEXT-SESSION-PLAN for what's changed since. |

**Live visual companion:** the same content as interactive diagrams + a deep-technical briefing —
https://rev4nchist.github.io/ai-enablement-decks/ccv3-state-of-rework/

## How the multi-session work coordinates

1. **One canonical entry per session:** [NEXT-SESSION-PLAN.md](./NEXT-SESSION-PLAN.md) (live handoff + plan). [BACKLOG.md](./BACKLOG.md) holds the structural-arc plan; each session picks the next un-blocked item(s), respecting the sequencing gates. Do not jump a gate.
2. **Sequencing is real, not advisory.** Prerequisites (e.g. `ST-02 → ST-01 → SG-04`) exist because doing them out of order produces unjoinable telemetry or re-exposes bugs. Each item lists its gate.
3. **Wave 1 first.** The 9 S1 quick-wins are mostly independent one-field/one-constant fixes. They unblock measurement and revive dead enforcement. `QW-04` (the Agent→Task matcher flip) goes **last in Wave 1** and is gated on Wave-0 `QW-01` having shipped (it has — `1788211`).
4. **Structural arcs (Tier 2) each get their own plan + premortem** before implementation. They are not quick-wins.
5. **Deletions are quarantine-first** (archive/disable, delete a session later) and require a per-item `git grep` static-reference check. Operator-confirm items wait for `SG-03`.
6. **Verify, don't trust.** This repo has a documented 80%-false-claim incident. Every "done" needs fresh evidence (test output, telemetry row, the hook actually firing). Read the cited lines before claiming a finding is fixed.

## Hard constraints (always)

- Push **`fork`** (Rev4nchist), never `origin` (parcadei) — for the `continuous-claude` repo.
- Never change the BGE model/dim (`BAAI/bge-large-en-v1.5`, 1024).
- Windows-safe commands only (array-arg spawns, drive-letter paths, no full-parallel vitest — it hangs).
- After any `.claude/hooks/src/*.ts` edit: rebuild (`cd .claude/hooks && npm run build`) and run `bash scripts/audit-braintrust-emits.sh` (must show `Found: 4 | Invariant: 4`).
- Run the **specific** test file, never the whole suite.
- This branch deliberately **excludes** the in-progress `feature/cma-integration` work (CMA + reporting skills). Keep it that way unless the user merges them.

## Status (current)

- **Wave 0 ✓** (3/3 S0) · **Wave 1 ✓** (S1 quick-wins) · **ST-05 ✓** (resident recall daemon — warm recall ~136 ms, was ~10 s) · **Session-2 foundation hardening ✓** (daemon multi-week resilience A1-A4, host-RAM degradation gate, three-layer auto-start, tldr-context-inject latency). All pushed to `fork`.
- **Remaining:** the FINAL-session loose ends (see [NEXT-SESSION-PLAN.md](./NEXT-SESSION-PLAN.md) → "▶ FINAL SESSION" + "Remaining for next session"), then the net-new Tier-2/3 structural arcs (ST-01 bus writer, ST-02 session-id, the MS multi-session arc, SG-02/03/04) which stay in [BACKLOG.md](./BACKLOG.md).
- **Next action:** [NEXT-SESSION-PLAN.md](./NEXT-SESSION-PLAN.md).
