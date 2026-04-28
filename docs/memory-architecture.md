# Continuous Claude Memory System - Architecture

## Overview

The Continuous Claude memory system provides persistent learning, cross-session awareness, and knowledge navigation for Claude Code sessions.

## Architecture Diagram

```mermaid
flowchart TB
    subgraph User["👤 User Session"]
        CC[Claude Code CLI]
    end

    subgraph Hooks["🪝 Hooks Layer (.claude/hooks/)"]
        direction TB
        H1[session-register.ts<br/>SessionStart]
        H2[session-start-init-check.ts<br/>SessionStart]
        H3[memory-awareness.ts<br/>UserPromptSubmit]
        H4[file-claims.ts<br/>PreToolUse:Edit]
        H5[pre-compact-continuity.ts<br/>PreCompact]
        H6[tree-invalidate.ts<br/>PostToolUse:Edit]
        H7[lazy_memory.py<br/>SessionEnd]
    end

    subgraph PostgreSQL["🐘 PostgreSQL (Docker)"]
        direction TB
        T1[(sessions<br/>id, project, working_on,<br/>last_heartbeat)]
        T2[(archival_memory<br/>content, metadata,<br/>embedding vector 1024)]
        T3[(file_claims<br/>file_path, session_id,<br/>claimed_at)]
        T4[(handoffs<br/>goal, what_worked,<br/>what_failed, embedding)]
    end

    subgraph Embeddings["🧠 Embedding System"]
        BGE[BGE-large-en-v1.5<br/>1024 dimensions<br/>Local inference]
    end

    subgraph Scripts["📜 Python Scripts (opc/scripts/core/)"]
        direction TB
        S1[recall_learnings.py<br/>Hybrid RRF Search]
        S2[store_learning.py<br/>Store with Embeddings]
        S3[artifact_index.py<br/>Index Handoffs/Plans]
    end

    subgraph KnowledgeTree["🌳 Knowledge Tree System"]
        direction TB
        KT1[knowledge_tree.py<br/>Generate Tree]
        KT2[query_tree.py<br/>Query Tree]
        KT3[lazy_tree.py<br/>On-demand wrapper]
    end

    subgraph LocalFiles["📁 Local Files"]
        direction TB
        F1[.claude/knowledge-tree.json<br/>Project Structure Map]
        F2[ROADMAP.md<br/>Goals & Planning]
        F3[.claude/cache/session_id<br/>Current Session]
        F4[.claudedocs/handoffs/<br/>Task Completions]
    end

    subgraph SQLite["💾 SQLite (Offline Cache)"]
        SQ1[(context.db<br/>handoffs, plans,<br/>continuity + FTS5)]
    end

    %% Session Start Flow
    CC -->|"1. Start"| H1
    CC -->|"1. Start"| H2
    H1 -->|"INSERT"| T1
    H1 -->|"SELECT peers"| T1
    H1 -->|"Write"| F3
    H2 -->|"Regen if stale/missing"| KT1

    %% Tree Regen Flow (no daemon -- on demand)
    CC -->|"3. Edit"| H6
    H6 -->|"Mark stale"| F1
    KT1 -->|"Write"| F1
    KT1 -->|"Parse"| F2

    %% Memory Awareness Flow
    CC -->|"2. Prompt"| H3
    H3 -->|"Embed query"| BGE
    H3 -->|"Search"| T2
    H3 -->|"Inject context"| CC

    %% File Claims Flow
    CC -->|"3. Edit"| H4
    H4 -->|"Check/Claim"| T3

    %% Learning Storage Flow
    S2 -->|"Embed"| BGE
    S2 -->|"INSERT"| T2
    BGE -->|"1024-dim vector"| T2

    %% Learning Recall Flow
    S1 -->|"Text Search"| T2
    S1 -->|"Vector Search"| T2
    S1 -->|"Hybrid RRF"| CC

    %% Handoff Flow
    CC -->|"4. Compact"| H5
    H5 -->|"Create"| F4
    H5 -->|"INSERT"| T4
    S3 -->|"Index"| SQ1
    S3 -->|"Read"| F4

    %% Memory Extraction Flow (no persistent daemon -- runs at session end)
    CC -->|"5. SessionEnd"| H7
    H7 -->|"Extract learnings"| S2
    S2 -->|"INSERT via store_learning_v2"| T2

    %% Query Tree Flow
    KT2 -->|"Read"| F1
    KT2 -->|"Return locations"| CC
```

## Component Details

### PostgreSQL Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| **sessions** | Cross-terminal coordination | id, project, working_on, last_heartbeat |
| **archival_memory** | Semantic learnings (1024-dim BGE embeddings) | content, metadata, embedding, scope |
| **file_claims** | Prevent concurrent edits | file_path, session_id, claimed_at |
| **handoffs** | Task completions with embeddings | goal, what_worked, what_failed, outcome |

### Hooks

| Hook | Event | Action |
|------|-------|--------|
| **session-register** | SessionStart | Register in PostgreSQL, detect peers |
| **session-start-init-check** | SessionStart | Regenerate knowledge-tree.json if missing/stale |
| **memory-awareness** | UserPromptSubmit | Search learnings, inject relevant context |
| **tree-invalidate** | PostToolUse:Edit | Mark knowledge-tree.json stale on file changes |
| **file-claims** | PreToolUse:Edit | Check/claim file locks |
| **pre-compact-continuity** | PreCompact | Create handoff documents |
| **lazy_memory** | SessionEnd | Extract session learnings, persist via store_learning_v2 |

### On-demand workers (no persistent daemons)

The earlier design called for `memory_daemon.py` (poll-based learning extraction) and `tree_daemon.py` (file-watch knowledge tree updates). Neither was built; both are replaced by the on-demand hooks above:

- Memory: `lazy_memory.py` runs once at session end (much cheaper than 60s polling)
- Tree: `tree-invalidate` marks stale on edit; `session-start-init-check` regenerates on read

### Search System

**Hybrid RRF (Reciprocal Rank Fusion):**
```
score = 1/(60 + text_rank) + 1/(60 + vector_rank)
```
- Text search: BM25 via pg_trgm
- Vector search: Cosine similarity via pgvector
- Embeddings: BGE-large-en-v1.5 (1024 dimensions, local)

### Knowledge Tree

| File | Purpose |
|------|---------|
| **knowledge-tree.json** | Project structure, components, navigation hints |
| **ROADMAP.md** | Current goals, completed items, planned work |

## Data Flows

### A. Session Start
```
Claude starts → session-register → INSERT sessions → SELECT peers → Inject "Peer sessions" message
             → session-start-init-check → If knowledge-tree.json missing/stale → Run knowledge_tree.py
```

### B. User Prompt
```
User submits prompt → memory-awareness hook → Embed query (BGE) → Search archival_memory (Hybrid RRF)
                   → If matches found → Inject "MEMORY MATCH" context
```

### C. File Edit
```
User edits file → file-claims hook → SELECT file_claims → If claimed by other → Warning
                                                       → Else → INSERT claim
```

### D. Context Compact
```
Context limit reached → pre-compact-continuity → Create YAML handoff → INSERT handoffs
                     → artifact_index.py → Index to SQLite (offline cache)
```

### E. Learning Storage
```
Claude discovers pattern → store_learning.py → Classify scope (PROJECT/GLOBAL)
                        → Embed (BGE-1024) → Dedupe (0.85 cosine threshold)
                        → INSERT archival_memory
```

### F. Learning Recall
```
recall_learnings.py --query "X" → Text search (BM25) + Vector search (cosine)
                               → Hybrid RRF fusion → Return top K
```

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `DATABASE_URL` | PostgreSQL connection | postgresql://claude:claude_dev@localhost:5432/continuous_claude |
| `CLAUDE_OPC_DIR` | Scripts location | ~/continuous-claude/opc |
| `CLAUDE_PROJECT_DIR` | Current project | $PWD |

## File Locations

| Component | Path |
|-----------|------|
| Hooks (source) | .claude/hooks/src/*.ts |
| Hooks (compiled) | .claude/hooks/dist/*.mjs |
| Scripts | opc/scripts/core/*.py |
| Knowledge tree | {project}/.claude/knowledge-tree.json |
| Goals | {project}/ROADMAP.md |
| Session ID | .claude/cache/session_id |
| Handoffs | .claudedocs/handoffs/*.yaml |
| SQLite cache | .claude/cache/context-graph/context.db |
| PostgreSQL schema | docker/init-schema.sql |
