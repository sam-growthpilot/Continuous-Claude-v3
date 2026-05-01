# Memory Subsystem

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MEMORY LAYER                            │
├─────────────────────────────────────────────────────────────┤
│  recall_learnings.py  →  Search stored learnings            │
│  store_learning.py    →  Persist new learnings              │
│  lazy_memory.py       →  Auto-extract at SessionEnd         │
│  EmbeddingService     →  BGE-large embeddings (1024d)       │
└─────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│  PostgreSQL + pgvector                                      │
│  └─ archival_memory table                                   │
│     Top-level columns:                                      │
│       id (uuid), session_id, agent_id, content,             │
│       embedding (vector 1024), created_at,                  │
│       project_id, scope (PROJECT|GLOBAL)                    │
│     metadata (jsonb) holds:                                  │
│       type, tags, confidence, context, source, ...          │
└─────────────────────────────────────────────────────────────┘
```

## Commands

### Recall Learnings
```bash
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py \
  --query "search terms" \
  --k 5              # number of results
  --text-only        # fast, no embeddings
  --vector-only      # pure semantic search
```

### Store Learning
```bash
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/store_learning.py \
  --session-id "identifier" \
  --type WORKING_SOLUTION \
  --content "what you learned" \
  --context "what it relates to" \
  --tags "tag1,tag2" \
  --confidence high
```

## Learning Types

| Type | Use For |
|------|---------|
| `WORKING_SOLUTION` | Fixes, approaches that worked |
| `FAILED_APPROACH` | What didn't work (avoid repeating) |
| `ARCHITECTURAL_DECISION` | Design choices, rationale |
| `ERROR_FIX` | How specific errors were resolved |
| `CODEBASE_PATTERN` | Patterns discovered in code |
| `USER_PREFERENCE` | User's preferred approaches |
| `OPEN_THREAD` | Incomplete work to resume |

## Search Modes

| Mode | Flag | Score Range | Best For |
|------|------|-------------|----------|
| Hybrid RRF | (default) | 0.01-0.03 | General queries |
| Hybrid + PageIndex | `--hybrid` | varies | Best accuracy (recommended) |
| PageIndex-only | `--pageindex` | varies | Large structured docs |
| Vector | `--vector-only` | 0.4-0.6 | Semantic similarity |
| Text | `--text-only` | 0.01-0.05 | Keyword matching |

Note: Low RRF scores (0.02) are normal - it's a ranking fusion, not similarity.

### PageIndex Integration

```bash
# Hybrid search (best accuracy)
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "topic" --hybrid

# PageIndex only (large docs)
cd $CLAUDE_OPC_DIR && PYTHONPATH=. uv run python scripts/core/recall_learnings.py --query "topic" --pageindex
```

## Integration Points

| Hook | Purpose |
|------|---------|
| memory-awareness | Injects relevant memories into context |
| memory-extractor | Extracts learnings from session thinking |
| git-memory-check | Checks memory before destructive git commands |
| smarter-everyday | Detects problem resolution patterns |
| user-confirmation-detector | Captures "it's fixed" signals |

## DATABASE_URL Priority

The system loads DATABASE_URL in this order:
1. `opc/.env` (authoritative - uses override=True)
2. Shell environment variables
3. `~/.claude/.env` (supplements only)

## Database Access

```bash
# Direct query (debug only)
docker exec continuous-claude-postgres psql -U claude -d continuous_claude -c \
  "SELECT id, type, content FROM archival_memory ORDER BY created_at DESC LIMIT 5;"
```

## When to Use

| Situation | Action |
|-----------|--------|
| Starting similar task | Recall first |
| Solved tricky problem | Store immediately |
| Made design decision | Store with rationale |
| Found what doesn't work | Store as FAILED_APPROACH |

## Deep Dive

For comprehensive documentation with Mermaid diagrams and full data flows:
→ `~/continuous-claude/docs/memory-architecture.md`
