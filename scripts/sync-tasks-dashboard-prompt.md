# Daily refresh — CCv3 Reporting Hub (scheduled-tasks section)

You are a headless CCv3 session. The Notion page `38f76fd7ac8280478e50dd2956ba6e8a` ("CCv3 Reporting Hub")
is a manually-curated reporting hub. Your ONLY job is to refresh the **"📊 Scheduled tasks — health &
reliability"** section so tomorrow's health view is current. Everything else on the page is
hand-maintained — leave it byte-for-byte.

## Steps
1. **Get current task state.** From Bash, call PowerShell:
   `powershell -NoProfile -Command "Get-ScheduledTask | Where-Object { $_.TaskName -match 'CCv3|AIWeeklyReport' } | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; [pscustomobject]@{ Name=$_.TaskName; State=$_.State; Last=$i.LastRunTime; Result=$i.LastTaskResult; Next=$i.NextRunTime } } | Sort-Object Name | Format-Table -Auto"`
   Record State / LastRunTime / LastTaskResult / NextRunTime for each task. Note today's date.
2. **Fetch the current page** (`notion-fetch` id `38f76fd7ac8280478e50dd2956ba6e8a`). It is your template.
3. **PRESERVE, byte-for-byte** (do NOT touch — these are NOT scheduled-task data): the `# CCv3 Reporting Hub`
   intro + "Last reviewed" date, the **"📚 Reports & Dashboards"** ToC (all four tables), the
   **"⚠️ Reporting health — needs attention"** callouts, and the **"📥 Latest reports"** section.
4. **Update ONLY the "📊 Scheduled tasks — health & reliability" section**, via `notion-update-page`
   (prefer `update_content` targeted edits; fall back to `replace_content` regenerating from the fetched
   template if structure drifted). Change:
   - The section's italic "*Statuses below captured <date>*" line → today (NOT the intro "Last reviewed" date).
   - The two task tables (**CCv3 core**, **vibe-trading**): each task's **Last run**, **Result**, **Status**.
   - Each per-task `<details>` toggle: the **Last:** / **Result** / **Next:** values.
   - The "✅ Resolved this cycle" callout ONLY if a status genuinely changed.
5. **Status emoji rules:** 🟢 result 0 / healthy / verified · 🟡 known-pending fix or expected-nonzero
   (regression gate) · 🔴 failing unexpectedly · ⛔ disabled.
   **IMPORTANT:** if a task's Status cell or toggle carries a "fixed / restored / verifies <date>" annotation,
   KEEP its 🟡 status until the task's own next scheduled run reports — do NOT revert it to 🔴 from the stale
   pre-fix result. Only flip such a task to 🟢 once a fresh run returns 0, or 🔴 if a fresh run fails again.
6. **Notion syntax:** tables are XML `<table header-row="true">`, toggles `<details><summary>`, callouts
   `<callout icon="emoji" color="X_bg">`. If regenerating, read `notion://docs/enhanced-markdown-spec` first.

## Guardrails
- Touch ONLY page 38f76fd7... and only its scheduled-tasks section. Never modify another Notion page or any repo file.
- Never invent runs/results — report exactly what `Get-ScheduledTask` shows.
- End with a one-line summary of which task statuses changed since the last sync.
