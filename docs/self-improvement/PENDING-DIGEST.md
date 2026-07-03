# Pending Self-Improvement Digests → Notion Bridge (Code→Eve queue)

Unattended research runs cannot reliably reach the Notion Bridge (headless + fragile HTML/mention
format). Each entry below is a proposal digest awaiting sweep into the Bridge Code→Eve queue by the
next interactive session. After posting one, delete its block from this file.

---

- **Date:** 2026-07-01
- **Component:** Hooks
- **Verdict:** ADOPT (targeted)
- **Headline:** CCv3's hook layer is strong on deterministic supply-chain/destructive guards but is being out-evolved by the native Claude Code platform (parallel execution, dedicated Subagent events, `updatedInput`, `if`-conditions, `defer`) that several open backlog arcs (QW-04, ST-01, ST-03) are manually rebuilding — and it entirely lacks the one defense the frontier converged on: session-scoped dataflow / capability enforcement (lethal trifecta / Rule of Two).
- **Top recommendations:** R1 re-target the 12 dead agent-safety hooks to native `SubagentStart`/`SubagentStop` events (upgrades QW-04, unblocks ST-01/ST-10); R4 add a session-scoped lethal-trifecta / Rule-of-Two capability guard (net-new; candidate SI-02); R5 MCP tool-description rug-pull hook (candidate SI-03); R2 audit whether native parallel-hook exec obviates ST-03.
- **Proposal path:** `docs/self-improvement/proposals/2026-07-01-hooks.md`
- **Sources:** 15 (CaMeL arXiv 2503.18813 and AWS Cedar/AgentCore verified directly; native Claude Code hooks doc anchors the biggest gap).

---

- **Date:** 2026-07-02
- **Component:** Agents
- **Verdict:** ADOPT (targeted)
- **Headline:** The frontier converged on "one context-owning orchestrator + a few isolation-earning workers, specialization via just-in-time skills, structured returns, trajectory-level grading" — CCv3's 36-agent portfolio (30 inactive, 16 dead .json twins, free-text returns, dead spawn telemetry) is over-specialized on the agent axis and under-invested in handoff + verification.
- **Top recommendations:** R1 curate 36 → active core + convert prompt-only personas to skills (ties DEL-11/D7c-01); R2 structured return contracts per agent family (ralph_status precedent; candidate SI-04); R3 per-spawn outcome grading reviving `agent_task_success`, gated on QW-04/SubagentStop (candidate SI-05, feeds SG-04); SKIP learned router (RouteLLM overkill at single-user scale); WATCH agent teams/handoffs.
- **Proposal path:** `docs/self-improvement/proposals/2026-07-02-agents.md`
- **Sources:** 10 (Anthropic multi-agent system + Agent SDK + Agent Skills, Cognition "Don't Build Multi-Agents", Claude Code sub-agents docs, RouteLLM 2406.18665 and Agent-as-a-Judge 2410.10934 — all key claims verified by direct fetch 2026-07-02).
