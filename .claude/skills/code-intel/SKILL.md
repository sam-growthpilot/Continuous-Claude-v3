---
name: code-intel
description: Unified code-intelligence facade. Routes a query to the right L3 specialist (codegraph/Serena/TLDR/ast-grep/archival memory/context bus) per the boundary contract, degrading honestly when a specialist is MCP-only or absent. Use when you want "who calls X", "find symbol X", "control/data flow in X", "have we solved this before", an ast-grep rewrite preview, or to read the session context bus -- and you want one typed entry point instead of remembering which tool owns which query. Triggers on "/code-intel", "code intel", "who calls", "find symbol", "code context", "rename preview", "read the bus".
---

# /code-intel facade

A single, stateless CLI that routes a code-intelligence query to the correct L3 specialist
defined in `.claude/rules/code-intel-boundaries.md`, instead of you having to remember which
tool owns which query. It is a **manual CLI** (Phase B ships it inert; no hook forces its use).

```
node scripts/code-intel.mjs <subcommand> [args...] [--bus <id>] [--k <n>] [--text-only]
```

Every response is one JSON object on stdout:

```json
{ "success": true, "backend": "tldr", "routing_reason": "...", "escalated_from": "codegraph",
  "result": { ... }, "bus_id": "...", "discovery": "most-recent" }
```

Unknown/ambiguous subcommands return `{ "success": false, "clarify": true, "supported": [...] }`
(it never guesses a backend).

## Subcommands

| Subcommand | Routes to | Notes |
|---|---|---|
| `flow <file> <fn>` | **TLDR** (`tldr cfg`) | Control/data flow inside a function. Clean owner. |
| `who-calls <fn> [path]` | **TLDR** (`tldr impact`) | codegraph is absent (Phase C) -> falls back to TLDR; `escalated_from:"codegraph"`. |
| `find-symbol <name> [path]` | **TLDR** (`tldr search`) | codegraph absent + Serena MCP-only -> TLDR fallback. For precise symbol identity (alias resolution), escalate to **Serena** (`find_symbol`) -- the routing_reason says so. |
| `code-context <topic>` | **TLDR + archival memory** | `tldr structure .` + `recall` (FTS); reports both. |
| `recall <query>` | **archival memory** | `recall_learnings.py --json`. "Have we solved this before." |
| `rename-preview <pattern> [replacement]` | **ast-grep** | ast-grep is MCP-only here -> returns the exact **guidance** invocation (run via the ast-grep MCP / `ast-grep-find` skill). Never executes, never crashes. |
| `bus [--bus <id>]` | **context bus** | Read-only view of the discovered session `context.json` (focus_symbols, files_in_play, current_intent). |
| `help` | -- | Lists subcommands. |

## When to use `/code-intel` vs the raw tool

- **Reach for `/code-intel`** when you want one typed entry point and an explicit
  `routing_reason`/`escalated_from` so the answer is self-documenting -- especially for
  "who calls X", "find symbol X", "flow of X", "have we solved this before".
- **Go straight to Serena** (`find_symbol`, `find_referencing_symbols`, `rename_symbol`) when you
  need **LSP-precise** symbol identity or a safe rename -- Serena is the terminal authority and is
  MCP-only (the facade can only point you at it). `/code-intel find-symbol` is the broad, fast,
  FTS-first first pass; Serena is the precise final word.
- **Go straight to TLDR** when you already know you want a specific TLDR view
  (`tldr cfg/dfg/slice/dead/diagnostics`) -- the facade just wraps these for `flow`/`who-calls`.
- **Go straight to the ast-grep MCP / `ast-grep-find` skill** to actually run a rewrite; the
  facade's `rename-preview` only returns the invocation.
- **Use grep** for a literal text scan that isn't about symbols/flow/precedent.

## Routing / escalation / clarify contract

- **codegraph is absent** (no `.codegraph/`, Phase C). Any query that would ideally hit codegraph
  (`who-calls`, `find-symbol`, `code-context`) falls back to TLDR with `escalated_from:"codegraph"`.
- **ast-grep + Serena are MCP-only.** The facade cannot shell them out: `rename-preview` returns
  guidance; `find-symbol` names Serena as the precision escalation in `routing_reason`.
- **Ambiguous/unknown input never guesses** -- it returns `clarify:true` with the `supported` list.
- **Every executed call appends one telemetry row** to `.claude/logs/intel-bus.jsonl`
  (facade/specialist/query_type/result_count/duration_ms/correlation_id). The facade **reads** the
  context bus to bias ranking (focus_symbols bubble to the top, client-side -- no query mutation)
  but **never writes L2** (the context bus); only hooks write it (single-writer rule).

## Bus discovery

`bus`/`recall`/`code-context` discover the session bus in this order:
1. `--bus <id>` (explicit),
2. `COORDINATION_SESSION_ID` + project hash (env-derived),
3. most-recently-modified `<project>/.claude/cache/session/*/context.json`
   (warns when more than one session is present -- pass `--bus` to disambiguate).

## Kill switch

`CCV3_BUS_OFF=1` disables **both** the bus read (focus bias) and the telemetry append. The facade
still routes and returns results; it just runs bus-blind. All bus I/O is fail-open -- a missing or
corrupt bus never crashes a query.

## See also

- `.claude/rules/code-intel-boundaries.md` -- the L3 specialist routing contract this facade implements.
- `.claude/skills/serena/SKILL.md`, `.claude/rules/tldr-cli.md`, `.claude/skills/ast-grep-find` -- the underlying specialists.
