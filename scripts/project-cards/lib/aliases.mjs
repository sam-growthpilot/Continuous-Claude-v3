// aliases.mjs — loader/validator for capture-aliases.json (mitigation #10:
// aliases are DATA, not generated executable code). Maps short @alias tokens
// (netsuite, sf, ccv3, …) to FourthOS Projects-DB row ids. Populated at setup
// by querying the Projects DS, human-confirmed.
// ESM, no deps. Throws loudly on malformed entries — a bad alias file must
// never silently mis-file a capture.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.mjs';

export const ALIASES_PATH = join(ROOT, 'capture-aliases.json');

// Notion page/row id: 32 lowercase hex chars, dashed (8-4-4-4-12) or bare.
const ID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/;
// Alias keys: short lowercase word chars/hyphens (what the @token grammar emits).
const ALIAS_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

// PURE: validate a parsed aliases document. Returns the aliases map.
export function validateAliases(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('capture-aliases: root must be an object');
  }
  const { aliases } = doc;
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
    throw new Error('capture-aliases: "aliases" must be an object map');
  }
  for (const [alias, id] of Object.entries(aliases)) {
    if (!ALIAS_RE.test(alias)) {
      throw new Error(`capture-aliases: malformed alias key "${alias}" (lowercase word chars/hyphens only)`);
    }
    if (typeof id !== 'string' || !ID_RE.test(id.toLowerCase()) || id !== id.toLowerCase()) {
      throw new Error(`capture-aliases: alias "${alias}" has malformed id "${id}" (expected 32-hex, dashed or bare, lowercase)`);
    }
  }
  return aliases;
}

// Load + validate from disk. Throws on missing/unreadable/malformed file.
export function loadAliases(path = ALIASES_PATH) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`capture-aliases: cannot read ${path}: ${e.message}`);
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new Error(`capture-aliases: invalid JSON in ${path}: ${e.message}`);
  }
  return validateAliases(doc);
}

// Resolve a single @alias token → project row id, or null if unknown
// (unknown alias = unparseable line, left in place — plan grammar rule).
export function resolveAlias(alias, aliases) {
  if (!alias) return null;
  const id = aliases[String(alias).toLowerCase()];
  return id || null;
}
