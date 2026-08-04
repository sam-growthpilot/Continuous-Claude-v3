---
date: 2026-07-10
component: coordination
component_name: Cross-Session Coordination
verdict: adopt
headline: The frontier answers "concurrent multi-agent edits" by never sharing a checkout (worktree/container isolation) — a first-party primitive CCv3 already has (`isolation: worktree`) but does not use for fan-out; so make isolation the PRIMARY answer to the intra-session gap, scope the Postgres `file_claims` lock to the genuinely-shared cross-session case, and harden it against the Kleppmann TTL-without-fencing anti-pattern it currently embodies.
sources: 12
---

# Cross-Session Coordination — Next-Evolution Proposal (2026-07-10)

Scope note: this proposal covers the **coordination substrate** — session identity, the Postgres `sessions`/`file_claims` locking layer, and intra-session fan-out safety. It leans on the already-detailed internal plan (ST-02 identity, the MS-01/02/03 arc, SG-04 peer-awareness in [`BACKLOG.md`](../system-update/BACKLOG.md)) and asks one question the frontier scan reframes: *is database-mediated locking of a shared checkout the right mechanism at all, or should isolation carry more of the load?*

## 1. Where CCv3 is today

Two Postgres tables plus a file-persisted session id, wired through hooks:

- **Session identity** — `getSessionId()` resolves `COORDINATION_SESSION_ID` env → `~/.claude/.coordination-session-id` file → `BRAINTRUST_SPAN_ID[:8]` → `s-<timestamp36>` (`.claude/hooks/src/shared/session-id.ts:93-112`, `:45-51`). Identity is **session-scoped only** — there is no subagent-level id.
- **Heartbeat / liveness** — `registerSession()` upserts `(id, project, working_on, last_heartbeat)` and `isSessionActive()` treats a session as live if `last_heartbeat` is within a **5-minute wall-clock** window (`.claude/hooks/src/shared/db-utils-pg.ts:390-425`, `:527-560`; threshold `STALE_THRESHOLD_MS = 5*60*1000` at `.claude/hooks/src/file-claims.ts:18`).
- **File locking** — the `PreToolUse:Edit|Write` hook `file-claims.ts` reads the claim, and if another session holds it AND that session is active, it **hard-denies** the edit; if the holder is stale it **takes over**; otherwise it claims (`file-claims.ts:53-95`). The claim itself is `INSERT … ON CONFLICT (file_path, project) DO UPDATE` — an **unconditional overwrite** with no version guard (`db-utils-pg.ts:662-695`). `checkFileClaim` filters `session_id != my_session` (`db-utils-pg.ts:623-626`).
- **Rule/contract** — `.claude/rules/cross-terminal-db.md` documents the connection, the `(file_path, project)` composite key, and the project-scoping requirement.

The internal review already named the gaps precisely (`docs/system-update/CURRENT-STATE.md:15-23`): identity is a **7-implementation split-brain** (60.7% corr-null telemetry) gated on **ST-02**; the lock is **blind to intra-session fan-out** because subagents inherit the parent `session_id`; and **sync + git writes bypass** the Edit/Write-tool lock entirely. The MS arc (`BACKLOG.md:74-86`) plans a hybrid posture: hard-block infra, warn project files, serialize git/build.

**Verified structural weaknesses (beyond what the review lists):**
1. **TOCTOU race.** The sequence check-claim → `isSessionActive` → `claimFile` (`file-claims.ts:53-91`) is three separate DB round-trips with no atomicity. Two sessions can both read "no active claim" and both write; `ON CONFLICT DO UPDATE` makes the last writer win silently (`db-utils-pg.ts:682-684`). There is no compare-and-swap.
2. **No fencing token, and staleness is inferred from the session, not the claim.** A claim row has only `claimed_at`; liveness is judged by the *holder session's* heartbeat, so a claim can be reaped while its holder is merely paused (laptop sleep, a long tool call, a debugger breakpoint) and then that holder resumes and writes — with nothing to detect the permission is void.

## 2. Frontier scan (mid-2025 → mid-2026)

**The industry answer is isolation, not locking.** Every major shipped tool sidesteps shared-checkout conflict detection by giving each agent its own filesystem view and merging at the git layer:

- **Claude Code native worktrees** — `isolation: worktree` per subagent, temp worktree auto-removed when done ([code.claude.com/docs/en/worktrees](https://code.claude.com/docs/en/worktrees)). This is a **first-party primitive already exposed in this very harness**: the `Agent` tool documents `isolation: "worktree"` and the `Workflow` tool documents `opts.isolation: 'worktree'` ("each gets its own working tree + index").
- **Dagger container-use** — each agent gets its own Docker container **and** git branch (env + deps + network isolation, not just a worktree); review any agent's work via `git checkout` ([github.com/dagger/container-use](https://github.com/dagger/container-use), verified).
- **claude-squad** — tmux + git-worktree per agent instance across Claude Code/Codex/Aider ([github.com/smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad), verified). The write-ups note the failure modes these tools avoid are exactly ours: agents "overwrite each other's files … and compete for `.git/index.lock`."
- **Cursor parallel agents** — documents the *absence* of locking: prompt-level "directory ownership" only, with the explicit caveat that two agents writing the same file produce "a merge conflict that neither of them knows about" ([dev.to writeup](https://dev.to/thegdsks/cursor-3-ships-parallel-ai-agents-here-is-the-multi-agent-workflow-that-actually-works-2bk8), oracle-sourced).

**Distributed-lock correctness (the classic literature applies directly):**
- **Kleppmann, "How to do distributed locking"** — a lease/TTL lock is unsafe under process pauses/GC/clock skew: a client can believe it holds a lock after the lease expired and still write. The fix is a **fencing token** — "a number that increases … every time a client acquires the lock," submitted with every write, and **the storage server rejects a write whose token is lower than one it already processed** ([martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html), quotes verified). A 5-minute wall-clock staleness check with no fencing token is precisely this anti-pattern.
- **Jepsen: etcd** — empirically, lease-based locks are not a mutual-exclusion *guarantee* under adverse timing; correctness needs lease + active heartbeat renewal + a fencing/ordering mechanism, not a bare timestamp compare ([jepsen.io/analyses/etcd-3.4.3](https://jepsen.io/analyses/etcd-3.4.3), oracle-sourced, cited for the general conclusion).

**Agent identity / provenance is standardizing:**
- **OpenTelemetry GenAI semantic conventions** define `gen_ai.agent.id` (plus `.name`/`.version`) as the emerging standard for "which agent, not just which session" ([opentelemetry.io/…/gen-ai](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/), verified; status: in Development, opt-in via `OTEL_SEMCONV_STABILITY_OPT_IN`). Our session id is roughly `gen_ai.agent.id` at *session* granularity with **no subagent equivalent** — the fan-out gap, restated in standards terms.
- Git-trailer provenance is converging on **`Assisted-by:`** (separate from human-accountable `Signed-off-by`/`Co-authored-by`) ([allthingsopen.org](https://allthingsopen.org/articles/open-source-ai-contributions-assisted-by-git-trailer-standard), oracle-sourced).

**In-process shared-workspace coordination (research-grade, NOT production-proven):**
- **STORM — "Multi-agent Collaboration with State Management"** — mediates agent interactions with a shared workspace to detect/resolve conflicts at write time, rather than isolating; +18.7 on Commit0-Lite and +1.4 on PaperBench over a git-worktree baseline ([arXiv:2605.20563](https://arxiv.org/abs/2605.20563), abstract verified). *(Note: the abstract describes "state management," not version-number OCC specifically — I do not attribute a particular OCC mechanism to it.)*
- **MPAC — "Multi-Principal Agent Coordination Protocol"** — makes **intent declaration a precondition for action**, represents conflicts as first-class structured objects, and applies **optimistic concurrency control on shared state**; explicitly targets "multiple engineers' coding agents modifying the same repository" ([arXiv:2604.09744](https://arxiv.org/abs/2604.09744), abstract verified).
- **CodeCRDT — "Observation-Driven Coordination for Multi-Agent LLM Code Generation"** — CRDT-based lock-free coordination; **100% convergence, zero merge failures**, but a **5–10% semantic-conflict rate** (convergent yet logically wrong) and **21.1% speedup on some tasks / 39.4% slowdown on others** ([arXiv:2510.18893](https://arxiv.org/abs/2510.18893), abstract verified). The quantified "convergent ≠ correct" caveat is the key caution against treating optimistic/CRDT merge as free.

[Speculation] None of STORM/MPAC/CodeCRDT appears adopted in a shipped tool as of this scan; treat as design inspiration, not consensus.

## 3. Gap analysis

| Dimension | Frontier | CCv3 | Standing |
|-----------|----------|------|----------|
| Concurrent-edit strategy | Isolation (never share a checkout) | Pessimistic DB lock **on a shared checkout** | **Architectural fork** — we solve a problem the field designs away |
| Intra-session fan-out | worktree/container **per subagent** | Invisible (`session_id != my_session` filter + shared parent id) | **Behind** — but we already own the primitive (`isolation: worktree`) |
| Lock safety | lease + heartbeat + **fencing token**; atomic acquire | 5-min wall-clock TTL, **no fencing**, TOCTOU race, unconditional overwrite | **Behind** — textbook anti-pattern |
| Agent identity | `gen_ai.agent.id` per agent | session-only, 7-way split | **Behind** — ST-02 already targets this |
| Provenance | `Assisted-by:` trailer standard | none | Behind (low stakes) |
| Cross-session peer awareness | live TUI dashboards (claude-squad) | none (planned SG-04) | Behind (planned) |

The sharpest finding: **the intra-session fan-out gap and the cross-session lock are two different problems that CCv3 currently tries to solve with one mechanism.** Fan-out (one orchestrator, N subagents) is best solved by *isolation*, which we already have. The cross-session case (two human-driven terminals genuinely sharing one working tree) is the *only* place a shared-checkout lock is unavoidable — and that's where the fencing/atomicity hardening should concentrate, not on extending `file_claims` to per-subagent granularity.

## 4. Recommendations

**R1 — ADOPT (reframe MS-01): route intra-session fan-out through `isolation: worktree`, don't extend the lock to `agent_id`.**
The frontier convergence plus the fact that this harness *already exposes* `isolation: worktree` on both the `Agent` and `Workflow` tools makes worktree-per-subagent the lower-effort, more robust answer to the fan-out gap than adding an `agent_id` column to `file_claims` and a same-session collision warner. `.claude/rules/proactive-delegation.md` already recommends `isolation: "worktree"` for parallel agents that commit; this promotes that from ad-hoc advice to the **default coordination mechanism for parallel writers**. MS-01's *goal* (fan-out safety) is kept; its *mechanism* changes from "extend the lock" to "isolate then merge." Rationale: isolation is conflict-free by construction; the CodeCRDT/CRDT alternatives show even sophisticated shared-state merge leaks 5–10% semantic conflicts ([arXiv:2510.18893](https://arxiv.org/abs/2510.18893)).

**R2 — ADOPT (harden the residual cross-session lock): atomic claim + claim-level lease + fencing counter.** For the genuinely-shared-checkout case that remains:
- Make claim acquisition a **single atomic conditional write** (one `INSERT … ON CONFLICT … WHERE holder is stale` or a `SELECT … FOR UPDATE` transaction), closing the TOCTOU race in `file-claims.ts:53-91`.
- Give the **claim** its own lease (`expires_at` / renewed-on-heartbeat) so liveness is a property of the claim, not inferred from a separate session row.
- Add a **monotonic fencing counter** per `(file_path, project)`, recorded on each grant. Honesty caveat: the hook cannot make the *filesystem* reject a stale-token write the way Kleppmann's storage server does — so the counter's realistic value is **detection + telemetry** (flag a write whose token is below the current max as a probable stale-holder incident), not hard enforcement. That is still a strict improvement over the current silent last-writer-wins.
Rationale: [martin.kleppmann.com](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) + [jepsen.io/analyses/etcd-3.4.3](https://jepsen.io/analyses/etcd-3.4.3). Small, well-scoped schema + query change.

**R3 — ADOPT / endorse ST-02 as written, and align its `agent_id` with `gen_ai.agent.id`.** The two-level identity (`session_id` + `agent_id`) already planned in ST-02/`BACKLOG.md:59` is the right foundation; name and shape `agent_id` to match the OTel `gen_ai.agent.id` attribute so coordination and observability share one identity ([opentelemetry.io](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)). This unblocks joinable telemetry (the 60.7% corr-null, `CURRENT-STATE.md:13`) *and* SG-04 peer-awareness with no extra identity scheme.

**R4 — WATCH: OCC / intent-declaration / CRDT in-process coordination.** STORM, MPAC, and CodeCRDT are credible but academic. The one idea worth pulling forward *cheaply* is **MPAC's "intent declaration before action"** ([arXiv:2604.09744](https://arxiv.org/abs/2604.09744)) as the shape for the MS-01 WARN surface and SG-04 peer-awareness: a fanned-out agent (or a second terminal) declares intended files up front, and collisions surface as structured warnings before the write. Full OCC/CRDT shared-state merge stays WATCH — CodeCRDT's 5–10% convergent-but-wrong rate is a strong reason not to trust automatic merge for code.

**R5 — WATCH (low stakes): `Assisted-by:` commit trailer** for agent provenance, once `agent_id` exists. Cheap, standards-aligned, but no urgent pain today — park it behind R2/R3.

**SKIP:** building a bespoke CRDT/operational-transform layer for shared-checkout editing. The isolation path (R1) makes it unnecessary and the research shows it does not guarantee semantic correctness.

## 5. Integration approach

- **R1** — `.claude/rules/proactive-delegation.md` (elevate `isolation: worktree` to the default for parallel writers) + the orchestrator prose in the Ralph/maestro skills. Reframes **MS-01** (`BACKLOG.md:82`): keep the goal, swap the mechanism; drops the need for an `agent_id` column on `file_claims`. Effort: **low** (doc/convention + orchestrator wiring). Risk: low; worktree setup cost (~200–500ms/agent, per the `Agent` tool's own note) — use only for genuinely parallel writers, not every subagent.
- **R2** — `db-utils-pg.ts` (`claimFile`/`checkFileClaim` → one atomic conditional statement; add `expires_at` + `fence_seq` columns) and `file-claims.ts` (consume the atomic result; emit a Braintrust incident when a sub-max token is seen). Feeds **MS-02/MS-03** (`BACKLOG.md:83-84`) — the same atomic-lease primitive backs the git/build serialize mutex. Effort: **medium**. Risk: medium — schema migration on a live coordination table; must stay fail-open (a lock bug must never brick Edit/Write, matching the current silent-continue on DB failure at `file-claims.ts:31-33`).
- **R3** — `session-id.ts` (the ST-02 consolidation already scoped) + `getBusId()` composer; name `agent_id` per OTel. Prerequisite for R1's collision-warn variant and for SG-04. Effort: **medium** (mostly the already-planned 7→1 consolidation). Risk: medium (touches every coordination + telemetry consumer).
- **R4/R5** — additive later; the intent-declaration surface rides on R3's `agent_id` and R2's claim table.

Sequence unchanged from the internal plan: **ST-02 (R3) first**, then **R2** (hardening) and **R1** (reframe) in parallel, with MS-02 (infra hard-block) still shipping first for blast-radius reasons (`BACKLOG.md:83`). R4/R5 follow.

## 6. Benefits

- **Safe parallel fan-out, immediately.** R1 lets an orchestrator run N writer-subagents concurrently with zero clobber risk using a primitive already in the harness — no new locking code, no `.git/index.lock` races (the exact failure the frontier tools cite).
- **Correct multi-terminal work.** R2 removes the two silent-corruption paths: the TOCTOU double-claim and the paused-holder stale-steal. the user can run two terminals on one checkout and trust the lock instead of manually avoiding overlap.
- **Measurable coordination.** R3 makes cross-session/agent telemetry joinable (kills the 60.7% corr-null) and unlocks the SG-04 peer-awareness surface ("Session B is editing `foo.ts`, 2m ago").
- **Right-sized effort.** The reframe means we build *less* — isolation replaces a chunk of would-be locking code, and the remaining lock gets smaller and safer, not bigger.

## 7. Open questions

1. **Do two human terminals on one shared working tree actually happen often enough** to justify R2, or is the real world almost always "one terminal + isolated subagents" (fully solved by R1)? Worth measuring active-session overlap before investing in fencing.
2. **Fencing without an enforcing resource** — is detection-only telemetry (R2 caveat) enough, or should high-value infra writes route through a real gate (a lock server / advisory lock the write path *must* pass)? Ties to MS-02's hard-block set.
3. **Worktree cost at scale** — at what fan-out width does per-subagent worktree setup (~200–500ms each) outweigh the isolation benefit vs. task-partitioning on a shared tree?
4. **Sync + git bypass** (`CURRENT-STATE.md:21`) is orthogonal to both isolation and the lock — MS-02/MS-03 still needed regardless; neither R1 nor R2 closes the non-Edit/Write write paths.
