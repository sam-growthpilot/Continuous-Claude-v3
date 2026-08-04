---
date: 2026-07-16
component: code-intel
component_name: Code Intelligence
verdict: watch
headline: Our embedding-free structural-graph + LSP-escalation design is exactly the 2026 convergent pattern; do NOT migrate to SCIP or add code-embeddings — finish the in-flight latency/freshness fixes (ST-04) and adopt one borrowed pattern (dirty-propagation to callers) for the edge-orphaning bug.
sources: 14
---

# Code Intelligence — Next-Evolution Proposal (2026-07-16)

## 1. Where CCv3 is today

CCv3's code-intelligence stack is a routing facade over specialized L3 backends, contracted in `.claude/rules/code-intel-boundaries.md`:

- **`/code-intel` facade** — `scripts/code-intel.mjs`, a stateless Node CLI that routes a query to the right specialist and degrades honestly when one is MCP-only or absent. It reads the context bus to bias ranking, appends one telemetry row per call to `.claude/logs/intel-bus.jsonl`, and never writes L2 (single-writer rule) — verified `scripts/code-intel.mjs:1-24`.
- **codegraph L3 (LIVE)** — `@colbymchenry/codegraph@0.9.9`, a tree-sitter → SQLite+FTS symbol graph with caller/callee edges. It is wired live in the facade via `process.execPath` + `npm-shim.js` with array args (Windows CVE-2024-27980 shim hardening), kill-switch order `CCV3_KILLSWITCH → CCV3_CODEGRAPH_OFF → binary-absent → TLDR fallback` — verified `scripts/code-intel.mjs:291-410`. (Note: the file's line-17 header comment still says codegraph is "ABSENT (Phase C)" — that is stale Phase-B documentation; the runtime code invokes codegraph. Worth a one-line fix.)
- **Serena L3** — LSP-backed MCP (`.serena/`), terminal authority on symbol identity / rename; the facade emits a `serena_hint` to escalate when codegraph callers come back empty or alias-prone.
- **TLDR L3** — AST-level cfg/dfg/slice/dead/diagnostics, shell-executable, and the fallback for who-calls/find-symbol/code-context when codegraph is off.
- **ast-grep** — structural search/rewrite (MCP-only; facade returns the exact guidance invocation).
- **archival memory (pgvector)** — "have we solved this before" semantic layer, scoped to cross-session *learnings*, not code retrieval.
- **context bus L2** — `.claude/hooks/src/shared/context-bus.ts`, single-writer atomic O_EXCL lock; specialists propose `focus_symbols`/`recent_findings` for a hook to commit.

**Known limitations** (from the Fable-5 review in `docs/system-update/CURRENT-STATE.md` and `docs/system-update/BACKLOG.md`, verified):

1. **Facade latency ~62s median** — one full codegraph process per dirty file, each paying a ~3-4s Node+WASM cold-start tax (`CURRENT-STATE.md:47`; `windows-platform.md` codegraph-Phase-C findings #2). Tracked as **ST-04** (`BACKLOG.md:64`) and gating the C.5 deny-flip.
2. **Cross-file caller-edge orphaning** — incremental `sync` content-hashes and skips unchanged caller files, so after a *callee-file* edit the inbound caller edge is orphaned and `who-calls` under-reports until an `index --force` (`CURRENT-STATE.md:48`; `windows-platform.md` finding #4). Mitigated only by a Serena-escalation hint.
3. **Context-bus symbol layer is write-dead** — `SubagentStop` has zero event registrations, so codegraph's `proposed_bus_updates` are silently dropped and `bus-focus.ts` reads always-empty `focus_symbols` (`CURRENT-STATE.md:12,46`). Tracked as **ST-01** (`BACKLOG.md:60`).
4. **In-facade routing 45.7% vs the ≥80% C.5 gate** — plus `tldr-cli.md` (always in context) still routes symbol search to TLDR, contradicting the boundary contract (`CURRENT-STATE.md:47`; `BACKLOG.md:109-116`).
5. **Freshness is on-demand, not watched** — one-shot CLI calls never start codegraph's daemon watcher; the facade runs a cheap git-status probe and syncs dirty files before querying (`code-intel-boundaries.md`, C.2 caveats).

## 2. Frontier scan

Research delegated to the `oracle` agent (25 sources); every claim below is either independently re-verified by me (WebFetch, marked ✓) or attributed to the research agent's secondary sources (marked as such). Post-cutoff arXiv IDs were verified directly.

**SCIP vs LSIF.** SCIP has effectively won the format question *inside the Sourcegraph ecosystem* — protobuf-typed, human-readable symbol IDs, ~4-5x smaller than LSIF, a reported 10x CI speedup replacing `lsif-node` with `scip-typescript` (✓ [Sourcegraph, "Announcing SCIP"](https://sourcegraph.com/blog/announcing-scip)). But it is an *interchange/serialization* format, not a retrieval architecture, and adoption outside Sourcegraph is uneven (GitLab still LSIF-native, per the research agent). SCIP is what you'd emit to interoperate with Sourcegraph — not a reason to change an already-working local SQLite+FTS graph.

**LSP-backed agents.** "MCP-wraps-an-LSP" is now a recognized category, not a novel design. Serena is the most mature general-purpose implementation — symbol-level retrieval/edit over 40+ languages via language servers (✓ [oraios/serena](https://github.com/oraios/serena)) — and a leaner generic pattern (`mcp-language-server`: proxy `gopls`/`rust-analyzer`/`pyright` and expose def/refs/rename/diagnostics as MCP tools) is common (research agent). A comparison of the local code-graph MCP field (codanna, ChunkHound, Serena, Gortex) frames them as *different index paradigms* — structural graph for cheap "who calls this", LSP for precise/terminal, semantic for recall — rather than one winner (research agent, [zzet.org comparison](https://zzet.org/gortex/local-code-graph-mcp-servers-compared/)).

**Semantic search / embeddings — the most load-bearing finding.** The 2026 signal is that pure-embedding retrieval is in retreat for *agentic* coding specifically, and hybrid (lexical + structural + optional semantic) is the consensus. Continue.dev deprecated its embeddings-based `@Codebase` provider "in favor of a more integrated approach to codebase awareness" (✓ [Continue.dev docs](https://docs.continue.dev/reference/deprecated-codebase)). Cursor still runs an embeddings pipeline but pairs it with Merkle-tree change detection for incremental reindex (research agent, [Cursor indexing docs](https://cursor.com/docs/context/codebase-indexing)). The widely-repeated claim that Claude Code's glob+grep beat internal RAG/vector experiments is **[Speculation]** — corroborated only by secondary blogs, no primary Anthropic source found.

**Repo-level reasoning.** Two camps. (a) *Ranked map + agentic grep*: Aider's repo map uses tree-sitter tag extraction → a dependency multigraph → **personalized PageRank** to fit the most relevant (file, identifier) set into a token budget (✓ [Aider repomap docs](https://aider.chat/docs/repomap.html)); Codex/Claude Code lean on file-convention context (AGENTS.md/CLAUDE.md) + agentic grep. (b) *Queryable persistent graph*: CodexGraph (NAACL 2025, graph-DB interface over the repo, [arXiv:2408.03910](https://arxiv.org/abs/2408.03910)), LocAgent (✓ verified [arXiv:2503.09089](https://arxiv.org/abs/2503.09089): directed heterogeneous graphs, up to 92.7% file-level localization, +12% Pass@10 downstream), and — most directly relevant — **"Code Isn't Memory: A Structural Codebase Index Inside a Coding Agent"** (✓ verified [arXiv:2606.22417](https://arxiv.org/abs/2606.22417), June 2026): a controlled within-harness ablation (index vs no-index vs agentic-grep comparator, Claude Opus 4.7 fixed, 3 seeds) finding "a large localization gain and a statistically separated resolve gain, with no cost penalty," and no regression vs the grep baseline. **Our codegraph is squarely in camp (b).**

**Incremental freshness.** File-level incremental hashing is solved and standard (Merkle trees / content hashing, ~4x over full reindex — research agent). But *correct cross-file edge invalidation on partial reindex* is named as a still-open industry failure class, not something our stack is uniquely bad at (research agent, [zzet.org code-knowledge-graph](https://zzet.org/gortex/code-knowledge-graph-for-llms/)). Two remediation patterns are described in the wild: **dirty-propagation** (when a callee signature changes, proactively mark downstream caller files for re-sync) and **stale-flagging overlay** (query results carry a live overlay marking known-stale/deleted entries).

**Symbol-precise + semantic combined.** No ratified protocol, but a convergent pattern across ≥3 independent implementations: BM25/FTS + graph edges + optional embeddings, fused via Reciprocal Rank Fusion with graph-centrality reranking (Gortex is a shipping example: [gortex.dev](https://gortex.dev/); its specific retrieval numbers are **[Speculation]** — not independently verified).

**Directly on our tool.** codegraph itself is independently analyzed: an architectural read confirms it is *deliberately embedding-free* (tree-sitter → SQLite+FTS5, no vector columns) as a design choice aligned with the hybrid-over-pure-embedding trend; and an independent Hono benchmark (~280 TS files) reproduces a −55% tool-call reduction but finds cost is roughly a wash (+6.8%, not the vendor's −35%) because each `codegraph_context` payload rides in the conversation cache and gets re-read every turn — a "steps saved ≠ dollars saved" crossover that only tips on repos larger than Hono (✓ verified [HarrisonSec Hono benchmark](https://harrisonsec.com/blog/i-tested-codegraph-on-hono-benchmark/); architecture piece: [HarrisonSec](https://harrisonsec.com/blog/codegraph-architecture-first-principles-llm-retrieval/)).

## 3. Gap analysis

| Dimension | CCv3 vs frontier | Evidence |
|---|---|---|
| **Core architecture** (embedding-free structural graph + LSP escalation) | **Even / ahead of curve** — this is the convergent 2026 pattern, independently validated | codegraph design (`code-intel-boundaries.md`); "Code Isn't Memory" ✓; Continue.dev deprecation ✓ |
| **Repo-level graph capability** | **Even** — we ship the camp-(b) queryable graph as a real backend | CodexGraph/LocAgent research vs `scripts/code-intel.mjs` |
| **Cold-start / per-call latency** | **Behind** — ~62s median, one process per dirty file; frontier uses warm daemons/process pools | `CURRENT-STATE.md:47`; Cursor Merkle+persistent index |
| **Cross-file edge freshness** | **Behind, but so is everyone** — our `index --force` is the blunt version of the dirty-propagation pattern | `windows-platform.md` finding #4; zzet.org staleness class |
| **Symbol bus wiring** | **Behind on execution** — codegraph *computes* proposed updates but they are dropped (write-dead) | `CURRENT-STATE.md:12,46` (ST-01) |
| **Routing enforcement** | **Behind** — 45.7% in-facade vs 80% gate; a context doc contradicts the contract | `CURRENT-STATE.md:47`; C.5 gate |
| **Per-call payload cost awareness** | **Blind spot** — we track latency, not the cached-payload cost the Hono benchmark exposed | HarrisonSec Hono ✓; no payload-size telemetry in `intel-bus.jsonl` |
| **Code embeddings for retrieval** | **Correctly absent** — the frontier is retreating from this for agentic tasks | Continue.dev ✓; codegraph embedding-free-by-design |
| **SCIP interchange** | **Absent, correctly** — no Sourcegraph-interop need | Sourcegraph SCIP ✓ |

**Net:** our *design* is aligned-to-ahead; our *execution* is behind on latency, freshness precision, and bus wiring — all of which are already in `BACKLOG.md`. The frontier does not ask us to add a new capability; it validates the architecture and points at cheaper fixes for the two named pain points.

## 4. Recommendations

**ADOPT — warm codegraph process, not one-shot-per-file (ties ST-04).** The ~3-4s tax is Node+WASM *startup*, not query work (`windows-platform.md` finding #2), so the correct lever is a warm process/daemon or a short-lived process pool reused across a facade invocation's dirty files — exactly the pattern Cursor and the local-graph MCP tools use. This is the frontier-sourced framing of the existing ST-04 latency fix, not a new arc. Rationale: turns the 62s median into the sub-second query cost codegraph actually achieves warm.

**ADOPT — dirty-propagation to callers for edge orphaning (small, new).** Instead of relying only on the facade's git-status probe (which never marks the *unchanged* caller file dirty), have the freshness step, when it detects a changed *callee* file, also re-sync the files that previously had edges into it. This is a documented industry pattern, strictly better than the blunt periodic `index --force`, and directly attacks pain point #2. Rationale: makes `who-calls` trustworthy without a full reindex or a Serena round-trip on every empty result.

**ADOPT (cheap doc/telemetry) — payload-cost awareness.** The Hono benchmark shows per-call graph-context payload size drives real cost as much as latency. Add a `payload_bytes` field to the `intel-bus.jsonl` row so the C.5 metrics reflect cost, not just routing rate; fix the stale line-17 header comment and the `tldr-cli.md` contract contradiction (D1A-003) already in the C.5 gate. Rationale: closes a measurement blind spot cheaply and unblocks an honest cost/benefit read of codegraph on *our* repo size.

**WATCH — hybrid RRF fusion (BM25 + graph + optional embeddings) as one ranked retriever.** Gortex/RANGER/LARGER converge on this. We already do lexical (TLDR/FTS) + structural (codegraph) + LSP escalation, just *routed* rather than *fused*. A single fused ranker could beat routing on ambiguous queries — but only worth it after ST-04/ST-01 land and only if a benchmark on our own repo shows lift. Track, don't build yet.

**WATCH — "Code Isn't Memory" style within-harness ablation.** When ST-04 makes the facade fast enough to run at scale, an index-vs-no-index-vs-grep ablation on our own repo (fixed model, seeds) would give evidence-grade justification for the C.5 deny-flip. The method is now published and reproducible.

**SKIP — migrate codegraph's store to SCIP.** SCIP solves Sourcegraph interop, not retrieval; we have no interop need, and our SQLite+FTS design is where the ecosystem actually is. Cost with no benefit.

**SKIP — add code-embedding search to the facade.** The dominant 2026 signal (Continue.dev deprecation ✓, codegraph's embedding-free-by-design, the grep-over-RAG trend) is that pure semantic code retrieval underperforms lexical+structural for agentic tasks. Keep pgvector scoped to cross-session *learnings* (archival memory), not code retrieval, unless a benchmark proves lift.

## 5. Integration approach

| Item | Files / subsystems | BACKLOG tie | Effort | Risk / what could go wrong |
|---|---|---|---|---|
| Warm codegraph process | `scripts/code-intel.mjs` (`runCodegraph`, `resolveCodegraphBin`); a small persistent-process helper; `windows-platform.md` contract | **ST-04** (before C.5 flip) | M | Windows: the tldr daemon already "won't stay resident on Windows" (`NEXT-SESSION-PLAN.md`); a codegraph daemon may hit the same wall → fall back to a per-invocation process pool (reuse one process across a call's dirty files) rather than a long-lived daemon. WAL concurrency already proven safe (C.1 finding). |
| Dirty-propagation to callers | facade freshness probe in `scripts/code-intel.mjs`; codegraph `callers` edges | new, under **ST-04**/C.2 caveats | S–M | Over-invalidation → re-sync cost creeps toward `index --force`; bound it to files with a prior edge into the changed callee. Keep the Serena-escalation hint as the backstop, not the primary fix. |
| Payload-cost telemetry + doc fixes | `intel-bus.jsonl` writer in `scripts/code-intel.mjs`; `code-intel.mjs:17` comment; `tldr-cli.md` | **C.5 gate** (item 1 + 3) | S | Low. Purely additive telemetry + doc correction; no behavior change. |
| Within-harness ablation (later) | a bench harness over `scripts/code-intel.mjs`; fixed model | **WATCH**, gated on ST-04 | M | Only meaningful once latency is fixed; premature runs measure startup tax, not index value. |

Sequencing: **ST-01 (bus writer) and ST-04 (latency) are the unlock** — both already in `BACKLOG.md`. Dirty-propagation and payload telemetry ride inside ST-04. The fused-retriever and ablation are explicitly deferred behind them. Nothing here is a rewrite; it is "finish the in-flight fixes, borrow one pattern, add one telemetry field."

## 6. Benefits

- **Faster (the user-visible):** warm codegraph turns the 62s facade median toward codegraph's real ~sub-second warm query — "who calls X" / "find symbol X" stop feeling like a stall, which also raises in-facade routing toward the 80% C.5 gate (agents avoid a slow tool).
- **More reliable:** dirty-propagation makes `who-calls` correct after a callee edit without a manual `index --force`, removing a silent-under-report failure mode that currently needs a Serena escalation to catch.
- **Cheaper / honest cost:** payload-size telemetry lets us see codegraph's true cost/benefit on our repo (the Hono benchmark's "steps ≠ dollars" crossover), so the C.5 deny-flip decision is evidence-based rather than routing-rate-only.
- **Confidence to stand pat:** the strongest benefit is *not* building the wrong thing. This scan is evidence that our embedding-free structural-graph + LSP-escalation design is the convergent 2026 pattern — so we spend effort finishing ST-01/ST-04, not chasing a SCIP migration or a code-embedding index that the frontier is actively retreating from.

## 7. Open questions

- **Will a warm codegraph process stay resident on Windows?** The tldr daemon does not (`NEXT-SESSION-PLAN.md`); if codegraph hits the same wall, a per-invocation process pool is the fallback. Needs a spike before committing ST-04 to a daemon design.
- **Does codegraph earn its keep on continuous-claude's repo size?** The Hono (~280 files) benchmark shows cost is a wash below a size threshold; the payload-telemetry item is the cheapest way to answer this for our repo before the C.5 deny-flip.
- **Unverified frontier specifics (do not build on without a check):** Gortex's retrieval numbers, the Sourcegraph Cody "dropped embeddings" pivot, and the Anthropic-internal "grep beat RAG" claim are all secondary-source / [Speculation] — corroborated in aggregate but not primary-verified. The *direction* is well-supported; specific figures are not.
- **Is a fused RRF ranker worth it over routing?** Only a benchmark on our own repo (post-ST-04) answers this; no a-priori reason to expect lift over the current routed design for our query mix.
