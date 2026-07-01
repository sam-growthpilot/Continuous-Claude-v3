# Daily refresh — CCv3 Scheduled Tasks Notion dashboard

You are a headless CCv3 session. Refresh the scheduled-tasks dashboard so its status is current for
tomorrow morning. Update ONLY the Notion page `38f76fd7ac8280478e50dd2956ba6e8a` ("CCv3 Scheduled Tasks").

## Steps
1. **Get current task state.** From Bash, call PowerShell:
   `powershell -NoProfile -Command "Get-ScheduledTask | Where-Object { $_.TaskName -match 'CCv3|AIWeeklyReport' } | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; [pscustomobject]@{ Name=$_.TaskName; State=$_.State; Last=$i.LastRunTime; Result=$i.LastTaskResult; Next=$i.NextRunTime } } | Sort-Object Name | Format-Table -Auto"`
   Record State / LastRunTime / LastTaskResult / NextRunTime for each task. Also note today's date.
2. **Fetch the current page** (`notion-fetch` id `38f76fd7ac8280478e50dd2956ba6e8a`). This is your structural
   template — keep its sections, grouping, tables, callouts, toggles, and Latest-Reports exactly.
3. **Regenerate the page with fresh dynamic values** and write via `notion-update-page` command
   `replace_content`. Change ONLY the dynamic fields; keep all static content (purposes, commands, the
   "Fixed this session" + "Needs your decision" callouts, Latest Reports) byte-for-byte unless a status
   genuinely changed:
   - The intro "Last synced" date → today.
   - "📊 Status at a glance" tables: each task's **Last run**, **Result**, **Status** emoji.
   - Each per-task `<details>` toggle: the **Last:** / **Result** / **Next:** values.
   - Status emoji rule: 🟢 result 0 / healthy / new · 🟡 known-pending fix or expected-nonzero (e.g. the
     finance regression gate) · 🔴 failing unexpectedly · ⛔ disabled. A task that newly succeeds (result 0)
     moves to 🟢 and can drop out of "Needs your decision".
4. **Notion-flavored markdown:** tables are XML `<table header-row="true">`, toggles `<details><summary>`,
   callouts `<callout icon="emoji" color="X_bg">`. If unsure of syntax, read `notion://docs/enhanced-markdown-spec`
   first (via ReadMcpResourceTool, server "claude.ai Notion").

## Guardrails
- Touch ONLY the dashboard page above. Do NOT modify any other Notion page or any repo file.
- This is a status refresh — never invent runs/results; report exactly what `Get-ScheduledTask` shows.
- End by replying with a one-line summary of which task statuses changed since the last sync.
