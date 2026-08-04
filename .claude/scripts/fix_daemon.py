#!/usr/bin/env python3
"""Fix memory daemon JSONL matching to use project folder + timestamp."""

with open('core/core/memory_daemon.py', 'r') as f:
    content = f.read()

# 1. Update pg_get_stale_sessions to return started_at
old1 = '''def pg_get_stale_sessions() -> list:
    """Get sessions with stale heartbeat that haven't been extracted."""
    import psycopg2
    conn = psycopg2.connect(get_postgres_url())
    cur = conn.cursor()
    threshold = datetime.utcnow() - timedelta(seconds=STALE_THRESHOLD)
    cur.execute("""
        SELECT id, project FROM sessions
        WHERE last_heartbeat < %s
        AND memory_extracted_at IS NULL
    """, (threshold,))
    rows = cur.fetchall()
    conn.close()
    return rows'''

new1 = '''def pg_get_stale_sessions() -> list:
    """Get sessions with stale heartbeat that haven't been extracted."""
    import psycopg2
    conn = psycopg2.connect(get_postgres_url())
    cur = conn.cursor()
    threshold = datetime.utcnow() - timedelta(seconds=STALE_THRESHOLD)
    cur.execute("""
        SELECT id, project, started_at FROM sessions
        WHERE last_heartbeat < %s
        AND memory_extracted_at IS NULL
    """, (threshold,))
    rows = cur.fetchall()
    conn.close()
    return rows'''

content = content.replace(old1, new1)

# 2. Update sqlite_get_stale_sessions to return started_at
old2 = '''def sqlite_get_stale_sessions() -> list:
    """Get sessions with stale heartbeat that haven't been extracted."""
    db_path = get_sqlite_path()
    if not db_path.exists():
        return []
    conn = sqlite3.connect(db_path)
    threshold = (datetime.now() - timedelta(seconds=STALE_THRESHOLD)).isoformat()
    cursor = conn.execute("""
        SELECT id, project FROM sessions
        WHERE last_heartbeat < ?
        AND memory_extracted_at IS NULL
    """, (threshold,))
    rows = cursor.fetchall()
    conn.close()
    return rows'''

new2 = '''def sqlite_get_stale_sessions() -> list:
    """Get sessions with stale heartbeat that haven't been extracted."""
    db_path = get_sqlite_path()
    if not db_path.exists():
        return []
    conn = sqlite3.connect(db_path)
    threshold = (datetime.now() - timedelta(seconds=STALE_THRESHOLD)).isoformat()
    cursor = conn.execute("""
        SELECT id, project, started_at FROM sessions
        WHERE last_heartbeat < ?
        AND memory_extracted_at IS NULL
    """, (threshold,))
    rows = cursor.fetchall()
    conn.close()
    return rows'''

content = content.replace(old2, new2)

# 3. Update extract_memories to find JSONL by project folder and timestamp
old3 = '''def extract_memories(session_id: str, project_dir: str):
    """Run memory extraction for a session."""
    log(f"Extracting memories for session {session_id} in {project_dir}")

    # Find the most recent JSONL for this session
    jsonl_dir = Path.home() / ".opc-dev" / "projects"
    if not jsonl_dir.exists():
        jsonl_dir = Path.home() / ".claude" / "projects"

    # Look for session JSONL
    jsonl_path = None
    for f in sorted(jsonl_dir.glob("*/*.jsonl"), key=lambda x: x.stat().st_mtime, reverse=True):
        if session_id in f.name or f.stem == session_id:
            jsonl_path = f
            break

    if not jsonl_path:
        log(f"No JSONL found for session {session_id}, skipping")
        return'''

new3 = '''def extract_memories(session_id: str, project_dir: str, started_at=None):
    """Run memory extraction for a session."""
    log(f"Extracting memories for session {session_id} in {project_dir}")

    # Find JSONL by project folder and modification time
    jsonl_dir = Path.home() / ".opc-dev" / "projects"
    if not jsonl_dir.exists():
        jsonl_dir = Path.home() / ".claude" / "projects"

    # Convert project path to folder name (~ -> C--Users-test-user)
    project_folder = project_dir.replace("\\\\", "-").replace("\\", "-").replace("/", "-").replace(":", "-").rstrip("-")
    project_path = jsonl_dir / project_folder

    jsonl_path = None
    if project_path.exists():
        # Find most recent JSONL modified after session started
        jsonl_files = sorted(project_path.glob("*.jsonl"), key=lambda x: x.stat().st_mtime, reverse=True)
        if started_at:
            # Convert started_at to timestamp for comparison
            if isinstance(started_at, str):
                started_ts = datetime.fromisoformat(started_at).timestamp()
            else:
                started_ts = started_at.timestamp()
            # Find JSONL modified after session started
            for f in jsonl_files:
                if f.stat().st_mtime >= started_ts:
                    jsonl_path = f
                    break
        if not jsonl_path and jsonl_files:
            # Fallback: use most recent JSONL
            jsonl_path = jsonl_files[0]

    if not jsonl_path:
        log(f"No JSONL found for session {session_id} in {project_path}, skipping")
        return'''

content = content.replace(old3, new3)

# 4. Update queue_or_extract to pass started_at
old4 = '''def queue_or_extract(session_id: str, project: str):
    """Queue extraction if at limit, otherwise extract immediately."""
    if len(active_extractions) >= MAX_CONCURRENT_EXTRACTIONS:
        pending_queue.append((session_id, project))
        log(f"Queued {session_id} (active={len(active_extractions)}, queue={len(pending_queue)})")
    else:
        extract_memories(session_id, project)'''

new4 = '''def queue_or_extract(session_id: str, project: str, started_at=None):
    """Queue extraction if at limit, otherwise extract immediately."""
    if len(active_extractions) >= MAX_CONCURRENT_EXTRACTIONS:
        pending_queue.append((session_id, project, started_at))
        log(f"Queued {session_id} (active={len(active_extractions)}, queue={len(pending_queue)})")
    else:
        extract_memories(session_id, project, started_at)'''

content = content.replace(old4, new4)

# 5. Update pending_queue type hint
old5 = 'pending_queue: list[tuple[str, str]] = []  # [(session_id, project), ...]'
new5 = 'pending_queue: list[tuple[str, str, any]] = []  # [(session_id, project, started_at), ...]'
content = content.replace(old5, new5)

# 6. Update process_pending_queue to pass started_at
old6 = '''def process_pending_queue():
    """Spawn extractions from queue if under concurrency limit."""
    spawned = 0
    while pending_queue and len(active_extractions) < MAX_CONCURRENT_EXTRACTIONS:
        session_id, project = pending_queue.pop(0)
        log(f"Dequeuing {session_id} (queue remaining: {len(pending_queue)})")
        extract_memories(session_id, project)
        spawned += 1
    return spawned'''

new6 = '''def process_pending_queue():
    """Spawn extractions from queue if under concurrency limit."""
    spawned = 0
    while pending_queue and len(active_extractions) < MAX_CONCURRENT_EXTRACTIONS:
        session_id, project, started_at = pending_queue.pop(0)
        log(f"Dequeuing {session_id} (queue remaining: {len(pending_queue)})")
        extract_memories(session_id, project, started_at)
        spawned += 1
    return spawned'''

content = content.replace(old6, new6)

# 7. Update daemon_loop to unpack started_at
old7 = '''            # Find new stale sessions
            stale = get_stale_sessions()
            if stale:
                log(f"Found {len(stale)} stale sessions")
                for session_id, project in stale:
                    queue_or_extract(session_id, project or "")
                    mark_extracted(session_id)'''

new7 = '''            # Find new stale sessions
            stale = get_stale_sessions()
            if stale:
                log(f"Found {len(stale)} stale sessions")
                for session_id, project, started_at in stale:
                    queue_or_extract(session_id, project or "", started_at)
                    mark_extracted(session_id)'''

content = content.replace(old7, new7)

with open('core/core/memory_daemon.py', 'w') as f:
    f.write(content)

print("All changes applied!")
