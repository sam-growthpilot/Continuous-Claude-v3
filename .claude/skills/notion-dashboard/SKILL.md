---
name: notion-dashboard
description: Build and maintain machine-refreshed Notion dashboard pages that combine interactive HTML embeds, native DB views, and Notion-AI-readable markdown sections. Use when creating a new auto-refreshed Notion page/dashboard, wiring a page into the project-cards sweep, refreshing the FourthOS Mobile Cockpit, or when the user says "notion dashboard", "mobile cockpit", "refresh mobile cockpit", or "machine-maintained page". Codifies the two-phase publish pattern (deterministic ntn vs MCP-only embed bind) with its 200KiB/1-hour constraints and section-ownership contract.
---

# Notion Dashboard (machine-refreshed pages)

## The two-phase publish pattern (proven — do not fight it)

| Capability | Tool | Notes |
|---|---|---|
| Page create, markdown sections, tables, callouts | `ntn` CLI (deterministic) | Block-level `ntn api` PATCH only — **never `ntn pages edit` full-page replace** on a page holding embeds/views (they don't round-trip; destroys them) |
| Interactive HTML `<embed>` bind | Notion MCP only | `notion-create-attachment` (≤200 KiB) → `notion-update-page` with `<embed src="file-upload://id">`; **attach within 1 hour, upload+bind in ONE MCP prompt**. Headless: `env -u ANTHROPIC_API_KEY claude -p --allowedTools "mcp__claude_ai_Notion__*"` |
| Linked DB views | Notion MCP only (`create-view`) | Filters on relation properties may not be settable via MCP — a manual in-app filter tweak can be the honest fallback |
| DB queries | `ntn datasources query` / `queryDataSource` | Walk `next_cursor` to exhaustion; pin `NOTION_API_VERSION=2025-09-03` (enables `after` on children PATCH; avoids per-call spec fetch 403s) |

## Section-ownership contract

Machine-owned sections are replaced by heading match; human sections are NEVER touched. Publisher must:
1. Use block-level splice (`replaceSectionBlocks` in `scripts/project-cards/lib/notion.mjs`) — heading → next same-or-higher heading.
2. Read back the page after an MCP embed bind and verify the embed exists under the heading BEFORE advancing published state (never trust the model's self-reported success marker alone).
3. Never feed page content into the MCP prompt (prompt-injection surface via human sections) — instruct by heading string only.
4. Demote inner `##` in machine markdown to `###` so digests can't corrupt splice boundaries.

## FourthOS Mobile Cockpit (reference instance)

- Page: `39376fd7-ac82-817e-b2b7-faa3da23078c` (child of Daily Cockpit `34076fd7…2c47`), workspace-private.
- Sections: intro callout (machine) · `## 🚨 Attention Queue` embed (machine) · `## ✅ Act now` native views (setup-owned) · `## 🤖 AI digest (machine-written)` markdown mirror so **Notion AI can answer questions** (it cannot read embeds) · `## 📓 Capture` (human — sweep never touches).
- Engine: `scripts/project-cards/` — `lib/queue.mjs` (single ranked queue) → `mobile-brief.mjs` (HTML) + `lib/digest.mjs` (markdown). Single source of truth: embed and digest can never disagree.
- Refresh: CCv3-Project-Cards task, daily 07:45 + 17:45. On-demand: `node scripts/project-cards/sweep.mjs --target mobile-cockpit` (that IS the "refresh mobile cockpit" command). Whole sweep holds `.sweep.lock` (30-min stale) — concurrent runs exit 0.
- Per-step status in `logs/sweep.jsonl` (`mobileCockpit: {digestStatus, embedStatus, contentHash, runId, failureCode}`); digest write is independent of the embed bind, so the page stays AI-answerable when MCP flakes. Rollback: `out/mobile-cockpit.html.prev` + `prevAttachmentId` in state.

## Building a NEW machine-refreshed page (checklist)

1. Create page via `ntn pages create --parent page:<id>` with the section skeleton (first `#` line becomes the page TITLE, not a block — intro updates must target the callout).
2. Verify `public_url: null` (sharing audit) after creation.
3. Create views via headless MCP with `--allowedTools "mcp__claude_ai_Notion__*"`; expect filter limitations.
4. Add a pure builder + a `--target` step in `sweep.mjs` following `publishMobileCockpit()`; hash-gate; size-assert <150 KiB.
5. Verify: dry-run, live run, read-back (machine sections replaced, human sections byte-identical), then on-device check.
