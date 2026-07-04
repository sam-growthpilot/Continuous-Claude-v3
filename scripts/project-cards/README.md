# Living Project Cards

Zero-LLM, deterministic engine that assembles a self-contained bento-style HTML
status card for a FourthOS project from live Notion DB fields, and hands the
publish step off to the Notion MCP.

## Architecture

```
Projects DB row ─┐
                 ├─ refresh.mjs ─ assembler.mjs ─ out/<slug>.html ─┐
Decisions & Outputs ─┘   (pure)      (template.html)               │
                 │                                                 ├─ publish manifest (stdout JSON)
                 └─ lib/notion.mjs (ntn CLI: query + upload)       │
                                                                   ▼
                                          /project-card skill → Notion MCP embed bind
```

- `template.html` — the bento card identity, tokenized (`{{TOKENS}}`). The
  entire `<style>` block matches the approved pilot card exactly.
- `assembler.mjs` — **pure, zero-LLM**. `assembleCard(project, decisions, opts)`
  returns HTML. Every interpolated DB value is HTML-escaped (`esc()`); nothing
  raw from Notion reaches the markup. Same inputs → byte-identical output.
- `lib/notion.mjs` — thin `ntn` wrapper: `queryProjects`, `getProjectByName`,
  `queryDecisionsForProject`, `uploadHtml`, plus property extractors.
- `refresh.mjs` — CLI. Resolves the row(s), fetches D&O, assembles, hashes,
  compares state, writes `out/<slug>.html`, and emits a **publish manifest**.
- `state.json` — per-slug publish state (`{cards:{}}` seed).

## The S5 publish split (why the engine stops at a manifest)

The final "bind the uploaded HTML to an interactive inline `<embed>` block"
step **cannot** be done by the CLI (proven in the S5 spike):

- `ntn pages` markdown stores `<embed>` as literal text.
- A raw `ntn api` embed block does not resolve `file-upload://`.
- A raw `ntn api` *file* block binds the upload but renders as a download card,
  not the inline sandboxed iframe that gives the card its living identity.

So the engine does everything deterministically **except** the embed bind. Its
`refresh` emits a manifest; the caller (interactive Claude or `claude -p`)
performs the one MCP call:

1. `notion-create-attachment` with the HTML string (≤200 KiB) → `file-upload://<id>`
2. `notion-update-page` inserting/replacing the `## 📊 Living Status Card`
   section with `<embed src="file-upload://<id>">` + an as-of caption.

The engine never calls the MCP or `claude -p`. It may call `ntn files create`
only as a size/precheck; the authoritative publish is MCP create-attachment.

## The ntn non-interactive contract (enforced in `lib/notion.mjs`)

- Absolute exe path (winget package path); log `ntn --version` once per run.
- Every call: `spawnSync` with closed/empty stdin (`input`), a hard 30 s
  timeout, `windowsHide:true`, fail-loud on nonzero exit (throws with stderr).
- Payloads (query bodies) via stdin JSON — never inline `field=value` with `:`.

## Usage

```bash
node scripts/project-cards/refresh.mjs "Connector Ecosystem"   # one card
node scripts/project-cards/refresh.mjs --all                    # whole roster
node scripts/project-cards/sweep.mjs --target mobile-cockpit    # refresh phone cockpit (triage + embed + digest)
node scripts/project-cards/sweep.mjs --target triage            # triage-only (exits 3 on triage failure)
node scripts/project-cards/experiment/uat-triage.mjs            # live UAT pass (nonce'd, ID-exact cleanup)
```

## Mobile PM Portal (page 39376fd7-ac82-817e-b2b7-faa3da23078c)

Section ownership: intro callout / 🚨 Attention Queue embed / 🤖 AI digest / 🧾 Triage log = **machine** ·
✅ Act now + 🗒️ Notes views = setup-owned · 📓 Capture = **human writes, triage consumes only fully-parsed+filed lines**
(create → persist id → re-fetch conflict check → delete; receipt every consuming run, last 10 kept).
Capture grammar + safety rails: see `.claude/skills/notion-dashboard/SKILL.md`. Triage is a pure regex parser —
capture text never reaches an LLM/MCP prompt.

Manifest fields: `projectName, slug, pageId, htmlPath, contentHash, changed,
needsPublish, cardSectionHeading`. `changed:false` means the canonical content
(hash **excludes** the volatile `AS_OF` stamp) is unchanged; `needsPublish:true`
still flags a card that has not yet been embedded on its page.

## Daily sweep (`sweep.mjs`)

`node scripts/project-cards/sweep.mjs [--dry-run]` is the automated daily driver
(registered as a scheduled task separately). It:

1. Logs a start banner + `ntn --version`.
2. Runs `refresh.mjs --all`, then for every result with a Notion `pageId` that
   is `changed || needsPublish`, publishes the card's embed via a headless
   `claude -p` call (the one MCP embed-bind step the CLI can't do). Each failure
   is recorded and the batch continues; a success updates that slug's
   `attachmentId` + `lastPublished` in `state.json`.
3. Refreshes the **Reporting Hub** gallery: queries the non-archived roster,
   classifies each row's `hostKind` (`notion`/`github`/`none`) from its
   `Project Page`, merges the static CCv3 pilot row, renders a
   `Project | Health | Status | Card` Markdown table, and hands it to one
   headless `claude -p` that replaces only the `## 📇 FourthOS Project Cards`
   section body.
4. Appends one JSON line to `logs/sweep.jsonl`
   (`ts, ntnVersion, refreshed, publishedOk, publishFailed, hubRefreshed`).

**Key-unset requirement:** the claude.ai Notion connector only loads when
`ANTHROPIC_API_KEY` is **unset**, so every spawned `claude` gets an env copy with
that key deleted (headless, `--dangerously-skip-permissions`).

**Exit-code contract:** exit `0` only if every attempted publish **and** the hub
refresh succeeded; exit `1` if any failed — but only after completing all work,
so a scheduled-task monitor shows red without aborting the batch.

**`--dry-run`** is the safe test path: it logs the banner, runs `refresh.mjs
--all`, and prints which cards *would* publish and the hub table that *would* be
written — spawning **no** `claude` and mutating neither `state.json` (beyond
refresh's own bookkeeping) nor Notion. Always exits `0`.

## `/project-card`

The daily `--all` sweep refreshes every roster card; only `changed ||
needsPublish` cards get an MCP publish. Manual refresh is the `/project-card`
skill. Reporting discipline: after reportable FourthOS work, run
`/project-card refresh <that project>`.

## Caveat: not every Projects row has a Notion page to host a card

`Project Page` may be a **GitHub URL** rather than a Notion page. The engine
resolves a Notion `pageId` only when `Project Page` is a notion.so/notion.com
link (else `pageId:null`). A card with `pageId:null` still assembles to
`out/<slug>.html`, but the skill cannot embed it until a hosting Notion page id
is supplied.
