// triage.mjs — mobile-cockpit Capture triage: PURE regex grammar parser +
// deterministic executor. Capture text is UNTRUSTED — it never reaches an
// LLM/MCP prompt; the only place it re-appears is escaped + capped inside
// receipt page content (mitigation #8). ESM, no deps.
//
// Grammar (v0, plan "Capture grammar"):
//   t /t:/todo:/task:   -> task          (personal Tasks DS)
//   n /n:/note:/ bare   -> note          (PM Notes)
//   i /i:/idea:         -> idea          (PM Notes)
//   later:/l:           -> later         (PM Notes, Status=open)
//   b:/blocker:         -> blocker       (PM Notes, Status=open)
//   d /d:/decision:     -> decision      (Decisions DS)
//   leading '?'         -> question      (PM Notes, Type=question)
//   // or # lead        -> scratch       (never touched, never receipted)
// Modifiers (order-free, stripped from title): @alias !p1|p2|p3 due:<spec>
//   due specs: today | tomorrow | mon..sun | YYYY-MM-DD | +Nd  (vs injectable now)
// Anything directive-looking but unknown, unknown alias, bad date, or empty
// content -> {kind:'skip', reason} (left in place, listed in receipt).
import { createHash } from 'node:crypto';
import {
  MOBILE_COCKPIT_PAGE_ID, CAPTURE_HEADING, TRIAGE_LOG_HEADING,
  TASKS_DS, PM_NOTES_DS, DECISIONS_DS, TRIAGE_ACTOR_ALLOWLIST,
} from './config.mjs';
import {
  getPageBlocks, getBlock, deleteBlock, replaceSectionBlocks,
  createTaskRow, createPmNoteRow, createDecisionRow, findByCaptureId,
  findSectionBlocks,
} from './notion.mjs';
import { readState, writeState, recordTriage, getTriage } from './state.mjs';
import { loadAliases, resolveAlias } from './aliases.mjs';

// FourthOS Daily-Cockpit project row (Tasks relation so TASKS_QUERY sees rows).
export const COCKPIT_PROJECT_ID = '34076fd7-ac82-805d-ac89-dd26476e2c47';

// --- pure grammar parser -------------------------------------------------------

// Colon-form directives -> kind.
const COLON_PREFIXES = {
  t: 'task', todo: 'task', task: 'task',
  n: 'note', note: 'note',
  i: 'idea', idea: 'idea',
  l: 'later', later: 'later',
  b: 'blocker', blocker: 'blocker',
  d: 'decision', decision: 'decision',
};
// Single-letter space-form directives ('t buy milk').
const SPACE_PREFIXES = { t: 'task', n: 'note', i: 'idea', d: 'decision' };

const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const pad = (n) => String(n).padStart(2, '0');
function fmtUtc(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Resolve a due: spec against `now` (Date). Returns 'YYYY-MM-DD' or null (bad).
export function resolveDue(spec, now) {
  const s = String(spec).toLowerCase();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const plusDays = (n) => fmtUtc(new Date(base + n * 86400000));
  if (s === 'today') return plusDays(0);
  if (s === 'tomorrow') return plusDays(1);
  if (s in WEEKDAYS) {
    // Next occurrence strictly after today (1..7 days ahead).
    const delta = ((WEEKDAYS[s] - now.getUTCDay()) + 7) % 7 || 7;
    return plusDays(delta);
  }
  let m = /^\+(\d{1,3})d$/.exec(s);
  if (m) return plusDays(Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    // Reject rollovers like 2026-02-31.
    if (fmtUtc(d) !== s) return null;
    return s;
  }
  return null;
}

// PURE: parse one capture line. Returns one of
//   { kind:'scratch' }
//   { kind:'skip', reason }
//   { kind, title, priority?, due?, projectId?, alias? }
export function parseCaptureLine(text, { now = new Date(), aliases = {} } = {}) {
  const raw = String(text ?? '');
  const line = raw.trim();
  if (line === '') return { kind: 'skip', reason: 'empty' };
  // Human scratch escape — never touched, never receipted.
  if (line.startsWith('//') || line.startsWith('#')) return { kind: 'scratch' };

  let kind = null;
  let rest = null;
  const q = /^\?\s*(.*)$/.exec(line);
  if (q) { kind = 'question'; rest = q[1]; }

  if (!kind) {
    const colon = /^([a-zA-Z][a-zA-Z0-9_-]{0,15}):\s*(.*)$/.exec(line);
    if (colon) {
      const key = colon[1].toLowerCase();
      if (!(key in COLON_PREFIXES)) return { kind: 'skip', reason: 'unknown-directive' };
      kind = COLON_PREFIXES[key];
      rest = colon[2];
    }
  }
  if (!kind) {
    const sp = /^([a-zA-Z])\s+(.*)$/.exec(line);
    if (sp && sp[1].toLowerCase() in SPACE_PREFIXES) {
      kind = SPACE_PREFIXES[sp[1].toLowerCase()];
      rest = sp[2];
    }
  }
  if (!kind) { kind = 'note'; rest = line; } // bare line -> note (mitigation #11)

  // Modifiers: order-free tokens, stripped from the title.
  const item = { kind };
  const titleTokens = [];
  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    let m = /^@([A-Za-z0-9][A-Za-z0-9-]{0,31})$/.exec(tok);
    if (m) {
      const id = resolveAlias(m[1], aliases);
      if (!id) return { kind: 'skip', reason: 'unknown-alias' };
      item.alias = m[1].toLowerCase();
      item.projectId = id;
      continue;
    }
    m = /^!p([123])$/i.exec(tok);
    if (m) { item.priority = `P${m[1]}`; continue; }
    m = /^due:(\S+)$/i.exec(tok);
    if (m) {
      const due = resolveDue(m[1], now);
      if (!due) return { kind: 'skip', reason: 'bad-date' };
      item.due = due;
      continue;
    }
    titleTokens.push(tok);
  }
  item.title = titleTokens.join(' ');
  if (!item.title) return { kind: 'skip', reason: 'empty' };
  return item;
}

// --- pure block-level parser ---------------------------------------------------

const CONSUMABLE_TYPES = ['paragraph', 'bulleted_list_item', 'to_do'];

function blockRichText(block) {
  return block?.[block.type]?.rich_text || [];
}
export function blockPlainText(block) {
  return blockRichText(block).map((t) => t.plain_text ?? t?.text?.content ?? '').join('');
}
export function textHash(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}
// Replay-guard hash (mitigation #12): BLOCK ID + date — a genuinely new block
// with identical text files normally; only same-block replays are guarded.
export function replayHash(blockId, now) {
  return createHash('sha256').update(`${blockId}|${fmtUtc(now)}`, 'utf8').digest('hex');
}

// PURE: classify Capture-section blocks into consumable parsed items and skips.
// Consumable = plain single-line text paragraph/bullet/to_do with NO children
// and NO non-text rich_text tokens (mentions/links/equations) (mitigation #2).
// Actor gate (mitigation #7): when `allowlist` is non-empty, created_by AND
// last_edited_by must both be allowlisted.
export function parseCaptureBlocks(blocks, { now = new Date(), aliases = {}, allowlist = [] } = {}) {
  const items = [];
  for (const b of blocks || []) {
    if (!b || !CONSUMABLE_TYPES.includes(b.type)) continue; // untouched, unreceipted
    const base = { blockId: b.id, lastEditedTime: b.last_edited_time || null };
    if (b.has_children) { items.push({ ...base, kind: 'skip', reason: 'rich-content', raw: '' }); continue; }
    const rich = blockRichText(b);
    if (rich.some((t) => t.type !== 'text' || (t.text && t.text.link))) {
      items.push({ ...base, kind: 'skip', reason: 'rich-content', raw: '' });
      continue;
    }
    const raw = blockPlainText(b);
    if (/[\r\n]/.test(raw)) { items.push({ ...base, kind: 'skip', reason: 'multi-line', raw }); continue; }
    if (allowlist.length > 0) {
      const actors = [b.created_by?.id, b.last_edited_by?.id].filter(Boolean);
      if (actors.length === 0 || !actors.every((id) => allowlist.includes(id))) {
        items.push({ ...base, kind: 'skip', reason: 'actor', raw });
        continue;
      }
    }
    const parsed = parseCaptureLine(raw, { now, aliases });
    if (parsed.kind === 'scratch') continue; // human scratch: untouched, unreceipted
    items.push({ ...base, ...parsed, raw, hash: textHash(raw) });
  }
  return items;
}

// --- receipt rendering (mitigation #8: escaped, 60-char-capped echoes) ---------

export function escapeEcho(text, cap = 60) {
  let s = String(text).replace(/[\u0000-\u001f]/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (s.length > cap) s = `${s.slice(0, cap - 1)}…`;
  return s;
}

export function buildReceiptLine({ consumed = [], skipped = [], conflicts = [], failed = false, nowIso = '' } = {}) {
  const parts = [`${nowIso} ${failed ? '⚠ triage FAILED' : '🧾 triage'}: consumed ${consumed.length}, skipped ${skipped.length}, conflicts ${conflicts.length}`];
  if (consumed.length > 0) {
    parts.push(`filed: ${consumed.map((c) => `${c.kind} "${escapeEcho(c.title)}"`).join('; ')}`);
  }
  if (skipped.length > 0) {
    parts.push(`skipped: ${skipped.map((s) => `${s.reason} "${escapeEcho(s.raw || '')}"`).join('; ')}`);
  }
  if (conflicts.length > 0) {
    parts.push(`conflicts (edited mid-run, left in place): ${conflicts.map((c) => `"${escapeEcho(c.raw || '')}"`).join('; ')}`);
  }
  return parts.join(' · ');
}

const RECEIPT_KEEP = 10;

// PURE: new section body = new receipt paragraph + previous receipts (rebuilt as
// fresh paragraph blocks), capped at RECEIPT_KEEP total.
export function buildReceiptBlocks(prevSectionBlocks, line) {
  const prevLines = (prevSectionBlocks || [])
    .filter((b) => b && b.type === 'paragraph')
    .map((b) => blockPlainText(b))
    .filter((t) => t.trim() !== '');
  const para = (text) => ({
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: String(text).slice(0, 2000) } }] },
  });
  return [line, ...prevLines].slice(0, RECEIPT_KEEP).map(para);
}

// --- executor -------------------------------------------------------------------

function defaultDeps() {
  return {
    getPageBlocks, getBlock, deleteBlock, replaceSectionBlocks,
    createTaskRow, createPmNoteRow, createDecisionRow, findByCaptureId,
    readState, writeState,
    aliases: loadAliases(),
    allowlist: TRIAGE_ACTOR_ALLOWLIST,
    ids: { tasksDs: TASKS_DS, pmNotesDs: PM_NOTES_DS, decisionsDs: DECISIONS_DS, cockpitProjectId: COCKPIT_PROJECT_ID },
  };
}

// Create the destination row for one parsed item. Returns { ds, id }.
function createRow(item, deps) {
  const { ids } = deps;
  const captureId = item.blockId;
  if (item.kind === 'task') {
    if (!ids.tasksDs) throw new Error('tasksDs not configured');
    // Personal Tasks DS's "Project" relation is scoped to the personal
    // Life-OS Projects DB, NOT the FourthOS Projects DB that @alias tokens
    // resolve against (different data source entirely) — feeding an
    // alias-resolved FourthOS row id into it would be a cross-database
    // relation write. Always relate tasks to the Daily-Cockpit project row
    // (plan grammar: "+ Daily-Cockpit Project relation so TASKS_QUERY sees
    // it"); the @alias is accepted/parsed but has no valid destination field
    // on this DS, so it is intentionally dropped for tasks.
    const id = deps.createTaskRow(ids.tasksDs, {
      title: item.title, captureId, priority: item.priority, due: item.due,
      projectRelationId: ids.cockpitProjectId,
    });
    return { ds: ids.tasksDs, id };
  }
  if (item.kind === 'decision') {
    if (!ids.decisionsDs) throw new Error('decisionsDs not configured');
    const id = deps.createDecisionRow(ids.decisionsDs, {
      title: item.title, captureId, projectRelationId: item.projectId,
    });
    return { ds: ids.decisionsDs, id };
  }
  // note / idea / later / blocker / question -> PM Notes
  if (!ids.pmNotesDs) throw new Error('pmNotesDs not configured (PM_NOTES_DS placeholder unfilled)');
  const status = (item.kind === 'later' || item.kind === 'blocker') ? 'open' : undefined;
  const id = deps.createPmNoteRow(ids.pmNotesDs, {
    title: item.title, captureId, type: item.kind, status,
    projectRelationId: item.projectId, source: 'triage',
  });
  return { ds: ids.pmNotesDs, id };
}

// Full triage pass over the Capture section of `pageId`.
// Order per item (mitigations #1/#3/#12):
//   replay-hash guard -> findByCaptureId duplicate guard -> create row ->
//   persist created id + hash to state (writeState) BEFORE delete ->
//   RE-FETCH block, compare last_edited_time + text hash vs snapshot;
//   mismatch -> skip delete + conflict receipt; match -> idempotent delete.
export function runTriage({ pageId = MOBILE_COCKPIT_PAGE_ID, dryRun = false, now = new Date(), deps } = {}) {
  const d = { ...defaultDeps(), ...(deps || {}) };
  const result = { consumed: 0, skipped: 0, created: [], conflicts: 0, error: null };
  const consumedEchoes = [];
  const skippedEchoes = [];
  const conflictEchoes = [];

  let blocks;
  try {
    blocks = d.getPageBlocks(pageId);
  } catch (e) {
    result.error = `page read failed: ${e.message}`;
    return result;
  }
  const capture = findSectionBlocks(blocks, CAPTURE_HEADING);
  if (!capture) {
    // Heading rename is non-fatal (plan risk table): warn + no-op.
    console.error(`[triage] WARN: Capture heading not found on ${pageId} — nothing consumed`);
    result.error = 'capture-heading-not-found';
    return result;
  }

  const items = parseCaptureBlocks(capture.blocks, { now, aliases: d.aliases, allowlist: d.allowlist });

  if (dryRun) {
    for (const it of items) {
      if (it.kind === 'skip') { result.skipped += 1; } else { result.consumed += 1; }
    }
    return result;
  }

  const state = d.readState();
  const recent = getTriage(state).recentHashes;

  for (const it of items) {
    if (it.kind === 'skip') {
      result.skipped += 1;
      skippedEchoes.push(it);
      continue;
    }
    try {
      const rHash = replayHash(it.blockId, now);
      let created = null;
      if (recent.includes(rHash)) {
        // Replay (crash after create, before delete): skip the create,
        // still delete the source block below (plan §Files, hash guard).
      } else {
        // Duplicate guard before any create (mitigation #3).
        const dsForKind = it.kind === 'task' ? d.ids.tasksDs
          : it.kind === 'decision' ? d.ids.decisionsDs : d.ids.pmNotesDs;
        const existing = dsForKind ? d.findByCaptureId(dsForKind, it.blockId) : null;
        created = existing ? { ds: dsForKind, id: existing.id } : createRow(it, d);
        // Persist created id + replay hash BEFORE delete (mitigation #3).
        recordTriage(state, { created, hash: rHash, ranAt: now.toISOString() });
        d.writeState(state);
        result.created.push(created);
      }
      // Snapshot->delete race guard (mitigation #1): re-fetch and compare.
      const fresh = d.getBlock(it.blockId);
      const freshText = blockPlainText(fresh);
      const editedMoved = (fresh?.last_edited_time || null) !== it.lastEditedTime
        || textHash(freshText) !== it.hash;
      if (editedMoved) {
        result.conflicts += 1;
        conflictEchoes.push(it);
        if (created) { result.consumed += 1; consumedEchoes.push(it); }
        continue; // leave the block in place
      }
      d.deleteBlock(it.blockId);
      result.consumed += 1;
      consumedEchoes.push(it);
    } catch (e) {
      result.skipped += 1;
      skippedEchoes.push({ ...it, reason: `error: ${e.message}`.slice(0, 80) });
      console.error(`[triage] item ${it.blockId} failed: ${e.message}`);
    }
  }

  // Receipt: prepend to Triage log, keep last 10 (mitigations #6/#8/#11 — bare
  // lines are individually listed via consumedEchoes like every other kind).
  try {
    const line = buildReceiptLine({
      consumed: consumedEchoes.map((c) => ({ kind: c.kind, title: c.title })),
      skipped: skippedEchoes,
      conflicts: conflictEchoes,
      nowIso: now.toISOString().slice(0, 16),
    });
    const log = findSectionBlocks(d.getPageBlocks(pageId), TRIAGE_LOG_HEADING);
    if (!log) {
      console.error(`[triage] WARN: Triage log heading not found on ${pageId} — receipt skipped`);
    } else {
      d.replaceSectionBlocks(pageId, TRIAGE_LOG_HEADING, buildReceiptBlocks(log.blocks, line));
    }
  } catch (e) {
    console.error(`[triage] receipt write failed: ${e.message}`);
  }

  return result;
}
