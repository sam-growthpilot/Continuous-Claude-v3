# codex-worker.jsonl — Codex Task-Execution Telemetry

One row per `/codex` run (the `codex-worker` agent). Distinct from `codex-lift.jsonl` (that tracks review *lift* counts for `/review`/`/premortem`; this tracks task *execution*). The `.jsonl` is gitignored (`.claude/logs/*.jsonl`) — machine-local runtime data; this README is committed.

## Schema (one JSON object per TURN)

**One row per turn** — an implement-then-resume interaction is TWO rows (one `implement`, one `resume`), never a combined `mode:"implement+resume"`. Always emit the documented enum values below; a freeform `verification`/`scope` string is drift, not schema.

```json
{
  "ts": "2026-07-06T14:32:00Z",        // ISO 8601 UTC
  "mode": "ask" | "implement" | "resume",   // exactly one; never a "+"-joined pair
  "model": "gpt-5.5",                    // always in {gpt-5.5, gpt-5.4, gpt-5.4-mini}
  "effort": "high" | "xhigh" | "medium" | "low",
  "sandbox": "read-only" | "workspace-write",
  "multi_agent": false,                  // true only for the (v2) --complex opt-in
  "scope": "ephemeral" | "worktree" | "in-place" | "resume:<id>",  // ephemeral=ask (read-only, no worktree); worktree/in-place=implement; resume embeds the captured thread id
  "task_summary": "add --limit flag to query.mjs",
  "exit_code": 0,                        // codex exec return code
  "git_diff_stat": "1 file changed, 22 insertions(+), 3 deletions(-)",  // "" for ask
  "verification": "answered" | "diff_reviewed_and_applied" | "diff_reviewed_and_discarded" | "apply_conflict",  // answered=ask; the diff_* trio=implement/resume
  "session_id": "019f3987-...",          // implement/resume only: the Codex thread id (thread_id from the --json thread.started event); "" for ask
  "via": "claude-code" | "ralph" | "scheduled"
}
```

`session_id` is captured from the implement turn's `--json` stream — the first event is `{"type":"thread.started","thread_id":"<uuid>"}` (verified codex-cli 0.131.0). It is threaded into `resume` (as `codex exec resume <session_id>`, robust under concurrency where `--last` is not) and embedded in the resume row's `scope` as `resume:<session_id>`.

Optional richer fields when `--json` per-turn token events are parsed (v1+): `wall_clock_s`, `tokens:{input,cached_input,output,reasoning_output}`, `files_changed:[...]`, `worktree_path`.

## Why this metric

`/codex` spends ChatGPT-subscription quota (no dollar price). This log is how a running weekly token total is reconstructed (the subscription has a rolling-5h + weekly-cap model, and a known cost-regression, openai/codex#28879). It also records whether a write run's diff was actually reviewed-and-applied vs discarded — the review-gate audit trail.

## Query patterns

### Implement runs whose diff was applied
```bash
jq -c 'select(.mode=="implement" and .verification=="diff_reviewed_and_applied")' .claude/logs/codex-worker.jsonl
```

### Runs by mode
```bash
jq -s 'group_by(.mode) | map({mode: .[0].mode, runs: length})' .claude/logs/codex-worker.jsonl
```

### Non-zero exits (failed runs)
```bash
jq -c 'select(.exit_code != 0)' .claude/logs/codex-worker.jsonl
```

### Reconstruct token usage (once v1 populates .tokens)
```bash
jq -s '[.[] | .tokens.output // 0] | add' .claude/logs/codex-worker.jsonl
```

## Related

- Safety contract: `.claude/rules/codex-worker-safety.md`
- Engine: `.claude/agents/codex-worker.md` · Skill: `.claude/skills/codex/SKILL.md`
- Design + evidence: `docs/codex-integration/DESIGN-RESEARCH.md`
- Review-lift sibling: `.claude/logs/codex-lift.README.md`
