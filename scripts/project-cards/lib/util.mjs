// util.mjs — pure, unit-testable helpers shared across the project-card engine.
// No side effects, no I/O. ESM, no deps.

// HTML-escape the five significant characters. Mirrors assembler.mjs `esc` exactly
// so canonical HTML hashes agree no matter which module rendered a fragment.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

// Slugify a project name into a filesystem/state-key safe token.
//
// Collision guard: pass the set of slugs already in use (a Set, an array, or a
// plain object/map whose keys are slugs). If the base slug is taken, a numeric
// suffix (-2, -3, ...) is appended until a free token is found, so two different
// projects never collapse to the same slug / state key / output file. The base
// slug is only suffixed on an actual collision — the common case is unchanged.
export function slugify(name, existing) {
  const base = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'card';

  const taken = toSlugSet(existing);
  if (!taken.has(base)) return base;

  let n = 2;
  let candidate = `${base}-${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

// Normalize the various "existing slugs" shapes into a Set for membership tests.
export function toSlugSet(existing) {
  if (!existing) return new Set();
  if (existing instanceof Set) return existing;
  if (Array.isArray(existing)) return new Set(existing);
  if (existing instanceof Map) return new Set(existing.keys());
  if (typeof existing === 'object') return new Set(Object.keys(existing));
  return new Set();
}

// Human-readable timestamp for the card "as of" captions.
// e.g. "Fri, Jul 3, 2026, 09:14 PM"
export function dateStamp(d = new Date()) {
  return d.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
