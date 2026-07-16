# Pending Self-Improvement Digests → Notion Bridge (Code→Eve queue)

Unattended research runs cannot reliably reach the Notion Bridge (headless + fragile HTML/mention
format). Each entry below is a proposal digest awaiting sweep into the Bridge Code→Eve queue by the
next interactive session. After posting one, delete its block from this file.

---

## 2026-07-16 — Code Intelligence (component self-improvement review)

- **Date:** 2026-07-16
- **Component:** code-intel (codegraph + Serena + TLDR + ast-grep + /code-intel facade + L2 context bus)
- **Verdict:** WATCH (finish in-flight ST-04/ST-01; adopt two cheap borrowed patterns; skip the tempting migrations)
- **Headline:** CCv3's embedding-free structural-graph + LSP-escalation design IS the convergent 2026 pattern — do NOT migrate codegraph to SCIP or add code-embeddings to the facade; finish the in-flight latency/freshness fixes (ST-04) and adopt one borrowed pattern (dirty-propagation to callers) for the edge-orphaning bug.
- **Top ADOPTs:** (a) warm codegraph process / per-invocation process pool instead of one-shot-per-dirty-file — the ~3-4s tax is Node+WASM *startup*, not query work, so a warm process is the right lever for the 62s facade median (ties **ST-04**); (b) dirty-propagation to callers — re-sync files with a prior edge into a changed callee, strictly better than blunt `index --force`, fixes the who-calls under-report; (c) cheap: add `payload_bytes` to `intel-bus.jsonl` (the Hono benchmark shows per-call payload drives cost as much as latency), fix stale `code-intel.mjs:17` header comment + `tldr-cli.md` contract contradiction (both already in the C.5 gate).
- **WATCH:** hybrid RRF fusion (BM25+graph+embeddings as one ranked retriever, à la Gortex/RANGER) — we already have the pieces, routed not fused; only worth it post-ST-04 with a repo-local benchmark. "Code Isn't Memory"-style within-harness ablation to justify the C.5 deny-flip once latency is fixed.
- **SKIP:** migrate codegraph store to SCIP (interchange format, no Sourcegraph-interop need); add code-embedding search to the facade (frontier is retreating from pure-semantic for agentic tasks — keep pgvector scoped to learnings, not code).
- **Repo-truth note (verified):** `scripts/code-intel.mjs:17` header still says codegraph is "ABSENT (Phase C)" but the runtime code (`:291-410`) invokes it live via `process.execPath`+`npm-shim.js` — stale Phase-B comment, one-line fix.
- **Proposal path:** `docs/self-improvement/proposals/2026-07-16-code-intel.md`
- **Sources:** 14 (verified ✓: Sourcegraph SCIP blog; Aider repomap; oraios/serena; Continue.dev @Codebase deprecation; HarrisonSec Hono codegraph benchmark; arXiv 2606.22417 "Code Isn't Memory"; arXiv 2503.09089 LocAgent. Research-agent secondary: Cursor indexing docs; mcp-language-server; zzet.org local-graph comparison + code-knowledge-graph; Gortex; arXiv 2408.03910 CodexGraph; HarrisonSec codegraph architecture; Sourcegraph LSIF→SCIP migration. [Speculation] flagged: Gortex retrieval numbers, Cody embeddings-pivot, Anthropic-internal grep-beat-RAG.)

---

## 2026-07-15 — Workflows (component self-improvement review)

- **Date:** 2026-07-15
- **Component:** workflows (Ralph, Maestro, deterministic Workflow tool)
- **Verdict:** ADOPT (finish cheap items already identified; not a rebuild)
- **Headline:** CCv3's workflow loop shape stays at/ahead of the mid-2026 frontier — priority is the 2026-07-03 proposal's cheap ADOPTs that never shipped (plan-compliance check, resume-idempotency audit, first saved Workflow script), plus a verified correction: the QW-04 matcher flip HAS reached the workflow enforcers in active settings, so the remaining debt is stale docs + overclaiming SKILL/RULES text + confirming the now-live hooks actually gate — not the flip.
- **Top ADOPTs:** R1 add plan-compliance check to Ralph 4.1.5 (diff vs `/tasks/`, not just PRD outcomes) · R2 add ONE cross-model 2nd opinion (codex-adversary) at the merge gate — refined DOWN from a full panel by new judge-reliability evidence · R3 audit Ralph resume for first-replayed-step idempotency (crash-after-commit-before-record → duplicate commit) · R4 codify /review as the first saved native Workflow-tool script (`.claude/workflows/`) · R6 truth-up docs + behaviorally verify the now-live `maestro-enforcer`/`ralph-task-monitor` actually gate (ST-02 identity dependency).
- **WATCH/SKIP:** R5 port Ralph phase-3 loop to Workflow script (WATCH — coupling) · R-NEW selective/speculative verification à la Sherlock (WATCH) · R7 difficulty-aware vs size-based tiering (SKIP for now).
- **Repo-truth correction (verified this session):** `CURRENT-STATE.md:39` and `BACKLOG.md:37,49` still call the workflow enforcers "Agent-matcher dead / QW-04 pending," but active `~/.claude/settings.json` has both `maestro-enforcer` (matcher block line 25) and `ralph-task-monitor` (line 378) on `"matcher": "Task"` — flipped and firing. Meanwhile `maestro/SKILL.md:36-39` + `ralph/SKILL.md:33` still assert hard-blocking that may be log-only (ST-02 shared-session_id gap). Docs under-claim; SKILLs over-claim.
- **Also answered:** open Q5 from 2026-07-03 — the deterministic Workflow tool IS available in headless `claude -p` runs (this proposal was written in one; the tool is in the toolset), so saved Workflow scripts could back scheduled jobs too.
- **Proposal path:** `docs/self-improvement/proposals/2026-07-15-workflows.md`
- **Sources:** 12 (Anthropic building-effective-agents; Anthropic "Dynamic Workflows" in Claude Code / InfoQ; Sherlock 2511.00330; DAAO 2509.11079; judge-rubrics 2606.29920; Reliability-without-Validity 2606.19544; plan-compliance 2604.12147; SWE-EVO 2512.18470; DBOS durable-execution; diagrid checkpoints≠durable; orchestration survey 2601.13671; LangGraph+Temporal 2026 consensus [summary-only])

---

## 2026-07-14 — Agents (component self-improvement review)

- **Date:** 2026-07-14
- **Component:** agents (Agents — specialized subagent ecosystem)
- **Verdict:** ADOPT (targeted honing, not a rebuild)
- **Headline:** CCv3's agent layer is frontier-aligned on context isolation (agent-as-tool) and cost-tier routing (explicit opus/sonnet), but the highest-leverage next moves are closing agent memory-blindness (0/281 sub-agent recall rows), pruning dead/overlapping agents (16 dead `.json`, 30/36 cold), and adding an explicit multi-agent cost gate (Anthropic's 15× token figure) — not adding more agents or a learned router.
- **Top ADOPTs:** R1 give judgment-dense agents bounded read-side recall · R2 prune roster (delete dead `.json`, audit review-family overlap) · R3 explicit "go multi-agent?" scaling rules in maestro/proactive-delegation · R4 wire `SubagentStop` to do both context-bus writes (ST-01) and structured verification · R5 fix inverted model-tier table in docs/agents/README.md.
- **Also noted (repo-truth updates):** QW-04 has SHIPPED — the agent guard chain (agent-model-guard / agent-error-capture / agent-verification) is now live on the `Task` matcher, contradicting the stale CURRENT-STATE.md:11 claim it "never fires." `SubagentStop` still count 0. Agent count is 39, not 36.
- **Proposal path:** `docs/self-improvement/proposals/2026-07-14-agents.md`
- **Sources:** 6 (Anthropic multi-agent research system; Cognition "Don't Build Multi-Agents"; Claude Code subagents docs; OpenAI Agents SDK orchestration/handoffs; LangGraph supervisor; τ-bench arXiv 2406.12045)

---

*Queue clear above this line — no pending digests prior. Last sweep: 2026-07-02 (07-01 Hooks + 07-02 Agents posted to Bridge Code→Eve queue).*
