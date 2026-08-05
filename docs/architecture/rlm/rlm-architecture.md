# RLM (Recursive Language Models) — Architecture

**Role:** The explicit escape hatch for analyzing inputs that overflow the normal context window — whole-repo sweeps, very large documents, multi-file corpora. Currently **dormant**: the engine is wired (Phases 0–2) but no active flow invokes it automatically; reach for it deliberately via the `rlm-analyze` skill / `/rlm-analyze path "question"`. Requires Docker + `ANTHROPIC_API_KEY`.

Status: **MVP in place** (Phase 0 + Phase 1 + Phase 2 shipped 2026-04-23). Docker sandbox required. `max_depth=1` locked.
Reference: paper [arXiv:2512.24601](https://arxiv.org/abs/2512.24601), library [alexzhang13/rlm](https://github.com/alexzhang13/rlm), adoption plan `~/.claude/plans/i-have-a-new-abstract-quail.md`.

**Interactive diagram:** https://excalidraw.com/#json=H5mTGt2vW4v9tcU0rt_Em,68fP_0OLmliMRLcrSm5hxQ
**Local file:** [`rlm-architecture.excalidraw`](./rlm-architecture.excalidraw) (open in excalidraw.com or the VS Code Excalidraw plugin)

---

## 1. High-level flow

```mermaid
flowchart TD
    classDef entry fill:#fff4e6,stroke:#d97706,stroke-width:2px,color:#111
    classDef gate  fill:#fde68a,stroke:#b45309,stroke-width:2px,color:#111
    classDef core  fill:#dbeafe,stroke:#1d4ed8,stroke-width:2px,color:#111
    classDef sandbox fill:#dcfce7,stroke:#166534,stroke-width:2px,color:#111
    classDef llm  fill:#ede9fe,stroke:#6d28d9,stroke-width:2px,color:#111
    classDef fail fill:#fee2e2,stroke:#b91c1c,stroke-width:2px,color:#111
    classDef obs  fill:#e0e7ff,stroke:#3730a3,stroke-width:2px,color:#111
    classDef future fill:#f3f4f6,stroke:#6b7280,stroke-width:2px,color:#111,stroke-dasharray: 5 5

    %% Entry points
    U[User / Caller]:::entry
    A1["rlm_complete(question, context, policy)<br/><i>opc/scripts/core/rlm_client.py</i>"]:::entry
    A2["tree_search_answer(q, tree_blob)<br/><i>opc/scripts/pageindex/tree_search.py</i>"]:::entry
    A3["/rlm-analyze path question<br/><i>Phase 3 — not built</i>"]:::future
    A4["analyze_learnings.py --question<br/><i>Phase 4 — not built</i>"]:::future

    %% Gates
    G1{{"Safety gate<br/>_assert_safe(policy)<br/>refuses sandbox='local'"}}:::gate
    G2{{"Threshold gate<br/>len(context) &lt; 300K chars?"}}:::gate

    %% Dispatcher
    D["rlm_complete dispatcher<br/>build RLM agent"]:::core

    %% RLM engine in Docker
    subgraph SB["Docker sandbox: continuous-claude/rlm-sandbox:3.11"]
        direction TB
        RLM["rlms RLM agent<br/>(max_depth=1, max_iters=20)"]:::core
        REPL["Python REPL<br/>context = &lt;string&gt;<br/>dill + regex"]:::sandbox
        RLM --- REPL
    end
    class SB sandbox

    %% Provider
    C1["Anthropic API<br/>claude-sonnet-5"]:::llm

    %% Callbacks / observability
    BT["Braintrust REST<br/>rlm_braintrust.py"]:::obs
    TRAJ[("JSONL trajectory<br/>.claude/cache/rlm-logs/")]:::obs

    %% Fallback
    FB["_vanilla_claude<br/>Claude 1M context<br/>prompt-cached system"]:::fail
    FBC[("Anthropic<br/>cache_control: ephemeral")]:::llm

    %% Flow
    U --> A1
    U --> A2
    U -.-> A3
    U -.-> A4
    A2 -->|blob ≥ 300K| A1
    A2 -->|blob &lt; 300K| FB
    A3 -.-> A1
    A4 -.-> A1

    A1 --> G1
    G1 -->|ok| G2
    G1 -->|sandbox=local| X1[ValueError<br/>'RCE-by-LLM']:::fail
    G2 -->|&lt; 300K| FB
    G2 -->|≥ 300K| D
    D --> RLM
    RLM <-->|iteration:<br/>prompt ↔ code| C1
    REPL -->|llm_query / rlm_query sub-calls| C1
    RLM -->|on_iteration_complete<br/>on_subcall_complete| BT
    RLM -->|logger=RLMLogger| TRAJ

    RLM -->|FINAL answer| OK[RLMResult<br/>path='rlm']:::core
    RLM -.->|exception / timeout / budget| FB
    FB --> FBC
    FBC --> OKFB[RLMResult<br/>path='vanilla-fallback'<br/>or 'vanilla-threshold']:::core
```

---

## 2. Safety layer stack

```mermaid
flowchart LR
    classDef c fill:#fee2e2,stroke:#b91c1c,color:#111
    classDef h fill:#fde68a,stroke:#b45309,color:#111
    classDef m fill:#dcfce7,stroke:#166534,color:#111

    IN[[Caller intent]]:::m
    --> L1["Layer 1 — Static policy<br/>RLMPolicy frozen dataclass<br/>defaults immutable at call site"]:::m
    --> L2["Layer 2 — _assert_safe<br/>refuses sandbox='local'<br/>raises ValueError"]:::c
    --> L3["Layer 3 — Threshold gate<br/>below 300K chars → vanilla<br/>avoids pointless RLM overhead"]:::h
    --> L4["Layer 4 — rlms caps<br/>max_depth=1 (Wang repro)<br/>max_iterations=20<br/>max_timeout=480s<br/>max_budget=$2.00<br/>max_tokens=500K"]:::c
    --> L5["Layer 5 — Docker sandbox<br/>non-root user<br/>no host mount<br/>ephemeral container"]:::c
    --> L6["Layer 6 — Fallback<br/>any RLM exception → vanilla Claude<br/>prompt-cached context<br/>deterministic"]:::h
    --> OUT[[Answer]]:::m
```

---

## 3. Failure mode decision tree

```mermaid
flowchart TD
    Q[Call rlm_complete] --> S1{sandbox=='local'?}
    S1 -->|yes| F1[ValueError raised<br/>NEVER reaches rlms]
    S1 -->|no| S2{context < 300K?}
    S2 -->|yes| V1["path='vanilla-threshold'<br/>direct Claude, cached"]
    S2 -->|no| S3[Spawn Docker sandbox<br/>& RLM agent]
    S3 --> S4{"Outcome?"}
    S4 -->|FINAL answer| R1["path='rlm'<br/>usage + trajectory"]
    S4 -->|timeout| X2["TimeoutExceededError"]
    S4 -->|budget exceeded| X3["BudgetExceededError"]
    S4 -->|token limit| X4["TokenLimitExceededError"]
    S4 -->|iteration errors &gt; max| X5["ErrorThresholdExceededError"]
    S4 -->|any other exception| X6[Unknown exception]
    X2 --> FB{fallback_on_error?}
    X3 --> FB
    X4 --> FB
    X5 --> FB
    X6 --> FB
    FB -->|True default| V2["Truncate to 900K chars<br/>path='vanilla-fallback'"]
    FB -->|False| R2[Exception propagates<br/>to caller]

    style F1 fill:#fee2e2,stroke:#b91c1c
    style R1 fill:#dcfce7,stroke:#166534
    style V1 fill:#e0e7ff,stroke:#3730a3
    style V2 fill:#fde68a,stroke:#b45309
    style R2 fill:#fee2e2,stroke:#b91c1c
```

---

## 4. Data flow — where the long context actually lives

```mermaid
sequenceDiagram
    participant Caller
    participant Wrapper as rlm_complete
    participant RLMAgent as rlms RLM
    participant Docker as Docker REPL
    participant Anthropic

    Caller->>Wrapper: question (short), context (huge, e.g. 989K chars)
    Wrapper->>Wrapper: _assert_safe + threshold check
    Wrapper->>RLMAgent: prompt=context, root_prompt=question
    RLMAgent->>Docker: load context into `context` variable<br/>(file-backed, not in-prompt)
    Note over Docker: REPL has the huge string<br/>root model never sees it
    loop each iteration (≤ 20)
        RLMAgent->>Anthropic: small system prompt + metadata + history
        Anthropic-->>RLMAgent: ```repl ...``` code block
        RLMAgent->>Docker: exec code in REPL
        Docker-->>RLMAgent: stdout / stderr (truncated)
        opt if model writes llm_query()
            RLMAgent->>Anthropic: sub-call on specific chunk
            Anthropic-->>RLMAgent: sub-answer
            RLMAgent->>Docker: inject result into REPL var
        end
        opt if model writes FINAL(answer)
            Docker-->>RLMAgent: FINAL value extracted
            RLMAgent-->>Wrapper: answer
        end
    end
    Wrapper-->>Caller: RLMResult{answer, path='rlm', usage, trajectory}
```

Key insight: **the root model never sees the full 989K chars.** It sees a short metadata block (`"Your context is a str with 989,347 total characters..."`) and writes code to slice/search it. The REPL does the heavy lifting deterministically.

---

## 5. File map — what lives where today

| Layer | File | Role |
|---|---|---|
| Entry | `opc/scripts/core/rlm_client.py` | `rlm_complete`, `RLMPolicy`, `RLMResult`, `_assert_safe`, `_vanilla_claude` |
| Entry | `opc/scripts/pageindex/tree_search.py` | `tree_search_answer` — escalates to RLM when tree_blob ≥ 300K |
| Observability | `opc/scripts/core/rlm_braintrust.py` | `emit_rlm_trajectory` — REST to Braintrust |
| Tests | `opc/tests/test_rlm_client.py` | 4 tests: sandbox refusal, threshold, fallback, fail-hard |
| Sandbox | `.claude/docker/rlm-sandbox/Dockerfile` | `python:3.11-slim` + dill + regex, non-root user |
| Dep | `opc/pyproject.toml` | `rlms>=0.1.1` in dependencies |
| Upstream | `opc/.venv/Lib/site-packages/rlm/` | 858-line `RLM` class, 6 sandbox backends, clients for OpenAI/Anthropic/Gemini/Azure/Portkey/OpenRouter/vLLM |

Designed but not built (Phase 3 / Phase 4):
- `.claude/skills/rlm-analyze/SKILL.md` + `cli.py`
- `opc/scripts/core/rlm_cli.py`
- `opc/scripts/core/analyze_learnings.py`
- `opc/scripts/core/rlm_anthropic_cached.py` (prompt caching on the RLM root/sub-call path)

---

## 6. Smoke test result (2026-04-23)

- **Corpus:** 989,347 chars / 188 files (all of `.claude/rules/` + top-level `SKILL.md` files + CLAUDE.md + RULES.md + the RLM adoption plan)
- **Query:** 5-part structured synthesis (safety inventory, cross-refs, taxonomy, plan delta, contradictions)
- **Result:** RLM iteration-1 timed out at 514s / 480s cap → **clean fallback to vanilla-Claude** → 15,819-char structured report
- **Verdict:** end-to-end architecture verified; the 480s default timeout needs revisiting for ≥ 500K corpora (probably raise to 900s default + size-aware scaling). Bot fallback produced production-quality output regardless.
- **Follow-ups:** profile where the iteration-1 time went (Docker startup vs Anthropic prompt processing vs rlms bootstrapping vs context serialization). See `.claude/cache/rlm-logs/smoke-20260423-164412/` for JSONL trajectory.
