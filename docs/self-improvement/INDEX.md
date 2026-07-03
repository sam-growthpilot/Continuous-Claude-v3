# Self-Improvement Proposals — Index

One row per morning's research run, appended at the bottom by
`scripts/self-improvement/record-index.mjs`. Read the proposal, then **ratify** (move into
`docs/system-update/BACKLOG.md`), **watch**, or **drop** it. The `verdict` is the research session's
own recommendation — you own the decision. See [README.md](./README.md) for how the loop works.

| Date | Component | Verdict | Headline | Sources | Proposal |
|------|-----------|---------|----------|---------|----------|
| 2026-06-30 | Memory | adopt | CCv3 already built the frontier's two highest-ROI retrieval upgrades (websearch FTS fix shipped, cross-encoder reranker built) — wire the dormant reranker into the hot recall path and re-baseline SG-01 with a usefulness metric, not just hit-rate, before chasing tiering/RL/multi-agent memory. | 23 | [proposal](proposals/2026-06-30-memory.md) |
| 2026-07-01 | Hooks | adopt | CCv3's hook layer is strong on deterministic supply-chain/destructive guards but is being out-evolved by the native Claude Code platform (parallel execution, dedicated Subagent events, `updatedInput`, `if`-conditions, `defer`) that several open backlog arcs are manually rebuilding — and it entirely lacks the one defense the frontier converged on: session-scoped dataflow / capability enforcement (lethal trifecta / Rule of Two). | 15 | [proposal](proposals/2026-07-01-hooks.md) |
| 2026-07-02 | Agents | adopt | The frontier has converged on "one context-owning orchestrator + a few well-scoped isolated workers, with specialization delivered just-in-time via skills, structured returns, and trajectory-level grading" — CCv3's 36-agent portfolio (30 with no recorded activity, 16 dead .json twins, free-text returns, dead spawn-side telemetry) is over-specialized on the agent axis and under-invested in the handoff and verification axes. | 10 | [proposal](proposals/2026-07-02-agents.md) |
