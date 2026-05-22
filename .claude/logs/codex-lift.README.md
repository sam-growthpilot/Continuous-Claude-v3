# codex-lift.jsonl — Cross-Model Lift Telemetry

Tracks the value Codex actually adds beyond what Claude finds, per `/review` and `/premortem` run.

## Schema (one JSON object per line)

```json
{
  "ts": "2026-05-21T18:42:00Z",     // ISO 8601 UTC timestamp
  "skill": "review" | "premortem",   // which skill wrote the row
  "scope": "PR-#123" | "plans/foo.md" | "HEAD", // what was reviewed
  "claude_only": 3,                  // findings only Claude/critic flagged
  "codex_only": 2,                   // findings only Codex flagged (THE LIFT)
  "both": 4,                         // findings BOTH flagged (high-confidence)
  "via": "direct" | "envoy"          // transport — direct codex-adversary or via Envoy room
}
```

For `/review`, "Claude" means the combined critic + plan-reviewer outputs. For `/premortem`, "Claude" means the inline 3-category risk framework output.

## Why this metric

The whole point of cross-model review is the **lift** — issues only the other model catches. If `codex_only` is consistently zero, Codex is duplicating Claude's work and the quota cost isn't justified. If `both` is consistently high but `codex_only` is zero, the same applies. If `codex_only > 0` regularly, the integration is earning its keep.

## Query patterns

### Lift rate over last 50 runs

```bash
tail -n 50 .claude/logs/codex-lift.jsonl | \
  jq -s 'map(.codex_only) | add / length'
```

### Lift by skill

```bash
jq -s 'group_by(.skill) | map({
  skill: .[0].skill,
  runs: length,
  avg_codex_only: (map(.codex_only) | add / length),
  avg_both: (map(.both) | add / length)
})' .claude/logs/codex-lift.jsonl
```

### Runs where Codex caught something Claude missed

```bash
jq -c 'select(.codex_only > 0)' .claude/logs/codex-lift.jsonl
```

### Direct vs Envoy comparison (Phase E pilot)

```bash
jq -s 'group_by(.via) | map({
  via: .[0].via,
  runs: length,
  avg_codex_only: (map(.codex_only) | add / length)
})' .claude/logs/codex-lift.jsonl
```

## Adoption decision threshold

If after 20+ runs `avg(codex_only) < 0.2`, consider:
- Tightening the adversarial-review prompt at `vendor/codex-plugin-cc/prompts/adversarial-review.md`
- Disabling the default Codex pass and making it opt-in (`--codex` flag instead of `--no-codex`)
- Investigating whether Codex output is being filtered out incorrectly during synthesis

## Not gitignored

This file IS committed (small, valuable signal over time). Don't add it to `.gitignore`.
