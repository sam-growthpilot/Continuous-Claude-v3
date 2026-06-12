# Codex Pass 2 — Independent Security Audit Scope (shell-flow / injection surfaces)

You are a cross-model (gpt-5.5) security auditor reviewing the CCv3 Claude Code customization at git SHA `86b8f60`. This is a READ-ONLY audit of EXISTING code (not a diff). A Claude-family review already ran; your value is the findings it MISSED or got WRONG (different training family = different blind spots). Shell-string quoting on Windows cmd.exe is the proven Claude blind class.

## Audit target: every spawn / exec / shell-string / env / prompt-to-arg flow

Independently inspect these surfaces (repo-relative; read them yourself, do not trust this list's framing):

### Confirmed injection family (verify these are real AND find siblings the Claude panel missed)
- `.claude/hooks/src/agent-error-capture.ts` — builds a `store_learning.py` shell command from agent error text (lines ~144, ~172-184: `escapedContent = content.replace(/"/g,'\\"')...` then `execSync("cd ... && uv run python ... --content \"${escapedContent}\" ...")`). Claimed root of "junk-creator" (D5a-01, D2d-06, D3a-01).
- `.claude/hooks/src/user-confirmation-detector.ts` — `execSync` store_learning with the USER PROMPT interpolated (D2c-04), `shell:true`, timeout 60000.
- `.claude/hooks/src/hook-error-pipeline.ts` — same store_learning execSync class (D2d-06).
- `.claude/hooks/src/shared/smart-search-router.ts` — `ripgrepFallback` builds a shell command by interpolating the model-controlled Grep `pattern` (D2b-10, GAP4-01).
- `.claude/hooks/src/shared/daemon-client.ts` — Windows TCP path double-shells the same Grep pattern in query JSON (GAP4-02).
- `.claude/hooks/src/compiler-in-the-loop.ts` + `typescript-preflight.ts` — interpolate the edited file_path into a cmd.exe shell string (D5b-02).

### Context-injection / prompt-injection (sanitizer bypass)
- `.claude/hooks/src/shared/memory-sanitize.ts` (sanitizeMemoryContent + wrapMemoryContext) — applied in `memory-awareness.ts` + `agent-recall-injector.ts` but NOT in `session-start-continuity.ts`, `pre-plan-memory.ts`, `git-memory-check.ts` which inject raw archival recall into additionalContext (D5b-01). Poisoned archival rows (planted via the store-side injectors above) render verbatim into model context.

### SQL + env
- `opc/scripts/core/*.py` (memory_service_pg.py, recall_learnings.py) — confirm parameterized vs f-string SQL (D5b coverage_manifest claimed CLEAN — verify independently).
- `opc/.env` loading / any token echo / secrets in logs.

## What to return (your findings only — be specific with file:line + the exploit/quote)
1. CONFIRM or REFUTE each listed finding with your own reading (note any the Claude panel over- or under-rated).
2. NEW shell/injection/env/path-traversal sites the Claude panel did NOT list (grep `spawn`/`exec`/`execSync`/`subprocess`/`shell:true` across `.claude/hooks/src`, `scripts/`, `opc/scripts/` yourself).
3. For each: severity (S0 silent-corruption/data-loss · S1 exploitable/wrong-hot-path · S2 measurable · S3 polish), the concrete trigger, and the minimal fix (prefer `spawnSync(cmd, [args], {shell:false})` array-arg over string interpolation).
Concise. Cross-model lift = what only you catch.
