// state.mjs — owns the state.json schema and all state I/O for the project-card
// engine. Single reader/writer so refresh.mjs and sweep.mjs agree on the shape
// and on the publish-vs-refresh decision. ESM, no deps.
//
// Per-card shape (state.cards[slug]):
//   {
//     projectRowId:       string,        // FourthOS Projects-DB row id
//     pageId:             string|null,   // Notion page hosting the card section
//     attachmentId:       string|null,   // file-upload id of the last publish
//     contentHash:        string|null,   // sha256 of canonical HTML (AS_OF excluded)
//     publishedHash:      string|null,   // contentHash AT LAST CONFIRMED PUBLISH
//     lastPublished:      string|null,   // ISO ts of last confirmed publish
//     lastRefreshAttempt: string|null    // ISO ts of last refresh pass
//   }
//
// REL#1 self-heal: contentHash advances the moment refresh regenerates the HTML,
// but publishedHash only advances on a confirmed publish. So a publish that fails
// (or never ran) leaves publishedHash BEHIND contentHash, and needsPublish() keeps
// flagging the card on every sweep until a publish actually lands. This is why
// publishedHash MUST be distinct from contentHash.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { STATE_PATH, STATE_VERSION } from './config.mjs';

function freshState() {
  return { version: STATE_VERSION, cards: {} };
}

// Read state.json. Corruption-tolerant: on a JSON.parse failure the bad file is
// quarantined to state.json.corrupt-<epoch>, a WARN is logged to stderr, and a
// fresh empty state is returned. This is safe because publish is idempotent once
// publishedHash lands — a rebuilt state re-flags unpublished cards and re-heals.
export function readState(path = STATE_PATH) {
  if (!existsSync(path)) return freshState();
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    console.error(`[state] WARN: could not read ${path}: ${e.message} — starting fresh`);
    return freshState();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const quarantine = `${path}.corrupt-${Date.now()}`;
    try {
      renameSync(path, quarantine);
      console.error(`[state] WARN: ${path} is corrupt (${e.message}); moved to ${quarantine} — starting fresh`);
    } catch (renameErr) {
      console.error(`[state] WARN: ${path} is corrupt (${e.message}) and could not be quarantined (${renameErr.message}) — starting fresh`);
    }
    return freshState();
  }
  if (!parsed || typeof parsed !== 'object') return freshState();
  parsed.version = typeof parsed.version === 'number' ? parsed.version : STATE_VERSION;
  parsed.cards = parsed.cards || {};
  return parsed;
}

// Atomic write: temp file + rename, so readers never see a torn state.json.
export function writeState(state, path = STATE_PATH) {
  const out = { version: STATE_VERSION, cards: {}, ...state };
  out.cards = out.cards || {};
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
}

// Record a confirmed publish for one slug. Mutates and returns `state` (caller
// persists via writeState). Sets attachmentId, lastPublished, AND publishedHash —
// advancing publishedHash to the just-published contentHash is what clears the
// needsPublish flag on the next sweep.
export function recordPublish(state, slug, { attachmentId, publishedHash, lastPublished } = {}) {
  state.cards = state.cards || {};
  const prev = state.cards[slug] || {};
  state.cards[slug] = {
    ...prev,
    attachmentId: attachmentId ?? prev.attachmentId ?? null,
    publishedHash: publishedHash ?? prev.publishedHash ?? null,
    lastPublished: lastPublished ?? new Date().toISOString(),
  };
  return state;
}

// --- mobile cockpit (additive, single-object — NOT per-slug) -----------------
// state.mobileCockpit shape:
//   { pageId, attachmentId, prevAttachmentId, contentHash, publishedHash,
//     lastPublished, lastDigestWrite }
// Readers tolerate absence (older state.json files predate this block) and
// writeState preserves it via the spread in the output shape.

function freshMobileCockpit() {
  return {
    pageId: null,
    attachmentId: null,
    prevAttachmentId: null,
    contentHash: null,
    publishedHash: null,
    lastPublished: null,
    lastDigestWrite: null,
  };
}

// Tolerant reader: always returns the full shape, filling absent fields.
export function getMobileCockpit(state) {
  const cur = state && state.mobileCockpit && typeof state.mobileCockpit === 'object'
    ? state.mobileCockpit : {};
  return { ...freshMobileCockpit(), ...cur };
}

// Merge a patch into state.mobileCockpit. Mutates and returns `state` (caller
// persists via writeState) — mirrors recordPublish's contract.
export function recordMobileCockpit(state, patch = {}) {
  state.mobileCockpit = { ...getMobileCockpit(state), ...patch };
  return state;
}

// Shared publish decision so refresh and sweep compute it identically.
// A card needs (re)publishing when it was never published, OR its published
// content is stale relative to the freshly-computed contentHash.
export function needsPublish(prev, contentHash) {
  return !prev || !prev.lastPublished || prev.publishedHash !== contentHash;
}
