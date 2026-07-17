# Workspace HTML-Embed Inventory — 2026-07-16

Optimization 01 ("no orphan surfaces") deliverable: every HTML embed on a
job-owned Notion page, classified **tracked** (a machine job owns its refresh),
**linked** (points at an externally-versioned artifact; no refresh needed), or
**dated-snapshot** (intentionally frozen; label must carry its date). Produced
by a read-only ntn sweep over all job-owned pages (recon agent, 2026-07-16).

## Inventory

| Page | Section | Embed block | Classification | Manager |
|---|---|---|---|---|
| Reports/Reporting Hub `38f76fd7ac8280478e50dd2956ba6e8a` | 🎯 Portfolio Cockpit | `233630f9-0048-47f7-9f79-7b6faa78c574` | **tracked** | sweep.mjs cockpit step (`state.cockpit`) |
| Reports/Reporting Hub | 🩺 System Plumbing — how it all connects | `1d154053-1c46-4472-9079-08cf64d01fbb` | **dated-snapshot** | none — hand-published architecture diagram; refresh manually when the plumbing changes |
| Mobile Cockpit `39376fd7-ac82-817e-b2b7-faa3da23078c` | 🚨 Attention Queue | `9dd8d92e-2630-43ea-8bb5-3a85b5d42ff1` | **tracked** | sweep.mjs mobile-cockpit step (`state.mobileCockpit`) |
| Overview page `39376fd7-ac82-81ec-a734-d56cdd390c22` | The Portfolio Cockpit | `2ea80357-a524-4fc1-82e2-d1fb1c58a7e9` | **tracked** (as of 2026-07-16) | sweep.mjs overview-examples step (`state.overviewExamples.cockpit`) |
| Overview page | A project card | `981abc0e-ee82-427e-98bf-a822705d1de7` | **tracked** (as of 2026-07-16) | sweep.mjs overview-examples step (`state.overviewExamples.card`) |
| connector-ecosystem card host `38776fd7ac8281c7a286ce6ae478b6be` | 📊 Living Status Card | `931223b7-47cb-4fbf-a429-b4373d0d2b26` | **tracked** | sweep.mjs card publish (`state.cards['connector-ecosystem']`) |
| 6 report child pages (VP Weekly / FourthOS Sponsor / Team Dashboard / System Health / Project Portfolio / Self-Improvement) | — | — | n/a | no embed blocks exist; their `## Current run` sections are ntn text callouts (refresh-pages.mjs) |

Result: **6 embeds found workspace-wide; 5 tracked, 1 dated-snapshot, 0 orphans**
(the two overview examples were the last orphans; the sweep now owns them).

## Classification notes

- **Tracking identity is page + section heading**, not attachment id. A
  `state.json` `attachmentId` is the transient `file-upload://` id from the
  publish marker; Notion rewrites it into a permanent attachment uuid when it
  binds the embed, so the stored id NEVER equals the live embed block id or its
  S3 file uuid (documented in sweep.mjs `cockpitEmbedIdFromUrl`). An id
  "mismatch" between state.json and the live block is by design, not drift.
- The **System Plumbing** embed is the only surface with no machine manager.
  Acceptable as a dated snapshot; if it starts rotting, wire it like the
  overview examples (a `state`-tracked, hash-gated sweep publish).

## Drift check (monthly, manual for now)

Re-run the same read-only sweep and diff against this table:

1. `getPageBlocks` each page above; list `type === 'embed'` blocks per section.
2. Any embed on a job-owned page absent from this table ⇒ new orphan — either
   register it as a sweep-tracked surface or reclassify it here with a date.
3. Any **tracked** row whose section no longer contains an embed ⇒ broken
   surface — the sweep's self-heal should republish next run; if it doesn't,
   investigate `state.json` publishedHash vs live.

A scripted version (compare against a pinned manifest, emit a Warn registry
row) is optimization-report follow-up material; not built in this pass.
