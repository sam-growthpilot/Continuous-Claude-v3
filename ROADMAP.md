# Project Roadmap

## Current Focus
First-time setup of this fork. Nothing else in flight yet.

## Completed
- [x] Fork personalized — prior maintainer's project history, employer-specific skills, and machine-specific paths removed

## Planned
- [ ] Run the setup wizard (`cd opc && uv run python -m scripts.setup.wizard`)
- [ ] Verify hooks compile and register (`ls ~/.claude/hooks/dist/*.mjs`)
- [ ] Confirm the memory system responds (needs Docker + Postgres + pgvector)
- [ ] Refresh model references — this fork predates Opus 5 / Sonnet 5

## Notes
- `origin` = `sam-growthpilot/Continuous-Claude-v3` — your fork; push here.
- `upstream` = the fork this was derived from — reference only, never push.
- Never change the embedding model/dim without re-indexing: `BAAI/bge-large-en-v1.5`, 1024.

## Recent Planning Sessions
_None yet._
