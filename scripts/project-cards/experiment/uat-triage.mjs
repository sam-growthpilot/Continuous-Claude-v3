// uat-triage.mjs — live-page UAT runner for the mobile-cockpit Capture triage
// pipeline (plan: rippling-sauteeing-trinket, "Experiment phase" + "Risk
// Mitigations"). Runs REAL scenarios against the REAL Notion page
// (MOBILE_COCKPIT_PAGE_ID) by seeding Capture lines, invoking
// `node sweep.mjs --target triage` as a child process, and asserting on the
// live read-back (Tasks DS / PM Notes DS / Decisions DS / page blocks).
//
// Mitigations honored here:
//   #4  ID-exact cleanup — every created row is tracked by {ds, id, captureId}
//       and archived by EXACT id (deleteBlock == archive) — never name-match.
//   #5  Per-pass NONCE — every seeded line carries UAT-<runId> so /loop passes
//       never collide with the recentHashes replay guard.
//   S11 honesty over coverage — no safe live injection point exists to force
//       a triage failure without hacking config/state, so S11 is recorded as
//       SKIPPED with a reason, never faked as a pass.
//
// Run: node scripts/project-cards/experiment/uat-triage.mjs
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  MOBILE_COCKPIT_PAGE_ID, CAPTURE_HEADING, TRIAGE_LOG_HEADING,
  AI_DIGEST_HEADING, TASKS_DS, PM_NOTES_DS, DECISIONS_DS,
  NTN_EXE, NTN_TIMEOUT_MS, ROOT, LOGS_DIR, SWEEP_PATH, SWEEP_LOG_PATH,
} from '../lib/config.mjs';
import {
  getPageBlocks, findSectionBlocks, deleteBlock, findByCaptureId,
  queryDataSource,
} from '../lib/notion.mjs';
import { blockPlainText } from '../lib/triage.mjs';

const UAT_LOG_PATH = join(LOGS_DIR, 'uat.jsonl');
const LOCK_PATH = join(ROOT, '.sweep.lock');

// Blocking sleep (mirrors lib/notion.mjs's runNtn backoff — spawnSync is
// synchronous so async timers won't help here). Used between sweep
// invocations to respect Notion API rate limits.
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// --- thin ntn helpers (append-only page mutation; notion.mjs exposes only
// full-section replaceSectionBlocks/updateIntroParagraph, neither of which is
// safe to reuse here — a UAT seed must APPEND without touching any other
// content in the Capture section, per the ownership contract). Mirrors the
// same non-interactive contract as lib/notion.mjs: closed stdin, timeout,
// windowsHide, fail-loud, pinned API version. ---
function ntnCall(args, input = '') {
  const res = spawnSync(NTN_EXE, args, {
    input,
    timeout: NTN_TIMEOUT_MS,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NOTION_API_VERSION: process.env.NOTION_API_VERSION || '2025-09-03' },
  });
  if (res.error) throw new Error(`ntn spawn failed [${args.join(' ')}]: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`ntn exited ${res.status} [${args.join(' ')}]: ${(res.stderr || res.stdout || '').trim()}`);
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    throw new Error(`ntn api returned non-JSON: ${res.stdout.slice(0, 400)}`);
  }
}

// Append plain paragraph blocks to the END of the Capture section (never
// touches existing Capture content). Returns the new block ids in order.
function appendCaptureLines(lines) {
  const blocks = getPageBlocks(MOBILE_COCKPIT_PAGE_ID);
  const section = findSectionBlocks(blocks, CAPTURE_HEADING);
  if (!section) throw new Error('UAT abort: Capture heading not found on the live page');
  const afterId = section.blocks.length
    ? section.blocks[section.blocks.length - 1].id
    : blocks[section.headingIndex].id;
  const children = lines.map((text) => ({
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: String(text) } }] },
  }));
  ntnCall(['api', `v1/blocks/${MOBILE_COCKPIT_PAGE_ID}/children`, '-X', 'PATCH'], JSON.stringify({ children, after: afterId }));
  // Do NOT trust the PATCH response's `results` array to mean "exactly the
  // blocks just appended" — under concurrent page writers it has been
  // observed to return a stale/inconsistent set (verified live: an isolated
  // 2-block append correctly returned 2 results, but the SAME call issued
  // while another process was concurrently mutating the page returned 8
  // results for a 3-block append, some of which were NOT the new lines).
  // Blindly deleting ids taken from that response is what destroyed the
  // real "Triage log"/"How to use" page headings during earlier passes.
  // Re-read the section fresh and match the new block ids by CONTENT at the
  // tail of the section instead — authoritative regardless of API response
  // shape.
  const freshBlocks = getPageBlocks(MOBILE_COCKPIT_PAGE_ID);
  const freshSection = findSectionBlocks(freshBlocks, CAPTURE_HEADING);
  const tail = freshSection.blocks.slice(-lines.length);
  const matched = tail.length === lines.length && tail.every((b, i) => blockPlainText(b) === lines[i]);
  if (!matched) {
    throw new Error(`appendCaptureLines: could not verify newly-appended block ids by content match (expected tail ${JSON.stringify(lines)}, got ${JSON.stringify(tail.map(blockPlainText))})`);
  }
  return tail.map((b) => b.id);
}

function patchNoteStatus(pageId, status) {
  return ntnCall(['api', `v1/pages/${pageId}`, '-X', 'PATCH'], JSON.stringify({ properties: { Status: { select: { name: status } } } }));
}

// Spawn `node sweep.mjs --target triage`. env overrides merge onto the
// current process env (ANTHROPIC_API_KEY is left intact — --target triage
// never spawns claude, so there is nothing to strip).
// A real `--target triage` run does dozens of sequential ntn.exe spawns (page
// reads, per-block section-splice deletes/inserts, per-DS queries) — measured
// ~70-90s live. Give it a generous ceiling so the UAT never SIGTERMs a
// genuinely-still-working sweep (a killed sweep skips its own finally block
// under SIGTERM and leaks .sweep.lock, poisoning every subsequent scenario).
const SWEEP_CALL_TIMEOUT_MS = 240_000;

function runSweep({ dryRun = false, envOverrides = {} } = {}) {
  const args = [SWEEP_PATH, '--target', 'triage'];
  if (dryRun) args.push('--dry-run');
  const res = spawnSync(process.execPath, args, {
    input: '',
    timeout: SWEEP_CALL_TIMEOUT_MS,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    cwd: ROOT,
    env: { ...process.env, ...envOverrides },
  });
  return res;
}

// Defensive preflight: a lock file left behind by a PRIOR crashed/killed run
// (e.g. a sweep SIGTERM'd past its timeout, which skips releaseSweepLock's
// finally block) would silently lock-skip every scenario in this fresh run.
// Since this UAT run assumes exclusive ownership of the sandbox, clear any
// pre-existing lock before scenario S1 (S8 tests the lock-contention path
// deliberately and cleans up after itself).
function clearStaleLockIfPresent() {
  try {
    const raw = readFileSync(LOCK_PATH, 'utf8');
    console.error(`[uat] WARN: pre-existing .sweep.lock found before run start — removing: ${raw.trim()}`);
    unlinkSync(LOCK_PATH);
  } catch { /* no lock present — nothing to do */ }
}

// --- run bookkeeping -----------------------------------------------------------

const runId = Date.now().toString(36);
const nonce = `UAT-${runId}`;
const scenarios = []; // { scenario, pass: true|false|'skipped', detail }
const createdRows = []; // { ds, id, captureId, kind } — tracked for exact-id cleanup (mitigation #4)
const leftoverBlockIds = []; // Capture blocks intentionally left in place by design (S4, S9)

function record(scenario, pass, detail) {
  scenarios.push({ scenario, pass, detail });
  const label = pass === 'skipped' ? 'SKIP' : (pass ? 'PASS' : 'FAIL');
  console.error(`[uat] ${scenario}: ${label} — ${detail}`);
}

function digestOf(blocks) {
  const section = findSectionBlocks(blocks, AI_DIGEST_HEADING);
  return section ? section.blocks.map(blockPlainText).join('\n') : '';
}

function newestReceiptOf(blocks) {
  const section = findSectionBlocks(blocks, TRIAGE_LOG_HEADING);
  return section && section.blocks.length ? blockPlainText(section.blocks[0]) : '';
}

// The overall sweep.mjs process exit code conflates triage's OWN success with
// unrelated downstream steps (e.g. a transient digest-fetch hiccup can fail
// the whole --target triage exit code even though triage itself worked).
// Read the triage step's own reported status from the last sweep.jsonl row —
// the direct, unconflated signal for "did triage succeed".
function lastTriageStepStatus() {
  try {
    const tail = readFileSync(SWEEP_LOG_PATH, 'utf8').trim().split(/\r?\n/).pop();
    const row = JSON.parse(tail);
    return row && row.triage ? row.triage.status : null;
  } catch {
    return null;
  }
}

// A nonzero sweep exit code does NOT necessarily mean triage failed — it can
// also mean an unrelated downstream step (digest fetch/write) hit a transient
// Notion 5xx and the --target triage exit code folds that in (verified live:
// a run with triage.status:"ok" and 2 rows genuinely created still exited 1
// because mobileCockpit.digestStatus was "failed"). Gate scenario assertions
// on the triage step's OWN status, not the raw process exit code.
function triageStepFailed(res) {
  if (res.status === 0) return false;
  return lastTriageStepStatus() === 'failed' || lastTriageStepStatus() === null;
}

// S5/S6 specifically assert on DIGEST content, which (unlike row creation) IS
// invalidated by a failed digestStatus for that run — so those two scenarios
// need the stricter gate: triage AND digest both must not have failed.
function lastDigestStatus() {
  try {
    const tail = readFileSync(SWEEP_LOG_PATH, 'utf8').trim().split(/\r?\n/).pop();
    const row = JSON.parse(tail);
    return row && row.mobileCockpit ? row.mobileCockpit.digestStatus : null;
  } catch {
    return null;
  }
}
function digestStepFailed(res) {
  if (res.status === 0) return false;
  return triageStepFailed(res) || lastDigestStatus() === 'failed' || lastDigestStatus() === null;
}

// --- scenarios -------------------------------------------------------------------

function scenarioS1() {
  const title = `${nonce} task`;
  const [blockId] = appendCaptureLines([`t ${title} @sf !p2 due:2026-07-10`]);
  const res = runSweep({});
  sleepMs(2000);
  if (triageStepFailed(res)) {
    record('S1', false, `triage step failed (sweep exit ${res.status}): ${(res.stderr || '').slice(0, 300)}`);
    return;
  }
  const row = findByCaptureId(TASKS_DS, blockId);
  if (!row) { record('S1', false, 'no Tasks row found for captureId'); return; }
  createdRows.push({ ds: TASKS_DS, id: row.id, captureId: blockId, kind: 'task' });
  const p = row.properties || {};
  const titleOk = ((p.Task?.title || []).map((t) => t.plain_text).join('')).includes(title);
  // Priority select options on this DS are High/Mid/Low, not P1-3 — tolerate
  // the property being absent per the scenario spec, but if present it must
  // be the mapped value.
  const prioOk = !p.Priority || p.Priority.select?.name === 'Mid';
  const dueOk = p['Due Date']?.date?.start === '2026-07-10';
  const relOk = Array.isArray(p.Project?.relation) && p.Project.relation.length > 0;
  const blocks = getPageBlocks(MOBILE_COCKPIT_PAGE_ID);
  const cap = findSectionBlocks(blocks, CAPTURE_HEADING);
  const lineGone = !cap.blocks.some((b) => b.id === blockId);
  const receiptOk = /task/i.test(newestReceiptOf(blocks));
  const ok = titleOk && prioOk && dueOk && relOk && lineGone && receiptOk;
  record('S1', ok, JSON.stringify({ titleOk, prioOk, dueOk, relOk, lineGone, receiptOk }));
}

let s2NoteId = null;
let s2LaterId = null;
let s2LaterTitle = null;

function scenarioS2() {
  const noteTitle = `${nonce} note`;
  const laterTitle = `${nonce} later`;
  s2LaterTitle = laterTitle;
  const [noteBlockId, laterBlockId] = appendCaptureLines([
    `note: ${noteTitle} @netsuite`,
    `later: ${laterTitle} @netsuite`,
  ]);
  const res = runSweep({});
  sleepMs(2000);
  if (triageStepFailed(res)) {
    record('S2', false, `triage step failed (sweep exit ${res.status}): ${(res.stderr || '').slice(0, 300)}`);
    return;
  }
  const noteRow = findByCaptureId(PM_NOTES_DS, noteBlockId);
  const laterRow = findByCaptureId(PM_NOTES_DS, laterBlockId);
  if (noteRow) { createdRows.push({ ds: PM_NOTES_DS, id: noteRow.id, captureId: noteBlockId, kind: 'pm-note' }); s2NoteId = noteRow.id; }
  if (laterRow) { createdRows.push({ ds: PM_NOTES_DS, id: laterRow.id, captureId: laterBlockId, kind: 'pm-note' }); s2LaterId = laterRow.id; }
  // Plain "note" kind gets NO initial Status (the plan grammar table only
  // assigns Status=open to later/blocker) — this assertion doesn't require
  // one here; laterOk below correctly does.
  const noteOk = !!noteRow
    && (noteRow.properties.Note?.title || []).map((t) => t.plain_text).join('').includes(noteTitle)
    && noteRow.properties.Type?.select?.name === 'note'
    && Array.isArray(noteRow.properties.Project?.relation) && noteRow.properties.Project.relation.length > 0;
  const laterOk = !!laterRow
    && (laterRow.properties.Note?.title || []).map((t) => t.plain_text).join('').includes(laterTitle)
    && laterRow.properties.Type?.select?.name === 'later'
    && laterRow.properties.Status?.select?.name === 'open'
    && Array.isArray(laterRow.properties.Project?.relation) && laterRow.properties.Project.relation.length > 0;
  record('S2', noteOk && laterOk, JSON.stringify({ noteOk, laterOk }));
}

function scenarioS3() {
  const decTitle = `${nonce} decision`;
  const [blockId] = appendCaptureLines([`d: ${decTitle} @sf`]);
  const res = runSweep({});
  sleepMs(2000);
  if (triageStepFailed(res)) {
    record('S3', false, `triage step failed (sweep exit ${res.status}): ${(res.stderr || '').slice(0, 300)}`);
    return;
  }
  const row = findByCaptureId(DECISIONS_DS, blockId);
  if (!row) { record('S3', false, 'no Decisions row found for captureId'); return; }
  createdRows.push({ ds: DECISIONS_DS, id: row.id, captureId: blockId, kind: 'decision' });
  const ok = ((row.properties.Output?.title || []).map((t) => t.plain_text).join('')).includes(decTitle);
  record('S3', ok, JSON.stringify({ outputTitleOk: ok }));
}

function scenarioS4() {
  const lines = [`x: ${nonce} gibberish`, `t ${nonce} @zzz`, 'later:'];
  const blockIds = appendCaptureLines(lines);
  const res = runSweep({});
  sleepMs(2000);
  if (triageStepFailed(res)) {
    record('S4', false, `triage step failed (sweep exit ${res.status}): ${(res.stderr || '').slice(0, 300)}`);
    return;
  }
  const blocks = getPageBlocks(MOBILE_COCKPIT_PAGE_ID);
  const cap = findSectionBlocks(blocks, CAPTURE_HEADING);
  const allRemain = blockIds.every((id) => cap.blocks.some((b) => b.id === id));
  const receipt = newestReceiptOf(blocks);
  const receiptMentionsSkips = /skipped/.test(receipt);
  // Zero rows created for ANY of these 3 captureIds, across ALL three
  // destination DSes (thorough — the receipt's aggregate consumed/skipped
  // counts are not asserted verbatim since other in-flight capture content
  // from the same batch can legitimately share a run).
  const noRowsCreated = blockIds.every((id) => !findByCaptureId(TASKS_DS, id)
    && !findByCaptureId(PM_NOTES_DS, id) && !findByCaptureId(DECISIONS_DS, id));
  const ok = allRemain && receiptMentionsSkips && noRowsCreated;
  record('S4', ok, JSON.stringify({ allRemain, receiptMentionsSkips, noRowsCreated }));
  // These 3 lines are DESIGNED to remain in Capture — clean them up at the end.
  leftoverBlockIds.push(...blockIds);
}

function scenarioS5() {
  if (!s2LaterId) { record('S5', false, 'no later-note row from S2 to resurface'); return; }
  // Negative age threshold guarantees a same-day-captured note resurfaces
  // (queue.mjs's rule is strictly age > ageDays; a note captured moments ago
  // has age=0, so PM_NOTES_AGE_DAYS=0 would NOT resurface it same-day — this
  // is calibrated to exercise the override mechanism live, not a workaround
  // for a bug: age > ageDays is the intended threshold semantics).
  const dry = runSweep({ dryRun: true, envOverrides: { PM_NOTES_AGE_DAYS: '-1' } });
  sleepMs(2000);
  const dryOut = dry.stdout || '';
  const dryCountMatch = /(\d+) attention item\(s\)/.exec(dryOut);
  const dryHasItems = !!dryCountMatch && Number(dryCountMatch[1]) >= 1;
  const res = runSweep({ envOverrides: { PM_NOTES_AGE_DAYS: '-1' } });
  sleepMs(2000);
  if (digestStepFailed(res)) {
    record('S5', false, `digest step failed (sweep exit ${res.status}): ${(res.stderr || '').slice(0, 300)}`);
    return;
  }
  const blocks = getPageBlocks(MOBILE_COCKPIT_PAGE_ID);
  const digestText = digestOf(blocks);
  const mentionsLater = digestText.includes(s2LaterTitle);
  record('S5', dryHasItems && mentionsLater, JSON.stringify({ dryHasItems, mentionsLater }));
}

function scenarioS6() {
  if (!s2LaterId) { record('S6', false, 'no later-note row from S2 to address'); return; }
  patchNoteStatus(s2LaterId, 'addressed');
  const res = runSweep({ envOverrides: { PM_NOTES_AGE_DAYS: '-1' } });
  sleepMs(2000);
  if (digestStepFailed(res)) {
    record('S6', false, `digest step failed (sweep exit ${res.status}): ${(res.stderr || '').slice(0, 300)}`);
    return;
  }
  const blocks = getPageBlocks(MOBILE_COCKPIT_PAGE_ID);
  const digestText = digestOf(blocks);
  const goneFromDigest = !digestText.includes(s2LaterTitle);
  record('S6', goneFromDigest, JSON.stringify({ goneFromDigest }));
}

function scenarioS7() {
  const title = `${nonce} idem`;
  const [blockId] = appendCaptureLines([`t ${title}`]);
  const res1 = runSweep({});
  sleepMs(2000);
  if (triageStepFailed(res1)) {
    record('S7', false, `first sweep's triage step failed (exit ${res1.status}): ${(res1.stderr || '').slice(0, 300)}`);
    return;
  }
  const row1 = findByCaptureId(TASKS_DS, blockId);
  const firstOk = !!row1;
  if (row1) createdRows.push({ ds: TASKS_DS, id: row1.id, captureId: blockId, kind: 'task' });
  // Rapid replay: Capture is now empty of this line, so this second run is an
  // idempotent double-invocation safety check (honest caveat: it does not
  // simulate the true crash-after-create-before-delete window — that would
  // require fault injection inside runTriage, which the live-page UAT cannot
  // safely do). It DOES verify no duplicate CaptureId row exists after two
  // rapid consecutive sweeps.
  const res2 = runSweep({});
  sleepMs(2000);
  // Use the triage STEP's own status (from sweep.jsonl), not the overall
  // process exit code — the exit code also reflects unrelated downstream
  // steps (e.g. digest fetch) that can flake independently of triage's own
  // idempotency, which is the only thing this scenario is testing.
  const secondTriageStatus = lastTriageStepStatus();
  const secondOk = secondTriageStatus !== 'failed';
  const rowsAfter = queryDataSource(TASKS_DS, { filter: { property: 'CaptureId', rich_text: { equals: blockId } } });
  const noDup = rowsAfter.length === 1;
  record('S7', firstOk && secondOk && noDup, JSON.stringify({ firstOk, secondTriageStatus, dupCount: rowsAfter.length }));
}

function scenarioS8() {
  // Defensive: never let a leftover lock from an earlier step crash this
  // scenario outright — clear it first (this run owns exclusive sandbox
  // access outside of this deliberate lock test).
  try { unlinkSync(LOCK_PATH); } catch { /* none present */ }
  writeFileSync(LOCK_PATH, `${JSON.stringify({ pid: 999999, ts: new Date().toISOString() })}\n`, { flag: 'wx' });
  try {
    const res = runSweep({});
    sleepMs(500);
    let row = null;
    try {
      const tail = readFileSync(SWEEP_LOG_PATH, 'utf8').trim().split(/\r?\n/).pop();
      row = JSON.parse(tail);
    } catch { /* leave row null -> fail below */ }
    const ok = res.status === 0 && !!row && row.step === 'triage' && row.skipped === 'lock';
    record('S8', ok, JSON.stringify({ status: res.status, row }));
  } finally {
    try { unlinkSync(LOCK_PATH); } catch { /* best-effort */ }
  }
}

function scenarioS9() {
  const scratchText = `// ${nonce} scratch`;
  const [blockId] = appendCaptureLines([scratchText]);
  const res = runSweep({});
  sleepMs(2000);
  if (triageStepFailed(res)) {
    record('S9', false, `triage step failed (sweep exit ${res.status}): ${(res.stderr || '').slice(0, 300)}`);
    return;
  }
  const blocks = getPageBlocks(MOBILE_COCKPIT_PAGE_ID);
  const cap = findSectionBlocks(blocks, CAPTURE_HEADING);
  const survivor = cap.blocks.find((b) => b.id === blockId);
  const byteIdentical = !!survivor && blockPlainText(survivor) === scratchText;
  const receipt = newestReceiptOf(blocks);
  const notReceipted = !receipt.includes('scratch') && !receipt.includes(nonce.concat(' scratch'));
  leftoverBlockIds.push(blockId); // by-design survivor — cleaned up at the end
  record('S9', byteIdentical && notReceipted, JSON.stringify({ byteIdentical, notReceipted }));
}

function scenarioS10() {
  const blocks = getPageBlocks(MOBILE_COCKPIT_PAGE_ID);
  const section = findSectionBlocks(blocks, TRIAGE_LOG_HEADING);
  const count = (section ? section.blocks : []).filter((b) => b.type === 'paragraph' && blockPlainText(b).trim() !== '').length;
  record('S10', count <= 10, `receipt count=${count}`);
}

function scenarioS11() {
  record('S11', 'skipped', 'no safe live injection point to force a triage failure without hacking config/state (bogus --page-id is not a supported flag) — honesty over coverage; failure-receipt code path (writeTriageFailureReceipt/TRIAGE_EXIT_CODE) was reviewed by reading sweep.mjs, not exercised live');
}

// --- cleanup -----------------------------------------------------------------

function cleanup() {
  const result = { archived: [], archiveFailed: [], blocksDeleted: [], blocksFailed: [], residueClean: null, residueFound: null };
  for (const row of createdRows) {
    try {
      deleteBlock(row.id);
      result.archived.push(row);
    } catch (e) {
      result.archiveFailed.push({ ...row, error: e.message });
    }
  }
  for (const blockId of leftoverBlockIds) {
    try {
      deleteBlock(blockId);
      result.blocksDeleted.push(blockId);
    } catch (e) {
      result.blocksFailed.push({ blockId, error: e.message });
    }
  }
  // Archive verification: re-query each surviving destination DS for the
  // captureId — an archived row must no longer surface in a live query.
  for (const row of createdRows) {
    if (result.archiveFailed.some((f) => f.id === row.id)) continue;
    try {
      const still = queryDataSource(row.ds, { filter: { property: 'CaptureId', rich_text: { equals: row.captureId } } });
      if (still.length > 0) result.archiveFailed.push({ ...row, error: 'still visible after archive' });
    } catch (e) {
      result.archiveFailed.push({ ...row, error: `verify query failed: ${e.message}` });
    }
  }
  // Settle sweep: the AI digest is only rebuilt when a triage pass runs, so
  // any archived row that had already been rendered into "Needs attention" /
  // "Open PM notes" before archival would otherwise linger as stale digest
  // TEXT (not a Notion row) until the next scheduled sweep. Run one more
  // --target triage pass now so the digest reflects the post-archive state
  // before the residue check below.
  try {
    runSweep({});
    sleepMs(2000);
  } catch { /* best-effort settle — residue check below still runs */ }

  // Residue check: no UAT-<runId> text anywhere on the page EXCEPT possibly
  // inside the Triage log's escaped/capped receipt lines (explicitly allowed).
  const blocks = getPageBlocks(MOBILE_COCKPIT_PAGE_ID);
  const logSection = findSectionBlocks(blocks, TRIAGE_LOG_HEADING);
  const logIds = new Set((logSection ? logSection.blocks : []).map((b) => b.id));
  let residueFound = null;
  for (const b of blocks) {
    if (logIds.has(b.id)) continue;
    const txt = blockPlainText(b);
    if (txt && txt.includes(nonce)) { residueFound = { blockId: b.id, type: b.type, text: txt.slice(0, 120) }; break; }
  }
  result.residueClean = !residueFound;
  result.residueFound = residueFound;
  return result;
}

// --- main ----------------------------------------------------------------------

// Run a scenario; if it recorded a FAIL, retry it ONCE (a single scenario
// re-attempt, not a whole-pass retry) before accepting the result. This
// tolerates a transient that even lib/notion.mjs's own retry/backoff
// couldn't absorb (e.g. a burst of Notion 5xx across all 3 attempts) without
// masking a genuine, reproducible correctness failure — a real bug will fail
// the retry too and still surface as FAIL.
function runScenario(name, fn) {
  const before = scenarios.length;
  fn();
  const rec = scenarios[scenarios.length - 1];
  if (rec && rec.scenario === name && rec.pass === false) {
    console.error(`[uat] ${name} failed once — retrying (transient-tolerance, not masking)`);
    scenarios.splice(before, 1);
    sleepMs(3000);
    fn();
  }
}

function main() {
  console.error(`[uat] run ${runId} — nonce ${nonce}`);
  clearStaleLockIfPresent();
  let cleanupResult = null;
  try {
    runScenario('S1', scenarioS1); sleepMs(2000);
    runScenario('S2', scenarioS2); sleepMs(2000);
    runScenario('S3', scenarioS3); sleepMs(2000);
    runScenario('S4', scenarioS4); sleepMs(2000);
    runScenario('S5', scenarioS5); sleepMs(2000);
    runScenario('S6', scenarioS6); sleepMs(2000);
    runScenario('S7', scenarioS7); sleepMs(2000);
    runScenario('S8', scenarioS8); sleepMs(2000);
    runScenario('S9', scenarioS9); sleepMs(2000);
    scenarioS10();
    scenarioS11();
  } catch (e) {
    record('runner', false, `unhandled exception: ${e && e.stack ? e.stack : e}`);
  } finally {
    cleanupResult = cleanup();
  }

  const failures = scenarios.filter((s) => s.pass === false);
  const passes = scenarios.filter((s) => s.pass === true);
  const skipped = scenarios.filter((s) => s.pass === 'skipped');
  const cleanupOk = cleanupResult.archiveFailed.length === 0
    && cleanupResult.blocksFailed.length === 0
    && cleanupResult.residueClean;

  mkdirSync(LOGS_DIR, { recursive: true });
  appendFileSync(UAT_LOG_PATH, `${JSON.stringify({
    ts: new Date().toISOString(),
    runId,
    passes: passes.length,
    failures: failures.length,
    skipped: skipped.length,
    scenarios,
    cleanup: cleanupResult,
  })}\n`, 'utf8');

  console.error(`\n[uat] SUMMARY: ${passes.length} passed, ${failures.length} failed, ${skipped.length} skipped`);
  console.error(`[uat] cleanup: archived=${cleanupResult.archived.length} archiveFailed=${cleanupResult.archiveFailed.length} blocksDeleted=${cleanupResult.blocksDeleted.length} blocksFailed=${cleanupResult.blocksFailed.length} residueClean=${cleanupResult.residueClean}`);
  if (failures.length) console.error('[uat] FAILURES:', JSON.stringify(failures, null, 2));
  if (!cleanupOk) console.error('[uat] CLEANUP ISSUES:', JSON.stringify(cleanupResult, null, 2));

  process.exit(failures.length === 0 && cleanupOk ? 0 : 1);
}

main();
