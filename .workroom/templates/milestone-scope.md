# M<N> — <one-line scope>

**Room:** `<room-id>` · **Builder:** grok (default) · **Requirements:** R<n>, R<m>

## Scope

What this milestone builds. Small enough for one implement run + one review booth.

## In-scope files

Exact paths (must fall within ROOM.yaml `file_scopes`).

## Out of scope

What the builder must NOT touch, even if tempting.

## Acceptance (hub smoke)

Exact commands the hub runs, with expected exit codes / outputs. The builder's own
"tests passed" is not acceptance.

```bash
# example
cd .claude/hooks && npx vitest run src/__tests__/<test>.ts   # expect exit 0
```

## Notes for builder

Constraints, gotchas, links to CONTRACT sections.
