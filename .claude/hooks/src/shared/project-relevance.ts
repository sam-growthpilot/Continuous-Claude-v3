/**
 * Cross-project relevance detection for ROADMAP contamination guard.
 *
 * When a user plans work for Project B while in Project A's directory,
 * this module detects the mismatch and prevents contamination of
 * Project A's ROADMAP.md.
 *
 * Used by:
 * - post-plan-roadmap.ts (blocks cross-project plan writes)
 * - session-start-continuity.ts (detects contaminated ROADMAP focus)
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'node:os';

export interface ProjectIdentity {
  dirName: string;
  registryName: string | null;
  packageName: string | null;
  projectPath: string;             // resolved absolute path of THIS project
  keywords: string[];              // lowercased words from all sources (raw, incl. toxic generics)
  distinctiveKeywords: string[];   // keywords with generic stopwords removed (the positive signal)
  otherProjects: string[];         // names of OTHER registered projects
  otherProjectTokens: string[];    // distinctive lowercased tokens from OTHER project names
}

export interface RelevanceResult {
  relevant: boolean;
  confidence: 'high' | 'low';
  reason: string;
}

/**
 * Generic tokens that must NEVER serve as a positive own-project signal.
 *
 * "continuous" and "claude" (from `continuous-claude`) are the canonical toxic
 * pair behind SEED-02: bare-token matching let any plan mentioning "claude" or
 * "continuous integration" masquerade as belonging to this project. The rest
 * are infrastructure-generic words that appear in plans for any project.
 */
const IDENTITY_STOPWORDS = new Set<string>([
  'claude',
  'continuous',
  'code',
  'anthropic',
  'project',
  'the',
  'app',
  'platform',
  'engine',
  'server',
  'service',
  'system',
]);

/**
 * Foreign-product markers that are NOT (always) registered as sibling projects
 * yet have demonstrably contaminated this repo's ROADMAP (SEED-02 / Session-9:
 * a "Harden the Alpha + Lay a Solid FastMCP v3 Foundation" Salesforce goal).
 *
 * Kept intentionally small and incident-derived -- this is an S0 quick-win, not
 * a general NLP relevance model. Registry-derived signals (sibling names +
 * sibling distinctive tokens) do the heavy lifting; this list is the safety net
 * for clearly-foreign initiatives whose owning project is not registered here.
 */
const FOREIGN_PROJECT_MARKERS = ['salesforce', 'fastmcp'];

interface RegistryProject {
  name: string;
  path: string;
  [key: string]: unknown;
}

interface Registry {
  projects: RegistryProject[];
}

/**
 * Build a ProjectIdentity for the given project directory.
 *
 * Reads project-registry.json and package.json to gather identity
 * keywords for the current project, plus names of all other projects
 * to detect cross-project references.
 */
export function getProjectIdentity(projectDir: string): ProjectIdentity {
  const resolvedDir = path.resolve(projectDir);
  const dirName = path.basename(resolvedDir);

  const identity: ProjectIdentity = {
    dirName,
    registryName: null,
    packageName: null,
    projectPath: resolvedDir,
    keywords: [],
    distinctiveKeywords: [],
    otherProjects: [],
    otherProjectTokens: [],
  };

  // Collect keywords from directory name
  const dirKeywords = tokenize(dirName);
  const keywordSet = new Set<string>(dirKeywords);
  // The full directory name is a distinctive multi-token identity signal.
  keywordSet.add(dirName.toLowerCase());

  const otherTokenSet = new Set<string>();

  // Try to read project-registry.json
  const registry = readRegistry(resolvedDir);
  if (registry) {
    for (const project of registry.projects) {
      const projectPath = path.resolve(project.path);
      if (projectPath === resolvedDir) {
        // This is our project
        identity.registryName = project.name;
        // Add registry name words as keywords
        for (const w of tokenize(project.name)) keywordSet.add(w);
      } else {
        // This is another project -- record its name and distinctive tokens
        identity.otherProjects.push(project.name);
        for (const w of tokenize(project.name)) {
          if (!IDENTITY_STOPWORDS.has(w)) otherTokenSet.add(w);
        }
      }
    }
  }

  // Try to read package.json for name field
  try {
    const pkgPath = path.join(resolvedDir, 'package.json');
    const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(pkgContent);
    if (pkg.name && typeof pkg.name === 'string') {
      identity.packageName = pkg.name;
      // Add package name words as keywords (strip scope)
      const cleanName = pkg.name.replace(/^@[^/]+\//, '');
      for (const w of tokenize(cleanName)) keywordSet.add(w);
      keywordSet.add(cleanName.toLowerCase());
    }
  } catch {
    // No package.json or parse error -- continue without it
  }

  // Add the registry name itself as a (distinctive, multi-token) keyword if present
  if (identity.registryName) {
    keywordSet.add(identity.registryName.toLowerCase());
  }

  identity.keywords = [...keywordSet];
  // distinctiveKeywords drops the toxic generic tokens so the relevance check
  // never treats a bare "continuous" / "claude" as positive own-project evidence.
  identity.distinctiveKeywords = identity.keywords.filter(kw => !IDENTITY_STOPWORDS.has(kw));
  identity.otherProjectTokens = [...otherTokenSet];
  return identity;
}

/** Split a name into lowercased word tokens (length > 1). */
function tokenize(name: string): string[] {
  return name.toLowerCase().split(/[-_\s]+/).filter(w => w.length > 1);
}

/**
 * Word-boundary, case-insensitive containment test.
 *
 * Crucial for the stopword fix: substring matching let "continuous" match inside
 * "continuous integration" and "claude" match inside unrelated words. We treat a
 * multi-token term (e.g. "continuous-claude") as a contiguous phrase where any
 * `-`/`_`/whitespace in the term may be any whitespace/separator in the content.
 */
function matchesAsWord(content: string, term: string): boolean {
  if (!term) return false;
  const escaped = term
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex metacharacters
    .replace(/[-_\s/]+/g, '[-_\\s/]+');      // term separators match any separator run
  try {
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(content);
  } catch {
    return content.toLowerCase().includes(term.toLowerCase());
  }
}

/**
 * Determine if content is relevant to the given project.
 *
 * POSITIVE OWN-PLAN REQUIREMENT (D2d-01 flip + toxic-keyword stopword fix):
 *
 * The old guard only blocked when content named a *registered* sibling AND
 * lacked this project's identity. An UNREGISTERED foreign goal (Salesforce,
 * FastMCP -- SEED-02) was invisible and passed through, and bare toxic tokens
 * ("continuous", "claude") falsely satisfied the own-project check. This
 * version requires POSITIVE evidence the content belongs to THIS project, and
 * only BLOCKS when there is no such evidence AND the content names some other
 * project-like entity. Genuinely ambiguous content (no project entity named at
 * all) still fails OPEN to avoid breaking legitimate writes.
 *
 * Decision table:
 * 1. Short/empty content                                   -> relevant (fail-open)
 * 2. Has positive own-project signal                       -> relevant
 * 3. No own signal + names a foreign project-like entity   -> NOT relevant (BLOCK)
 * 4. No own signal + no foreign entity (ambiguous)         -> relevant (fail-open)
 */
export function isContentRelevantToProject(content: string, identity: ProjectIdentity): RelevanceResult {
  // Fail-open: short or empty content
  if (!content || content.length < 50) {
    return { relevant: true, confidence: 'low', reason: 'content too short' };
  }

  // --- Positive own-project evidence (word-boundary, stopword-filtered) ---
  // Distinctive names first (registryName / dirName / packageName), then the
  // stopword-filtered distinctive keyword set, then this project's path.
  const distinctiveNames = [identity.registryName, identity.dirName, identity.packageName]
    .filter((n): n is string => !!n);
  for (const name of distinctiveNames) {
    if (matchesAsWord(content, name)) {
      return { relevant: true, confidence: 'high', reason: `matches project identity "${name}"` };
    }
  }
  for (const kw of identity.distinctiveKeywords) {
    if (kw.length < 3) continue; // never let a 1-2 char token vouch for ownership
    if (matchesAsWord(content, kw)) {
      return { relevant: true, confidence: 'high', reason: `matches distinctive keyword "${kw}"` };
    }
  }
  if (identity.projectPath && content.toLowerCase().includes(identity.projectPath.toLowerCase())) {
    return { relevant: true, confidence: 'high', reason: 'mentions this project path' };
  }

  // --- No positive own signal. Is a FOREIGN project-like entity named? ---
  // (a) a registered sibling project, by name
  for (const otherName of identity.otherProjects) {
    if (matchesAsWord(content, otherName)) {
      const thisName = identity.registryName || identity.dirName;
      return {
        relevant: false,
        confidence: 'high',
        reason: `content mentions "${otherName}" but not "${thisName}"`,
      };
    }
  }
  // (b) a registered sibling's distinctive token (registry-derived; catches
  //     "Salesforce" from example-salesforce-mcp without the literal name)
  for (const token of identity.otherProjectTokens) {
    if (token.length < 3) continue;
    if (matchesAsWord(content, token)) {
      const thisName = identity.registryName || identity.dirName;
      return {
        relevant: false,
        confidence: 'high',
        reason: `content mentions foreign project token "${token}" but no "${thisName}" identity`,
      };
    }
  }
  // (c) an incident-derived foreign-product marker (safety net for unregistered
  //     owning projects -- FastMCP, Salesforce)
  for (const marker of FOREIGN_PROJECT_MARKERS) {
    if (matchesAsWord(content, marker)) {
      const thisName = identity.registryName || identity.dirName;
      return {
        relevant: false,
        confidence: 'high',
        reason: `content mentions foreign project "${marker}" but no "${thisName}" identity`,
      };
    }
  }

  // No own signal AND no foreign project entity -> genuinely ambiguous, fail-open.
  return { relevant: true, confidence: 'low', reason: 'no cross-project signals' };
}

/**
 * Read and parse project-registry.json from multiple candidate paths.
 * Returns null if not found or unparseable.
 */
function readRegistry(projectDir: string): Registry | null {
  const ccv3Dir = process.env.CLAUDE_CCV3_DIR || path.join(homedir(), 'continuous-claude');
  const candidates = [
    path.join(projectDir, '.claude', 'project-registry.json'),
    path.join(ccv3Dir, '.claude', 'project-registry.json'),
  ];

  for (const candidate of candidates) {
    try {
      const content = fs.readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.projects)) {
        return parsed as Registry;
      }
    } catch {
      // File not found or parse error -- try next candidate
    }
  }

  return null;
}
