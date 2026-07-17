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

// --- portfolio cockpit (additive, single-object — hub-page cockpit embed) -----
// state.cockpit shape:
//   { pageId, attachmentId, contentHash, publishedHash, lastPublished }
// Mirrors the mobileCockpit gate: contentHash advances when the cockpit HTML is
// regenerated, but publishedHash advances ONLY on a confirmed + read-back-verified
// publish (REL#1 self-heal). Readers tolerate absence (older state.json files
// predate this block) and writeState preserves it via the output-shape spread.

function freshCockpit() {
  return {
    pageId: null,
    attachmentId: null,
    contentHash: null,
    publishedHash: null,
    lastPublished: null,
  };
}

// Tolerant reader: always returns the full shape, filling absent fields.
export function getCockpit(state) {
  const cur = state && state.cockpit && typeof state.cockpit === 'object'
    ? state.cockpit : {};
  return { ...freshCockpit(), ...cur };
}

// Merge a patch into state.cockpit. Mutates and returns `state` (caller persists
// via writeState) — mirrors recordMobileCockpit's contract.
export function recordCockpit(state, patch = {}) {
  state.cockpit = { ...getCockpit(state), ...patch };
  return state;
}

// --- triage (additive, under mobileCockpit.triage) ----------------------------
// Shape: { recentHashes: string[] (ring, last 50), created: [{ds,id}], lastRun }
// recentHashes is the replay guard (mitigation #12: hash = blockId+date);
// created rows are persisted BEFORE the source block delete (mitigation #3).

const TRIAGE_RING = 50;

function freshTriage() {
  return { recentHashes: [], created: [], lastRun: null, consumed: 0, skipped: 0 };
}

// Tolerant reader: always returns the full triage shape.
export function getTriage(state) {
  const mc = getMobileCockpit(state);
  const cur = mc.triage && typeof mc.triage === 'object' ? mc.triage : {};
  return {
    ...freshTriage(),
    ...cur,
    recentHashes: Array.isArray(cur.recentHashes) ? cur.recentHashes : [],
    created: Array.isArray(cur.created) ? cur.created : [],
    consumed: Number.isFinite(cur.consumed) ? cur.consumed : 0,
    skipped: Number.isFinite(cur.skipped) ? cur.skipped : 0,
  };
}

// Record one triage event: push the created row ref and the replay hash
// (ring-buffered to the last TRIAGE_RING), bump lifetime consumed/skipped
// counters, stamp lastRun. Mutates and returns `state`.
export function recordTriage(state, { created, hash, ranAt, consumed, skipped } = {}) {
  const triage = getTriage(state);
  if (created) triage.created = [...triage.created, created].slice(-200);
  if (hash) triage.recentHashes = [...triage.recentHashes, hash].slice(-TRIAGE_RING);
  if (ranAt) triage.lastRun = ranAt;
  if (Number.isFinite(consumed)) triage.consumed += consumed;
  if (Number.isFinite(skipped)) triage.skipped += skipped;
  state.mobileCockpit = { ...getMobileCockpit(state), triage };
  return state;
}

// --- overview-page example embeds (optimization 01) ----------------------------
// state.overviewExamples maps an example key ('cockpit' | 'card') -> the same
// publish-tracking shape the cockpit uses: { pageId, attachmentId, contentHash,
// publishedHash, lastPublished }. contentHash mirrors the LIVE surface's
// published content hash; publishedHash advances only on a confirmed +
// read-back-verified example publish (REL#1 self-heal). Readers tolerate
// absence (older state.json files predate this block).

function freshOverviewExample() {
  return {
    pageId: null,
    attachmentId: null,
    contentHash: null,
    publishedHash: null,
    lastPublished: null,
  };
}

// Tolerant reader: always returns the full shape for one example key.
export function getOverviewExample(state, key) {
  const all = state && state.overviewExamples && typeof state.overviewExamples === 'object'
    ? state.overviewExamples : {};
  const cur = all[key] && typeof all[key] === 'object' ? all[key] : {};
  return { ...freshOverviewExample(), ...cur };
}

// Merge a patch into state.overviewExamples[key]. Mutates and returns `state`
// (caller persists via writeState) — mirrors recordCockpit's contract.
export function recordOverviewExample(state, key, patch = {}) {
  state.overviewExamples = state.overviewExamples && typeof state.overviewExamples === 'object'
    ? state.overviewExamples : {};
  state.overviewExamples[key] = { ...getOverviewExample(state, key), ...patch };
  return state;
}

// --- one-time setup registry (mitigation #9) ----------------------------------
// state.mobileCockpit.setup maps a setup-step key (e.g. pmNotesDs, triageLogHeading,
// notesView) -> the created resource id/marker. Setup steps check this and skip
// when the key is already present, making the one-time sequence idempotent.

export function getSetup(state) {
  const mc = getMobileCockpit(state);
  return mc.setup && typeof mc.setup === 'object' ? { ...mc.setup } : {};
}

// Merge a patch into the setup registry. Mutates and returns `state`.
export function recordSetup(state, patch = {}) {
  state.mobileCockpit = { ...getMobileCockpit(state), setup: { ...getSetup(state), ...patch } };
  return state;
}

// Shared publish decision so refresh and sweep compute it identically.
// A card needs (re)publishing when it was never published, OR its published
// content is stale relative to the freshly-computed contentHash.
export function needsPublish(prev, contentHash) {
  return !prev || !prev.lastPublished || prev.publishedHash !== contentHash;
}
