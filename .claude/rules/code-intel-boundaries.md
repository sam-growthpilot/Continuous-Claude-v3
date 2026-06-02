# Code-Intel L3 Specialist Boundaries

Canonical boundary doc for the WS-2 "Cohesive Intelligence" model (v3 design §3). Each L3 specialist owns ONE query type; they escalate rather than overlap. This is the routing contract the `/code-intel` facade (Phase B) and the context bus (`shared/context-bus.ts`, Phase A) are built around.

**Phase A status:** the L2 context bus is **substrate-only** — built, atomic, observable, kill-switchable, but wired to NO production consumer yet. Specialist routing through the facade is Phase B. This doc is the contract those phases implement.

## L3 specialist table (§3 verbatim)

| Specialist | Owns this query type | Escalates to | Substrate (L1) |
|------------|---------------------|--------------|----------------|
| **codegraph** | "Find symbol X" / "Who calls X" / "Code context for topic Z" — broad, fast, FTS-first | Serena (precision) | `.codegraph/codegraph.db` per project |
| **Serena** | "Resolve symbol through aliases" / "Rename X safely" / LSP truth | terminal authority | `.serena/` per project |
| **TLDR** | "Control/data flow inside X" / dead code / pyright·ruff / selective tests | codegraph (cross-function calls) | none (recomputed per call) |
| **ast-grep** | "Find-and-replace this AST pattern" | terminal authority | none |
| **archival_memory** | "Have we solved this before?" | terminal authority | Postgres `archival_memory` |
| **PageIndex** | "Find relevant section in this long doc" | none | Postgres `pageindex_*` |
| **knowledge-tree** | "Where in this project do API routes live?" — directory-level orientation | none | `.claude/knowledge-tree.json` |
| **Notion Bridge** | "What did Eve say?" / "What's queued?" | none | Notion HQ page |

## Conflict resolutions (§3)

- **codegraph + Serena** — broad survey first, then Serena's precise final word (rank-based escalation; Serena is terminal authority on symbol identity).
- **codegraph + TLDR `impact`** — codegraph owns symbol-callers; TLDR keeps `cfg`/`dfg`/`slice`/`dead`/`diagnostics`.
- **TLDR `search`** — deprecated for symbol search (codegraph owns it).

## Operational notes (2026-06-01)

- **PageIndex is on-demand only.** The per-prompt `pageindex-navigator` hook was disabled 2026-06-01 (Item 6 — telemetry showed 0/16 query-hits at 1.8–15.8s/prompt). The homegrown pillar (`opc/scripts/pageindex/`, ~4.8K LOC + Postgres `pageindex_*`) and `pageindex-watch` remain; invoke the CLI deliberately for long-doc section search. It does NOT fire on every prompt.
- **Bus id vs coordination session id (finding #15).** `shared/session-bus-id.ts` `getBusId()` is the bus-scoped identity — `<sessionId>-<sha256(realpath(cwd).toLowerCase())[:12]>`, Windows-correct (`USERPROFILE`, realpath hash, not inode). It is a SECOND function, NOT a merge: coordination callers (`session-register.ts` / `file-claims.ts`) keep their existing `COORDINATION_SESSION_ID`-first chain in `shared/session-id.ts` untouched. Only bus callers use `getBusId()`.
- **Single-writer rule (§4).** Hooks (and only hooks) write the bus, via `shared/context-bus.ts` (`mutateBus`). L3 specialists READ the bus to bias queries and return *proposed* updates to the facade; they never write L2 directly (§13 Q2). There is no direct `fs.writeFileSync` to the bus path anywhere else.
