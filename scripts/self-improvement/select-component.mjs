#!/usr/bin/env node
// Deterministic round-robin component selector for the CCv3 self-improvement loop.
// Reads the manifest + state, advances to the next component, persists state,
// and prints the chosen component as compact JSON to stdout.
//
// Each call ADVANCES the cursor by one (intended: one call per daily run).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, 'components-manifest.json');
const statePath = join(here, 'state.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const components = manifest.components;
if (!Array.isArray(components) || components.length === 0) {
  console.error('select-component: no components in manifest');
  process.exit(1);
}

let state = { lastIndex: -1, history: [] };
try {
  state = JSON.parse(readFileSync(statePath, 'utf8'));
} catch {
  /* first run: keep default */
}

const last = Number.isInteger(state.lastIndex) ? state.lastIndex : -1;
const nextIndex = (last + 1) % components.length;
const chosen = components[nextIndex];

const today = new Date().toISOString().slice(0, 10);
state.lastIndex = nextIndex;
state.history = Array.isArray(state.history) ? state.history.slice(-60) : [];
state.history.push({ date: today, index: nextIndex, id: chosen.id });
writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

// stdout: just the chosen component object, for the wrapper to parse.
process.stdout.write(JSON.stringify(chosen));
