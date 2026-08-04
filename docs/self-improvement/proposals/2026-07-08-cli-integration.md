---
date: 2026-07-08
component: cli-integration
component_name: CLI Integration Layer
verdict: adopt
headline: CCv3's native-CLI-first decision tree is exactly the direction the frontier converged on (Anthropic + Cloudflare + Ronacher all say the resident-MCP-tool-def surface is the expensive anti-pattern) — so SKIP rewriting the strategy, WATCH the tool-search/code-execution mechanisms (the Claude Code harness already gives us tool-search + defer_loading for free), and ADOPT three cheap hygiene wins: a measured MCP-vs-CLI overlap audit (we run duplicate substrates for gh/github, vercel/Vercel, neonctl/Neon, sentry-cli/Sentry, linearis/Linear), an output-ergonomics extension to the Agent Compatibility Checklist, and a short MCP-trust-tiering note.
sources: 11
---

# CLI Integration Layer — Next-Evolution Proposal (2026-07-08)

## 1. Where CCv3 is today

CCv3's CLI/tool integration layer is a **decision doc + convention**, not enforced code. Two artifacts:

**A. The strategy rule** — `.claude/rules/cli-integration-strategy.md` (always in context). It defines:
- A 6-tier **decision tree** for granting an agent access to a new platform, in priority order: **native CLI > OpenCLI (browser-bridge) > MCP > CLI-Anything wrapper > thin REST wrapper > browser automation** (`cli-integration-strategy.md` "Decision Tree").
- A **24-tool inventory** grouped by integration pattern (Direct Bash + Skill + Rule; Python harness via `uv run`; MCP server; plugin; agent delegation).
- An **Agent Compatibility Checklist** — 10 criteria for scoring a new CLI, explicitly sourced to *"Building CLIs for agents" by @ericzakariasson*: non-interactive mode, per-subcommand `--help`, JSON/structured output, flag-based inputs, fail-fast on missing args, idempotency, `--dry-run`, `--yes/--force`, predictable resource+verb structure, structured success output (IDs/URLs).
- A 7-step **integration checklist** (install → verify → score → skill → rule → inventory → sync).

**B. Reference wrapper** — `scripts/cdp.mjs` is the canonical "Pattern 5" thin CLI wrapper (Tier 2 of `browser-automation.md`): a stateless Node CLI over Chrome DevTools Protocol, "All output is JSON to stdout" (`cdp.mjs:3`), replacing chrome-devtools-mcp with a documented "32x fewer tokens, 100% vs 72% reliability" claim (`browser-automation.md`).

**Design posture (verified):**
- The layer is **prose guidance the model + operator follow**, not a hook. There is no runtime enforcement that a new platform actually goes native-CLI-first; the discipline lives in the rule and the per-tool skills/safety-rules.
- Per-platform CLIs are wrapped in a **skill + safety rule** each (e.g. `neonctl-safety.md`, `sentry-safety.md`, `kusto-cli-safety.md`, `notion-cli-safety.md`, `codex-worker-safety.md`), which is where confirm-first gating and non-interactive contracts live.
- **The harness already runs tool-search + deferred loading on top of this layer.** Directly observable in *this* session's system-reminders: "The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded … Use ToolSearch …" — listing `CronCreate`, `WebFetch`, and several hundred `mcp__*` tools across ~14 connected MCP servers (Neon, Vercel, Google Drive, Slack, Atlassian, Notion, PageIndex, github, serena, …). The Claude Code harness, not the CCv3 repo, provides the just-in-time tool retrieval described in the frontier below.

**Known limitations (partly named in the review docs):**
- The strategy doc is **not measured**. There is no per-MCP-server context-cost number and no discipline for "a CLI already covers this platform — prune/defer the redundant MCP server." CURRENT-STATE.md/BACKLOG.md say little about this layer; the closest arcs are **SG-02** (3-way settings/template drift: "18 hooks live in active but absent from tracked repo") and **SG-03** (elegance/pruning) — the MCP server list is exactly the kind of config that drifts and duplicates (`BACKLOG.md:94,96`).
- The Agent Compatibility Checklist scores **input ergonomics only** — it has no dimension for how a tool shapes its *output* for a model consumer.
- `kusto-cli` is documented as a partial miss (REPL-first, positional conn string, no native JSON) — the checklist catches this but the layer has no "tool output design" lens (`cli-integration-strategy.md` inventory footnote).

## 2. Frontier scan

Verification status is explicit per source. **Seven primary sources were re-fetched and quote-verified this session** (marked ✓). Sources relayed from the `oracle` research agent that I did not independently fetch are marked ⚠ relayed and are never the sole basis for a named figure.

1. **⚠ relayed (partial) — Eric Zakariasson, "Building CLIs for agents."** X long-form Article, published **2026-03-25**. `https://x.com/ericzakariasson/status/2036762680401223946`. The article body is login-gated; oracle confirmed existence/title/date/author via X's own preview metadata but could not read the full checklist verbatim. This is the essay CCv3's Agent Compatibility Checklist already cites — so I treat the checklist as **our own internal restatement**, not a fresh verbatim quote. Independently-verifiable corroboration of its core "non-interactive by default" thesis: **✓ ElevenLabs Devs**, "ElevenLabs CLI is now agent-first! We made it non-interactive by default, so that your agent and automations can easily interact with it" — `https://x.com/ElevenLabsDevs/status/2036802792061333989` (relayed URL; the *claim* — agent-first CLIs go non-interactive by default — matches our rule).

2. **✓ Anthropic — "Code execution with MCP: building more efficient agents"** (2025-11-04). `https://www.anthropic.com/engineering/code-execution-with-mcp`. Verified: "This reduces the token usage from 150,000 tokens to 2,000 tokens—a time and cost saving of 98.7%" (a single illustrative Google-Drive→Salesforce workflow, not a general benchmark). Core argument verified: "loading all tool definitions upfront and passing intermediate results through the context window slows down agents and increases costs"; the fix is to "present MCP servers as code APIs rather than direct tool calls." Cost acknowledged: "Running agent-generated code requires a secure execution environment with appropriate sandboxing, resource limits, and monitoring." Credits Cloudflare's "Code Mode."

3. **✓ Cloudflare — "Code Mode: give agents an entire API in 1,000 tokens"** (2026-02-20). `https://blog.cloudflare.com/code-mode-mcp/`. Verified: "Code Mode reduces the number of input tokens used by 99.9%"; "An equivalent MCP server without Code Mode would consume 1.17 million tokens" for an API with "over 2,500 endpoints," replaced by two tools at "roughly 1,000 tokens." **Most relevant to CCv3 — Cloudflare's explicit substrate taxonomy, verified verbatim:** "Command-line interfaces are another path. CLIs are self-documenting and reveal capabilities as the agent explores." … "The limitation is obvious: the agent needs a shell, which not every environment provides and which introduces a much broader attack surface than a sandboxed isolate." (It similarly notes dynamic tool search "shrinks context use but now requires a search function that must be maintained and evaluated.")

4. **✓ Anthropic — "Introducing advanced tool use"** (2025-11-24). `https://www.anthropic.com/engineering/advanced-tool-use`. Verified figures: **Tool Search Tool** = "85% reduction in token usage while maintaining access to your full tool library"; accuracy Opus 4 "improved from 49% to 74%," Opus 4.5 "79.5% to 88.1%." **Programmatic Tool Calling** = "Average usage dropped from 43,588 to 27,297 tokens, a 37% reduction." **Tool Use Examples** = "improved accuracy from 72% to 90% on complex parameter handling."

5. **✓ Anthropic docs — "Tool search tool"** (generally available). `https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool`. Verified: "Claude's ability to pick the right tool degrades once you exceed 30–50 available tools." A "GitHub, Slack, Sentry, Grafana, and Splunk" setup "can consume ~55k tokens in definitions before Claude does any work. Tool search typically reduces this by over 85 percent, loading only the 3–5 tools Claude needs." Mechanism: mark tools `defer_loading: true` (max **10,000** deferred/request; "At least one tool … must stay non-deferred"). Two built-in variants — **regex** and **BM25** (natural-language keyword), **not embeddings by default** — plus a documented **"Custom tool search implementation"** that can return `tool_reference` blocks "using embeddings or semantic search." MCP servers defer at the `mcp_toolset` level, not per-tool.

6. **✓ Anthropic — "Writing effective tools for agents — with agents"** (2025-09-11). `https://www.anthropic.com/engineering/writing-tools-for-agents`. The anchor source for output design. Verified: a `response_format` enum lets a tool return "concise" (72 tokens) vs "detailed" (206 tokens) — "~⅓ of the tokens with 'concise'." Error design: "you can prompt-engineer your error responses to clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks." Caps: "For Claude Code, we restrict tool responses to 25,000 tokens by default." Identifiers: "eschew low-level technical identifiers (for example: `uuid`, `256px_image_url`, `mime_type`) … Fields like `name`, `image_url`, and `file_type` are much more likely to directly inform agents' downstream actions." Granularity: "Instead of implementing a `read_logs` tool, consider implementing a `search_logs` tool." Named win: "Claude Sonnet 3.5 achieved state-of-the-art performance on the SWE-bench Verified evaluation after we made precise refinements to tool descriptions."

7. **✓ Armin Ronacher — "Skills vs Dynamic MCP Loadouts"** (2025-12-13). `https://lucumr.pocoo.org/2025/12/13/skills-vs-mcp/`. Verified: the skill system "gets away without any of that [defer_loading engineering] and, at least from my experience, still outperforms it." On invoking MCP through a CLI (Peter Steinberger's `mcporter`): "the answer is yes, you can, but it doesn't work well … the LLM does not have any idea about what tools are available, and now you need to teach it that." On interface stability: "MCP servers have no desire to maintain API stability. They are increasingly starting to trim down tool definitions" — citing the Sentry MCP switching "the query syntax entirely to natural language," which broke his written guidance. Conclusion favors "manually maintained skills and agents writing their own tools."

8. **✓ MCPTox — "A Benchmark for Tool Poisoning Attack on Real-World MCP Servers."** arXiv **2508.14925** (2025-08-19). Verified abstract: built on "45 live, real-world MCP servers and 353 authentic tools," 1312 malicious test cases across 10 risk categories; "o1-mini, achieving an attack success rate of 72.8%"; "the highest refused rate (Claude-3.7-Sonnet) less than 3%." Tool poisoning = malicious instructions embedded in tool metadata that enters context.

9. **⚠ relayed — Simon Willison, "The lethal trifecta for AI agents."** `https://simonw.substack.com/p/the-lethal-trifecta-for-ai-agents`. The established framing for the risk class (private-data access + untrusted-content exposure + external-communication ability). Cited for the *concept*; I did not re-fetch it this session.

10. **⚠ relayed — MCP Registry (preview).** `https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/` (2025-09-08) — "an open catalog and API for publicly available MCP servers." Still labeled "preview" in the source; **GA status unverified** — do not claim GA.

11. **✓ (this session, direct observation) — the Claude Code harness itself.** This session's system-reminders show the harness deferring `CronCreate`/`WebFetch`/several hundred `mcp__*` tool schemas behind `ToolSearch`, i.e. the harness natively implements source 4/5's mechanism above the CCv3 layer.

## 3. Gap analysis

**Where CCv3 is ahead / already aligned:**
- The **native-CLI-first ordering is the frontier's answer.** Anthropic (2,4,6), Cloudflare (3), and Ronacher (7) independently converge that the resident MCP tool-definition surface is the expensive anti-pattern, and that self-documenting CLIs / code / skills are better substrates. CCv3 encoded `native CLI > … > MCP > … > browser` and wraps each CLI in a skill+safety-rule — a design that predates and matches the 2025-11→2026-02 frontier writing. `cdp.mjs` (JSON-out, stateless, replaces an MCP) is a textbook instance of the Cloudflare/Anthropic thesis.
- **Tool-search / defer_loading is already ours for free** (source 11): the harness defers our whole MCP surface and loads on demand. We do **not** need to build it, and the repo doc should say so, so nobody reinvents it.

**Where CCv3 is even / uncaptured:**
- We benefit from tool-search but **have never measured** what the connected-MCP surface costs at session start, nor pruned it. The frontier's whole point (sources 2–5) is that this surface is where the tokens go.

**Where CCv3 is behind / could be better:**
- **(a) Duplicate substrates, unmeasured, unpruned.** We run *both* a native CLI *and* an MCP server for the same platform in several cases — visible in this session and the rules: `gh` CLI + `github` MCP (`mcp__github__*`); `vercel` CLI + Vercel MCP (`mcp__claude_ai_Vercel__*`); `neonctl` + Neon MCP (`mcp__Neon__*`); `sentry-cli` + Sentry MCP; `linearis` + Linear MCP; `ntn` + Notion MCP (`mcp__claude_ai_Notion__*`). The strategy doc's own tree says native CLI is Tier 1 and MCP is Tier 3, yet both coexist with no per-platform decision recorded. Some duplication is **intentional and documented** (the `notion-cli-safety.md` rule explicitly keeps Bridge writes on the Notion MCP; the `deployer` agent leans on Vercel/Railway/Sentry/Linear MCP) — so this is an *audit-and-decide*, not a blanket prune.
- **(b) The checklist ignores output ergonomics.** Our 10-criterion score is all input-side. Source 6 gives a ready-made output rubric (configurable verbosity, teaching error messages, high-signal identifiers, response caps/pagination) that neither the checklist nor `cdp.mjs` explicitly follows.
- **(c) No tools-as-code pattern for high-fan-out APIs.** The tree stops at "thin CLI wrapper," which still bloats for a 2,500-endpoint API (source 3). The code-execution answer (sources 2/3) is real but needs a sandbox CCv3 lacks on Windows (the `codex-worker-safety.md` rule already documents that `workspace-write` "blocks subprocess launches on Windows").
- **(d) MCP security posture is informal.** We run ~14 third-party MCP servers whose tool metadata enters context, but the layer has no explicit tool-poisoning / lethal-trifecta framing (sources 8/9: refusal rates <3%). Per-tool safety rules exist, but they gate *our CLIs*, not *third-party MCP tool metadata*.

## 4. Recommendations

- **R1 — ADOPT (small): Measured MCP-vs-CLI overlap audit + prune/defer.** Add a "one substrate per platform (measure first)" principle to `cli-integration-strategy.md`. Run one measurement pass of the connected-MCP context cost; for platforms where a gold-standard CLI + safety rule already exists (`gh`, `vercel`, `neonctl`, `sentry-cli`, `linearis`), decide per platform whether to disconnect or `defer_loading` the redundant MCP server — **respecting documented intentional dual-substrate cases** (Notion MCP for Bridge writes; `deployer`'s MCP use). Rationale: this is the exact lever sources 2–5 identify, it ties directly into **SG-02** (settings drift) and **SG-03** (pruning), and it is where any real token win lives.
- **R2 — ADOPT (small): Output-ergonomics section on the Agent Compatibility Checklist.** Import source 6's rubric — configurable verbosity (`response_format` concise/detailed), error messages that teach the correct invocation, high-signal fields over `uuid`/`mime_type`, response caps/pagination — and make it the authoring convention for `cdp.mjs` and any new Pattern-5 wrapper. Rationale: cheap, doc-only, and it closes a real blind spot (input-only scoring) with a primary-sourced checklist.
- **R3 — WATCH: Tools-as-code / code-execution for high-fan-out APIs.** Genuine 98.7–99.9% wins (sources 2/3), but it needs sandboxing CCv3 doesn't have on Windows, and the harness's tool-search already covers our current scale. Revisit only if we add a >100-endpoint internal API. Note Docker is available (RLM path) as a possible future sandbox.
- **R4 — WATCH (one-line doc note): Do NOT build tool-search/defer_loading in the repo.** The harness provides it (source 11). The repo's job is to keep the *non-deferred* set small and descriptions clean (source 5 optimization tips: namespaced names, keyword-rich descriptions). Add a sentence to the strategy doc pointing at the harness capability.
- **R5 — WATCH → light-ADOPT (doc note): MCP trust tiering.** A short section (in `cli-integration-strategy.md` or a new `mcp-trust.md` rule) noting tool-poisoning risk (source 8), the lethal-trifecta test (source 9), and that a per-platform CLI behind our safety rules is a **lower-trust surface** than a third-party MCP server whose metadata enters context. Pairs with the `aegis` security posture.
- **SKIP — Rewriting the decision tree.** The native-CLI-first ordering is validated by the entire frontier. No change. *We are already strong here.*

## 5. Integration approach

| Rec | Files touched | BACKLOG tie | Effort | Risk |
|-----|---------------|-------------|--------|------|
| R1 | `cli-integration-strategy.md` (principle); a one-off measurement script under `scripts/`; `settings.json` ×3 MCP config (defer/disconnect) | **SG-02** (3-way settings drift), **SG-03** (pruning) | S (measure) + S per platform decision | Med — dropping an MCP a skill/agent calls by name (`deployer`, `notion-bridge`) breaks it → **measure + `defer_loading` before any disconnect**; never touch the Notion MCP Bridge path (`notion-cli-safety.md`) |
| R2 | `cli-integration-strategy.md` (new checklist section); `scripts/cdp.mjs` (apply); wrapper-authoring convention | — | S | Low (doc + convention) |
| R3 | none now (WATCH) | future (needs sandbox) | — | — |
| R4 | `cli-integration-strategy.md` (one sentence) | — | XS | Low |
| R5 | `cli-integration-strategy.md` or new `mcp-trust.md` | aegis/security | S | Low |

- **Sequencing:** R2/R4/R5 are independent doc edits, do anytime. R1's config half should ride **SG-02** (it *is* a settings-drift concern) and be gated on a measurement pass — do not prune blind.
- **What could go wrong:** the biggest failure mode is R1 pruning an MCP server that a skill/agent silently depends on. Mitigation is strict: (1) measure context cost first — the harness already defers these, so the real win may be small and not worth the risk; (2) prefer `defer_loading` over disconnect; (3) enumerate every `mcp__<server>__` caller (skills, agents, rules) before touching a server; (4) treat documented dual-substrate cases as out of scope.

## 6. Benefits (for the user)

- **Cheaper / faster sessions** — if the measurement (R1) shows the connected-MCP surface has non-trivial resident cost, deferring/pruning duplicates lowers session-start token cost and latency. (Honest caveat: the harness already defers these, so the win must be *measured*, not assumed.)
- **More reliable wrappers, fewer retry loops** — R2 makes `cdp.mjs` and future Pattern-5 wrappers return concise, high-signal output with error messages that teach the correct invocation, so the model self-corrects instead of looping (source 6's SWE-bench-style effect).
- **A crisp answer to a recurring friction** — "we have both a CLI and an MCP for X, which do I use?" becomes a recorded per-platform decision instead of an ad-hoc choice each session.
- **Reduced attack surface** — R5 gives an explicit, sourced framing for the ~14 third-party MCP servers whose metadata Claude reads (tool poisoning, <3% refusal), aligned with the CLI-behind-safety-rule preference we already practice.

## 7. Open questions

1. **What does each connected MCP server actually cost at session start** under the harness's deferral? Needs a measurement pass before any R1 pruning — the win may already be captured by tool-search.
2. **Which skills/agents call each `mcp__<server>__*` tool by name?** (`deployer`, `notion-bridge`, review pipeline) — a dependency map is the precondition for safe deferral.
3. **Is there a Windows-viable sandbox** (Docker per RLM?) that would make R3 code-execution feasible if we ever need it, given `workspace-write` can't spawn subprocesses on Windows?
4. **Should the Agent Compatibility Checklist become machine-checkable** (a lint over new wrapper scripts) rather than a prose rubric, or is prose sufficient given how rarely we add a CLI?
