# CCv3 System Update — Orientation & Coordination Hub

> **Branch:** `snapshot/ccv3-system-update` · **Snapshot date:** 2026-06-27 · **Review SHA:** `86b8f60`
> This branch is a point-in-time **snapshot of the CCv3 state** plus a **coordinated work plan** so the next several sessions can finish the system-update against one detailed, accurate end goal — without re-deriving context each time.

## What this is

The Fable-5 deep review (June 2026) audited the entire Continuous Claude v3 system and produced **190 confirmed findings**, a ratified **4-tier backlog**, and an elegance verdict of **"mixed — clean spine, baroque edges."** Wave 0 (the 3 S0 critical fixes) shipped. This library is the durable hand-off surface for executing the rest of the backlog over multiple sessions.

**The end goal (do not drift from this):** converge CCv3 into an *elegantly working system* where **the design contract IS the running behavior** — a single-writer context bus, a lean hot-path, one canonical implementation of each cross-cutting concern (session-id, store-learning, recall-injection), behavior evidence-locked from real telemetry, and zero always-loaded docs asserting enforcement that never fires. This is **prune-and-rewire on a sound core**, not a rewrite.

## The library (read in this order)

| Doc | Purpose |
|-----|---------|
| **[CURRENT-STATE.md](./CURRENT-STATE.md)** | Where CCv3 is today — 6 pillars + WS-2 substrate, per-pillar health, the load-bearing defects, the elegance gaps. Start here to understand the system. |
| **[BACKLOG.md](./BACKLOG.md)** | THE execution plan — Wave 1 → Tier 2 → Tier 3 → Deletions, every item with finding IDs, action, dependencies, and gates. This is what the next sessions work through. |
| **[RESOURCE-MAP.md](./RESOURCE-MAP.md)** | Filesystem map + every artifact link (review report, findings.json, diagrams, the live deck, generators, key source files). "Where everything lives." |
| **[../HANDOFF-2026-06-27-ccv3-system-update.md](../HANDOFF-2026-06-27-ccv3-system-update.md)** | Session handoff — what shipped this session, exactly where we left off, the precise next action, and resume instructions. |

**Live visual companion:** the same content as interactive diagrams + a deep-technical briefing —
https://rev4nchist.github.io/ai-enablement-decks/ccv3-state-of-rework/

## How the multi-session work coordinates

1. **One source of truth for the plan:** [BACKLOG.md](./BACKLOG.md). Each session picks the next un-blocked item(s), respecting the sequencing gates. Do not jump a gate.
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

## Status at snapshot

- **Wave 0 — COMPLETE & pushed:** `QW-01` (`1788211`), `QW-02` (`89c9e5e`), `QW-03` (`f7f3eba`). 3/3 S0 closed.
- **Open:** 187 findings — Wave 1 (9 S1 QW), Tier 2 (10 ST arcs), Tier 3 (4 SG programs), 12 deletions.
- **Next action:** see [HANDOFF](../HANDOFF-2026-06-27-ccv3-system-update.md) → "Next area of work."
