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
```

Manifest fields: `projectName, slug, pageId, htmlPath, contentHash, changed,
needsPublish, cardSectionHeading`. `changed:false` means the canonical content
(hash **excludes** the volatile `AS_OF` stamp) is unchanged; `needsPublish:true`
still flags a card that has not yet been embedded on its page.

## Daily sweep & /project-card

The daily `--all` sweep (registered separately in N5) refreshes every roster
card; only `changed || needsPublish` cards get an MCP publish. Manual refresh
is the `/project-card` skill. Reporting discipline: after reportable FourthOS
work, run `/project-card refresh <that project>`.

## Caveat: not every Projects row has a Notion page to host a card

`Project Page` may be a **GitHub URL** rather than a Notion page. The engine
resolves a Notion `pageId` only when `Project Page` is a notion.so/notion.com
link (else `pageId:null`). A card with `pageId:null` still assembles to
`out/<slug>.html`, but the skill cannot embed it until a hosting Notion page id
is supplied.
