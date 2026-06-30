#!/usr/bin/env node
// Appends one row to docs/self-improvement/INDEX.md from a finished proposal's YAML frontmatter.
// Runs AFTER the headless research session writes its proposal, so INDEX updates stay
// deterministic and the research LLM never needs Edit/append on a shared file.
//
// Usage: node record-index.mjs <date YYYY-MM-DD> <componentId>
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..'); // scripts/self-improvement -> repo root

const [date, componentId] = process.argv.slice(2);
if (!date || !componentId) {
  console.error('usage: record-index.mjs <date YYYY-MM-DD> <componentId>');
  process.exit(1);
}

const proposalPath = join(repo, 'docs', 'self-improvement', 'proposals', `${date}-${componentId}.md`);
const indexPath = join(repo, 'docs', 'self-improvement', 'INDEX.md');

if (!existsSync(proposalPath)) {
  console.error(`record-index: proposal not found at ${proposalPath} (research run may have failed) — no INDEX row written`);
  process.exit(2);
}

const body = readFileSync(proposalPath, 'utf8');
const fm = {};
const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (m) {
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}

const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
const verdict = esc(fm.verdict) || 'unknown';
const name = esc(fm.component_name) || componentId;
const headline = esc(fm.headline);
const sources = esc(fm.sources);
const rel = `proposals/${date}-${componentId}.md`;
const row = `| ${date} | ${name} | ${verdict} | ${headline} | ${sources} | [proposal](${rel}) |\n`;

appendFileSync(indexPath, row);
process.stdout.write(`record-index: appended row for ${date}-${componentId} (verdict=${verdict}, sources=${sources})\n`);
