---
name: memory
description: Canonical reference for querying and storing learnings in the persistent memory system. Use when users request recall of prior work, want to store a learning, ask "what did we do before with X", or when starting implementation similar to past sessions. Covers CLI commands, backend architecture, score interpretation, quality bar, learning types, scope tagging, and when sub-agents should recall. Consolidates content previously split across dynamic-recall, proactive-learning, memory-usage-guidelines, and agent-memory-recall rules.
metadata:
  user-invocable: true
---

# Memory System

Unified interface for storing and retrieving learnings across sessions. This skill is the canonical source — the rule files `dynamic-recall.md`, `proactive-learning.md`, `memory-usage-guidelines.md`, and `agent-memory-recall.md` are short pointer stubs that reference this document.

## When to Use

Trigger signals:
- "What did we do before with X?"
- "Remember this for next time"
- Starting implementation similar to past work
- Debugging an error that may have been solved before
- Making an architectural or design decision
- Discovering a recurring codebase pattern
- User corrects a behavior or states a preference
- Approach fails and is worth flagging for future sessions

Agents (kraken, architect, phoenix, spark) should consider recall before beginning implementation tasks, especially when working on hooks, skills, wizard code, or features similar to prior work.

---

## Recall: Query the Archival Memory

### Quick Invocation

```
/recall <query>
```

Or direct CLI (use this form from agent context where slash commands are not available):

```bash
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "your search terms"
```

**IMPORTANT:** Always run from the `opc/` directory (via `$CLAUDE_OPC_DIR`) so the correct environment variables load. From slash-command context, `$CLAUDE_PROJECT_DIR/opc` is equivalent.

### When to Recall

Query memory proactively when:
- Starting work on something that may have been done before
- Encountering an error or tricky situation
- Making architectural or design decisions
- Looking for patterns or approaches that worked previously
- Before storing a new learning (dedup check)

If the memory-awareness hook showed a `MEMORY MATCH` in session context, the learning is likely relevant — follow up with a full `/recall` to get complete content instead of the preview.

### Options

```bash
# Default: Hybrid RRF search (text + vector combined) — RECOMMENDED
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "authentication patterns"

# More results
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "error handling" --k 10

# Pure vector search (higher similarity scores, 0.4-0.6 range)
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "database schema" --vector-only

# Text-only search (fast, no embeddings)
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "YAML format" --text-only
```

| Flag | Description |
|------|-------------|
| `--k N` | Return N results (default: 5) |
| `--vector-only` | Pure vector search (higher precision, slower) |
| `--text-only` | Text search only (fast, no embeddings) |

### Backend Architecture

| Backend | Location | Status |
|---------|----------|--------|
| PostgreSQL (primary) | Via `DATABASE_URL` | Has 100+ real learnings with BGE embeddings |
| SQLite (fallback) | `~/.claude/cache/memory.db` | May be empty — don't rely on it |

**DO NOT manually inspect databases** — use the recall script. It auto-selects the correct backend.

Embedding details: entries have BGE embeddings (default `bge-large-en-v1.5`, 1024-dim). The dimension is configurable via `EMBEDDING_DIMENSION` env var.

### Understanding Scores

| Search Mode | Score Range | Interpretation |
|-------------|-------------|----------------|
| Hybrid RRF (default) | 0.01 – 0.03 | Normal — RRF combines rankings |
| Pure vector | 0.4 – 0.6 | Cosine similarity |
| Text search | 0.01 – 0.05 | BM25 normalized |

**Low RRF scores (0.02) are good results** — do not confuse with low relevance. RRF is a ranking fusion metric, not a similarity score.

### What's Stored

The `archival_memory` table contains:
- **What worked** — successful approaches and solutions
- **What failed** — pitfalls to avoid
- **Decisions** — architectural choices and rationale
- **Patterns** — reusable approaches

### Output Format

```
## Memory Recall: "<query>"

### 1. [TYPE] (confidence: high, id: abc123)
<full content>

### 2. [TYPE] (confidence: medium, id: def456)
<full content>
```

### Example Queries

- `hook development patterns` — find past hook implementations
- `TypeScript type errors` — recall how similar errors were fixed
- `database migration` — find migration patterns used before
- `test failures pytest` — recall debugging approaches
- `YAML handoff format` — recall format decisions

---

## Store: Capture Learnings

### When to Store (Proactive Triggers)

Manual stores should be **rare and high-value**. 98% of entries are auto-extracted by hooks — only store manually when the insight will not be captured automatically.

Store learnings immediately when:

| Trigger | Example | Type |
|---------|---------|------|
| Fix non-trivial bug | 3+ attempts or multi-file fix | `ERROR_FIX` |
| Architectural decision | Chose X over Y with reasoning | `ARCHITECTURAL_DECISION` |
| Discover codebase pattern | Recurring structure across files | `CODEBASE_PATTERN` |
| Approach fails | Tried X, didn't work | `FAILED_APPROACH` |
| User corrects behavior | "I prefer Y" / "Don't do X" | `USER_PREFERENCE` |
| Windows-specific gotcha | Platform issue with concrete workaround | `WORKING_SOLUTION` |

Store at the moment of insight, not as post-processing. After completing debugging or multi-file changes, ask: **"Is there something here worth remembering for next time?"** If yes, store immediately while context is fresh.

### When NOT to Store

- Trivial fixes (<3 lines, obvious solution)
- Information already in `CLAUDE.md`, `RULES.md`, or any `.claude/rules/` file
- Generic programming knowledge (everyone knows)
- Test data or verification entries
- Session status updates ("started working on X")
- Plan fragments or task lists (use task files instead)

### Quality Bar

**GOOD** — specific, actionable, non-obvious:

```
Type: ERROR_FIX
Content: "Hook context injection fails with PreToolUse — additionalContext is ignored.
         Use PostToolUse with hookSpecificOutput.additionalContext instead.
         Confirmed in: path-rules-hook-fix, react-perf-hook-fix."
Tags: hooks,context-injection,scope:global
Confidence: high
```

**BAD** — generic, no actionable insight:

```
Type: CODEBASE_PATTERN
Content: "The project uses TypeScript"
Tags: typescript
Confidence: medium
```

Ask before storing: "Would a future session actually benefit from this, or can they find it in 10 seconds?"

**L0 quality gate:** The extraction pipeline auto-blocks NOISE entries (quality score <3) before they reach PostgreSQL. If a learning does not appear in recall, the quality scorer may have filtered it — this is intentional.

### Recall Before Storing

Always check for duplicates first:

```bash
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py \
  --query "<topic>" --k 3 --text-only
```

If a similar entry exists at high confidence, skip the store.

### Store Command

```bash
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/store_learning.py \
  --session-id "<short-identifier>" \
  --type <TYPE> \
  --content "<what you learned>" \
  --context "<what it relates to>" \
  --tags "tag1,tag2,scope:global|scope:project" \
  --confidence high|medium|low
```

**IMPORTANT:** Use `cd <absolute-path>` — not the subshell form `(cd opc && ...)`. The subshell form can cause path-doubling errors.

### Learning Types

| Type | Use For |
|------|---------|
| `WORKING_SOLUTION` | Fix or approach that worked (default) |
| `ERROR_FIX` | How a specific error was resolved |
| `CODEBASE_PATTERN` | Recurring structure in this codebase |
| `FAILED_APPROACH` | What didn't work (avoid repeating) |
| `ARCHITECTURAL_DECISION` | Design choice with rationale |
| `USER_PREFERENCE` | User's stated preferences |
| `OPEN_THREAD` | Incomplete work to resume later |

### Auto-Type Detection (for `/remember`)

If no `--type` is specified via `/remember`, the type is inferred from content:

- Contains "error", "fix", "bug" → `ERROR_FIX`
- Contains "decided", "chose", "architecture" → `ARCHITECTURAL_DECISION`
- Contains "pattern", "always", "convention" → `CODEBASE_PATTERN`
- Contains "failed", "didn't work", "don't" → `FAILED_APPROACH`
- Default → `WORKING_SOLUTION`

### Scope Detection

| Content Signals | Scope | Tag |
|-----------------|-------|-----|
| File paths, "this codebase", specific modules | Project | `scope:project` |
| "In general", "always", generic patterns | Global | `scope:global` |
| Mixed or unclear | Default to project | `scope:project` |

### Use `/remember` for Interactive Storage

Short form:

```
/remember <what you learned>
```

With explicit type:

```
/remember --type WORKING_SOLUTION <what you learned>
/remember --type ARCHITECTURAL_DECISION Session affinity uses terminal PID
/remember --type FAILED_APPROACH Don't use subshell for store_learning command
```

`/remember` wraps the store command, sets `session-id` to `manual-$(date +%Y%m%d-%H%M)`, and annotates context as `manual entry via /remember`.

Use `/memory-curate` to audit and prune low-value entries.

---

## Recall Reasoning (Artifact Index)

Search the artifact index for handoffs, plans, and post-mortems — distinct from `archival_memory` queries.

### When to Use

- Find what worked or failed in past sessions
- Look up architectural decisions tied to specific handoffs
- Review post-mortems from completed work

### Usage

```bash
uv run python scripts/artifact_query.py "<query>" [--outcome SUCCEEDED|FAILED] [--limit N]
```

### Interpreting Results

- `✓` = `SUCCEEDED` (follow this pattern)
- `✗` = `FAILED` (avoid this pattern)
- `?` = `UNKNOWN` (not yet marked)

---

## Examples

**Example 1: Recall before starting similar work**

```bash
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py \
  --query "hook development patterns" --k 3 --text-only
```

**Example 2: Store a tricky bug fix**

```bash
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/store_learning.py \
  --session-id "hook-debugging" \
  --type ERROR_FIX \
  --content "TypeScript hooks fail silently if dist/ doesn't exist. Always run npm run build after editing src/." \
  --context "hook development" \
  --tags "hooks,typescript,build,scope:global" \
  --confidence high
```

**Example 3: Store a codebase pattern**

```bash
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/store_learning.py \
  --session-id "codebase-exploration" \
  --type CODEBASE_PATTERN \
  --content "All session hooks use shared/types.ts for input/output interfaces. Import from './shared/types.js' in dist." \
  --context "hook development patterns" \
  --tags "hooks,patterns,scope:project" \
  --confidence high
```

**Example 4: Search artifact index for successful auth work**

```bash
uv run python scripts/artifact_query.py "authentication OAuth" --outcome SUCCEEDED
```

**Example 5: Sub-agent recall before implementation**

```bash
# kraken / architect / phoenix / spark runs this before touching code
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py \
  --query "<task keywords>" --k 3 --text-only
```

---

## Memory Architecture Summary

| Component | Purpose |
|-----------|---------|
| PostgreSQL | Primary storage with pgvector |
| BGE Embeddings | 1024-dim vectors (`bge-large-en-v1.5`) |
| Hybrid Search | RRF combining text + vector |
| Artifact Index | Handoffs/plans with post-mortems |
| L0 Quality Gate | Auto-blocks NOISE entries (score <3) |
| `EMBEDDING_DIMENSION` | Env var to configure vector dimension |

---

## Proactive Memory Usage

- Before starting work: `/recall <task keywords>`
- After solving problems: `/remember <what worked and why>`
- Before similar tasks: check the artifact index for past approaches that succeeded or failed
- After a correction from the user: store as `USER_PREFERENCE` or `FAILED_APPROACH`
