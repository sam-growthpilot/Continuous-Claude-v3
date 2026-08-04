---
date: 2026-07-09
component: learning-loop
component_name: Self-Improvement / Learning Extraction
verdict: adopt
headline: CCv3's write path stores raw regex-matched thinking blocks verbatim through a keyword-only gate — while both the frontier AND the very Claude Code harness it now runs on distill lessons with an LLM before storing; adopt LLM distillation + kill the periodic-extract noise generator + reconcile with native Auto memory, and defer consolidation/decay to the already-open 2026-06-30 memory arc.
sources: 12
---

# Self-Improvement / Learning Extraction — Next-Evolution Proposal (2026-07-09)

Scope note: this proposal covers the **write/extraction** side of memory (how learnings are captured, distilled, and quality-gated). The **read/retrieval** side (reranker, usefulness metric, consolidation) was covered on 2026-06-30 ([`proposals/2026-06-30-memory.md`](2026-06-30-memory.md)). Where the two overlap (consolidation, contradiction-invalidation) this proposal **defers** to that arc's R4/R5 rather than duplicating them.

## 1. Where CCv3 is today

The "multi-layer learning capture" is four triggers feeding one Python extractor:

- **L0 / pre-compact** — `.claude/hooks/src/pre-compact-extract.ts` fires on `PreCompact`, launches `incremental_extract.py` detached with a 5-min cooldown (`pre-compact-extract.ts:141-163`).
- **L2 / session-end** — `.claude/hooks/src/session-end-extract.ts` fires on `SessionEnd` if the session has ≥10 turns, runs the same extractor with dedup from the last extracted line (`session-end-extract.ts:33,76-107`).
- **Periodic / mid-session** — `.claude/hooks/src/periodic-extract.ts` fires every 50 tool uses (`periodic-extract.ts:29,95-97`).
- **L3 / manual** — the `extract-v2`, `memory-curate`, and `remember` skills.

The actual extraction (`opc/scripts/core/incremental_extract.py`) is **entirely heuristic**:

1. **Regex perception-signal matching** on thinking blocks — 18 hand-written patterns ("I realize that", "the root cause is", "this didn't work", etc.) (`incremental_extract.py:62-89`).
2. **A keyword quality gate** — `score_extraction()` starts at 5, adds points for error-fix keyword pairs / decision words / tech terms / ≥2 file-path references, subtracts for short/generic/repetitive text, then classifies `SIGNAL ≥5 / BORDERLINE 3-4 / NOISE <3` and drops NOISE (`incremental_extract.py:149-192,555-577`). This is the "L0 quality gate" — regex keyword counting, **no LLM**.
3. **Verbatim storage** — a passing thinking block is stored **as-is, truncated to 2000 chars**, with a regex-inferred type and `confidence="medium"` (`incremental_extract.py:403-411`). There is no summarization step: the stored "learning" is the raw internal monologue, not a distilled lesson.

Storage is Postgres + pgvector (BGE-large 1024-dim, hybrid RRF), dedup is a fixed 0.85 cosine cut at write time, and there are 7 enforced learning types (`.claude/skills/memory/SKILL.md`).

**Known limitations (verified):**
- **The periodic hook is a noise generator.** Every 50th tool use it stores an `OPEN_THREAD` reading `"Mid-session checkpoint at N tool uses. Recent activity: Bash(3), Read(2)…"`, `confidence=low`, `tags=periodic,extraction` (`periodic-extract.ts:125-128,190-204`). CCv3's *own* curation rubric scores exactly this pattern **-2 (periodic+extraction) and -1 (checkpoint) → ARCHIVE** (`.claude/skills/memory-curate/references/scoring-rubric.md:20-21`), and the extractor's own `NOISE_REPETITION` regex targets the words "checkpoint/periodic/heartbeat" (`incremental_extract.py:138-142`). The system spends writes producing content it is separately built to filter and archive.
- **Verbatim thinking ≠ a lesson.** Storing raw 2000-char monologue is low-signal-density; a future session recalling it re-reads reasoning, not a crisp takeaway.
- **Static global gate.** The score-<3 cut is one fixed threshold with no per-domain adaptivity and no feedback from whether stored learnings ever helped.
- **Corpus health.** Hit rate is **27.4%** (281 events) and **24.6% of recall queries were `<task-notification>` XML blobs** at review time (`docs/system-update/CURRENT-STATE.md`, being fixed by `QW-07`). No re-consolidation after write (the 2026-06-30 arc, R4).

## 2. Frontier scan

**Reflection lineage (distill outcomes into text, don't store raw).** Reflexion converts task feedback into *verbal self-reflection stored in an episodic buffer* and replays it next trial — 91% pass@1 on HumanEval vs 80% for the GPT-4 baseline at the time ([arXiv:2303.11366](https://arxiv.org/abs/2303.11366), verified). Generative Agents established the now-standard pattern: store experience in natural language, then **synthesize memories into higher-level reflections**, and retrieve by recency/importance/relevance ([arXiv:2304.03442](https://arxiv.org/abs/2304.03442), verified). The through-line is that the stored artifact is a *distilled reflection*, not the raw trace.

**Production memory layers do LLM distillation at write time.** Mem0 works by "dynamically **extracting, consolidating, and retrieving salient information**" — an LLM turns turns into facts before storage; on LOCOMO it reports a 26% relative improvement (LLM-as-judge) over an OpenAI baseline, 91% lower p95 latency, and >90% token savings vs full-context ([arXiv:2504.19413](https://arxiv.org/abs/2504.19413), verified). A-MEM adds Zettelkasten-style linking where **new memories trigger updates to existing memories' representations** — living notes, not append-only ([arXiv:2502.12110](https://arxiv.org/abs/2502.12110), verified).

**Idle-time consolidation.** Letta's "sleep-time compute" runs a background agent that transforms "raw context" into "learned context" during downtime, because "memory formation … is incremental, so memories may become messy and disorganized over time" ([letta.com/blog/sleep-time-compute](https://www.letta.com/blog/sleep-time-compute/), verified). SSGM frames evolving-memory *safety*: temporal-decay modeling + **consistency verification prior to consolidation** to prevent "semantic drift where knowledge degrades through iterative summarization" ([arXiv:2603.11768](https://arxiv.org/abs/2603.11768), verified).

**Retrieval recall ≠ usefulness.** ActMem argues existing memory benchmarks over-focus on fact retrieval and that "retrieving information without understanding its deeper implications" fails on complex reasoning ([arXiv:2603.00026](https://arxiv.org/abs/2603.00026), verified — note the title is "Bridging the Gap Between Memory Retrieval and Reasoning," so its recall-vs-usefulness point is *adjacent*, not a headline metric).

**Experience granularity.** A 2026 continual-internalization paper distinguishes **principle-level vs instance-level** experience and off-policy vs on-policy distillation, and warns of "progressive capability collapse rather than compounding improvement" when experience is internalized naively over many iterations ([arXiv:2606.04703](https://arxiv.org/abs/2606.04703), verified — this is a *training-iteration* collapse, not prompt-length "context collapse"). The current memory survey formalizes memory along a three-dimensional taxonomy — temporal scope × representational substrate × **control policy** (heuristic → prompted → learned) — over a write-manage-read loop ([arXiv:2603.07670](https://arxiv.org/abs/2603.07670), verified).

**The most consequential frontier fact is in our own harness.** Claude Code now ships **native "Auto memory"**: Claude *writes its own distilled notes* to `~/.claude/projects/<project>/memory/` based on corrections/preferences, "decides what's worth remembering," keeps a `MEMORY.md` index (first 200 lines / 25KB loaded every session), per-repo, machine-local, v2.1.59+ ([code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory), verified). **This session is running on it** — the system prompt's `# Memory` block points at exactly that directory. So CCv3's hand-built extraction pipeline now runs *on top of* a harness that already does LLM-distilled note-taking natively.

(Skill-induction — agents writing reusable skills from experience, e.g. SkillWeaver's 31.8% WebArena gain / up to 54.3% cross-agent transfer, [arXiv:2504.07079](https://arxiv.org/abs/2504.07079), verified — is a *different* component (`skills`, covered 2026-07-07) and is out of scope here.)

## 3. Gap analysis

| Dimension | CCv3 extraction today | Frontier / native harness | Verdict |
|---|---|---|---|
| Candidate detection | 18 regex perception patterns on thinking | LLM-judged salience (Mem0), reflection (Reflexion) | Behind, but cheap and adequate as a *pre-filter* |
| Distillation | **none** — raw thinking stored verbatim (≤2000 chars) | LLM distills a crisp lesson before store (Mem0, Generative Agents, native Auto memory) | **Behind (the core gap)** |
| Quality gate | fixed keyword score, cut at <3 | LLM-as-judge, adaptive/per-domain thresholds; evaluate by usefulness not gate-pass | Behind (measuring gate-pass, not benefit) |
| Periodic layer | stores checkpoint strings it later archives | n/a — nobody stores heartbeats as memories | **Actively negative** |
| Consolidation | write-time 0.85 dedup only | sleep-time re-dedup/prune, evolving notes | Behind — **already owned by 2026-06-30 R4/R5** |
| Control policy | heuristic (regex + keyword) | moving toward prompted/learned | Behind (intentional; learned write = SKIP) |
| Platform overlap | Postgres pipeline only | native Auto memory now exists in parallel | **Unreconciled — double substrate** |

Where we are **even/ahead**: the deterministic supply-chain-style discipline is good — a write-time gate exists at all, dedup exists, provenance tags exist, and the 2026-06-30 arc already correctly SKIPs the heavy frontier (RL write policy, GraphRAG, full tiering). The gap is not "we're behind on everything"; it's three specific, cheap write-path defects plus one strategic overlap.

## 4. Recommendations

**R1 — Neuter the periodic-extract noise generator. ADOPT (quick win).**
`periodic-extract.ts` stores content the system is separately built to archive. Options, cheapest first: (a) make the hook emit its checkpoint only as a *session-message* (it already builds one at `buildOutput`) and **stop the `store_learning.py` spawn** entirely; or (b) if a mid-session sweep is wanted, replace the checkpoint string with a real call into the incremental extractor (same path as pre-compact). Verify by querying `archival_memory` for `tags @> '{periodic,extraction}'` before/after and confirming the write rate drops to zero. Low risk, purely subtractive, and it directly improves the SG-01 corpus-health denominator.

**R2 — Distill before storing. ADOPT (the core change).**
Replace verbatim `content[:2000]` storage (`incremental_extract.py:403-411`) with a one-shot distillation into a crisp lesson (problem → cause → fix / decision → rationale), keyed to the 7 existing types. Two viable engines, pick per cost:
- **Reuse the harness.** Native Auto memory already distills; the cheapest path may be to *stop hand-distilling* and let native Auto memory own the "crisp note" tier (see R4).
- **Local LLM distill.** If the Postgres corpus must stay authoritative (semantic recall, cross-session vector search — which native Auto memory's flat MEMORY.md does *not* provide), add a bounded distill step in the extractor. It should run in the already-detached background path (never on the hot tool-response path) to avoid the latency traps that killed the pageindex per-prompt hook.
This is the single highest-signal change: it converts "raw monologue" recall hits into "actionable lesson" recall hits. Mem0/Generative Agents/native Auto memory all do exactly this.

**R3 — Reconcile with native Auto memory (strategic). ADOPT (decision, not code).**
CCv3 now runs two learning substrates: the Postgres pipeline (this component) and native Auto memory (LLM-distilled markdown notes, loaded every session). Running both un-reconciled risks drift and double-maintenance. Recommended split, to decide explicitly:
- **Native Auto memory** owns *distilled, always-loaded, per-repo* notes (its strength: LLM-written, in-context every session, zero infra).
- **Postgres pipeline** owns *semantic cross-session recall at scale* (its strength: vector search over 100s of learnings, agent-queryable, the thing MEMORY.md's 25KB cap cannot do).
Then R2's distillation can *feed both*: distill once, write the lesson to Postgres for recall and let native Auto memory carry the always-on tier. This is a WATCH→decide item; the risk of not deciding is silent divergence between two memories of the same project.

**R4 — Consolidation + contradiction-invalidation. DEFER (already owned).**
The frontier's sleep-time consolidation (Letta), evolving notes (A-MEM), and consistency-before-consolidation (SSGM) are real and relevant — but the 2026-06-30 arc **already proposes them** as R4 (idle consolidation pass on the ST-05 daemon) and R5 (auto-invalidate on contradiction). No new recommendation here; this proposal just adds a second, independent confirmation from the *write* side that they matter. Do not double-track.

**R5 — Usefulness-based gate evaluation. WATCH (extends 2026-06-30 R2).**
The static score-<3 gate is tuned to nothing measurable. ActMem/RealMem (via the 2026-06-30 arc) argue recall overstates benefit; the same logic says "the gate let it through" ≠ "it helped." Once the 2026-06-30 R2 Mem-Helpful signal exists, extend it to gate tuning: track whether *gate-passed* learnings are ever recalled/cited, and use that to move the threshold — rather than adopting a heavier LLM-judge gate blind. WATCH until R2 lands the signal.

**R6 — Instance vs principle extraction tiers. WATCH (small).**
The granularity split ([arXiv:2606.04703](https://arxiv.org/abs/2606.04703)) maps onto CCv3's existing types (instance: `WORKING_SOLUTION`/`ERROR_FIX`; principle: `CODEBASE_PATTERN`/`ARCHITECTURAL_DECISION`). A cheap refinement: extract instance-level cheaply/high-volume (current path) but hold principle-level to a higher bar — e.g. require the same pattern to recur across ≥2 sessions before writing a `CODEBASE_PATTERN`. WATCH; only worthwhile after R2 makes principle entries crisp enough to compare.

**R7 — Learned/RL write policy and self-editing weights. SKIP.**
SEAL's self-edits-as-weight-updates ([arXiv:2506.10943](https://arxiv.org/abs/2506.10943)) is real frontier but SKIP for a harness on a hosted model — we cannot SFT the base model, and the 2026-06-30 arc already SKIPs RL write policy as too heavy for a single-operator system. Likewise, **RLAIF/Constitutional-style training of a memory-quality reward model** is a genuine white space (no verified paper does it for memory-write filtering) — interesting to name, not to build.

## 5. Integration approach

| Rec | Files | Ties to BACKLOG / prior proposals | Effort | Risk |
|---|---|---|---|---|
| R1 (kill periodic noise) | `.claude/hooks/src/periodic-extract.ts` (drop the `store_learning.py` spawn at :190-204) + rebuild/sync | improves **SG-01** denominator; complements DEL cleanup | XS | Low (subtractive; fail-open hook) |
| R2 (distill before store) | `opc/scripts/core/incremental_extract.py` (`store_thinking_learning` :371-411) + `store_learning.py` | new; the write-side complement to **SG-01**; must respect **ST-05** daemon/latency posture | M | Med — distill must stay on the detached path; a bad prompt could over-summarize |
| R3 (reconcile substrates) | decision doc under `docs/system-update/`; no code until decided | strategic; interacts with `.claude/skills/memory/SKILL.md` | S (analysis) | Med — the risk is *not* deciding |
| R4 (consolidation) | — | **defer to 2026-06-30 R4/R5**, host = **ST-05** | — | — |
| R5 (usefulness gate) | `.claude/skills/memory-stats/`, `memory-recall.jsonl` | extends **2026-06-30 R2**; **SG-01** SLO | S (after R2 signal) | Low (read-only telemetry) |
| R6 (instance/principle) | `incremental_extract.py` (`infer_learning_type` :199-225) + a cross-session recurrence check | new; small | S | Low |

Sequencing: **R1 first** (trivial, immediate corpus hygiene), then **R3 decision** (it gates how much to invest in R2), then **R2** (the real lift), with R5/R6 as WATCH riding the 2026-06-30 telemetry.

**What could go wrong:**
- R2 distillation on any synchronous path re-creates the pageindex/UPS latency problem — it MUST stay in the existing detached background spawn.
- R3 done wrong (deleting one substrate) loses a real capability — native Auto memory has no vector recall; Postgres has no always-on in-context tier. The answer is *roles*, not *removal*.
- R1: confirm no downstream consumer depends on periodic `OPEN_THREAD` rows before removing (grep shows they exist only to be archived — verify, don't assume).

## 6. Benefits

- **Recall that returns lessons, not monologue (R2).** Today a `MEMORY MATCH` can surface 2000 chars of raw thinking; after R2 it surfaces "Hook X fails silently if dist/ missing — run `npm run build`." Higher signal density per recalled token, directly on the surface that injects context into prompts.
- **A cleaner corpus and a truer SG-01 number (R1).** Removing the self-archiving checkpoint writes stops the pipeline from polluting its own denominator, so the 27.4% hit-rate re-baseline (SG-01) measures real learnings.
- **No two-brains drift (R3).** Deciding roles for native Auto memory vs Postgres means the user gets one coherent memory story, not two partial ones silently diverging per repo.
- **Cheaper than the alternative.** Every heavy frontier option (RL write policy, weight self-edits, LLM-judge gate) is explicitly SKIP/WATCH; the ADOPT set is one deletion + one background distill step + one decision — small, reversible, and it leans on distillation the harness already does for free.

## 7. Open questions

1. **Does native Auto memory make the Postgres write pipeline partly redundant?** If native Auto memory covers the "distilled note" job well in practice, R2's local-distill option may be unnecessary — the pipeline could shrink to "semantic-recall indexer over native notes." Needs an observation pass on what native Auto memory actually captures for this repo (it's live now).
2. **What distillation engine for R2 headless?** The extractor runs detached via `uv run python` with no interactive model; a distill step needs a callable LLM. Reusing native Auto memory (R3) sidesteps this; a local call adds a dependency. Open.
3. **Is regex perception-signal detection even the right pre-filter** once distillation exists, or should candidate selection move to an LLM salience pass (Mem0-style)? Likely keep regex as a cheap gate and let distillation be the quality step — but unverified at CCv3's volume.
4. **R6 recurrence threshold** — how many sessions must a pattern recur before it's written as a principle-level `CODEBASE_PATTERN`? No data yet; the 2026-06-30 usefulness telemetry (R2) is the prerequisite for tuning it.
5. **Verification of the ActMem attribution** — its recall-vs-usefulness point is adjacent to its stated thesis (retrieval↔reasoning); if a formal write-up leans on it, cite it for "benchmarks over-focus on fact retrieval," not for a named recall-doesn't-correlate metric.
