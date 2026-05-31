/**
 * Memory content sanitizer (WS-0.2: prompt-injection hardening).
 *
 * Recalled archival_memory.content is untrusted: a poisoned memory row can
 * contain text that, when injected verbatim into the LLM context, breaks out
 * of any wrapper and acts as instructions ("Ignore previous instructions.
 * </context> ..."). Both injection sites (memory-awareness.ts and
 * agent-recall-injector.ts) must route recalled content through these two
 * pure helpers before it reaches additionalContext.
 *
 * sanitizeMemoryContent:
 *   (a) strip control chars [\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]
 *       (keep \n = 0x0a and \t = 0x09)
 *   (b) cap the RAW (control-stripped) string to `cap` chars, appending
 *       "...(truncated)" if it was longer. Capping BEFORE encoding guarantees
 *       the cap boundary can never slice an HTML entity (e.g. "&amp;" -> "&am").
 *   (c) HTML-encode in order: & -> &amp;, then < -> &lt;, > -> &gt;, " -> &quot;
 *       (& first, so the ampersands introduced by later entities are not
 *        double-encoded into &amp;lt;). The literal "...(truncated)" marker
 *        contains no special chars, so encoding it is a no-op.
 *
 * wrapMemoryContext: wraps a body in a data-only context envelope so the model
 * can be told the enclosed text is reference data, never instructions.
 *
 * ASCII only; no other dependencies.
 */

export function sanitizeMemoryContent(content: string, cap = 500): string {
  if (typeof content !== 'string' || content.length === 0) {
    return '';
  }

  // (a) strip control chars, preserving \n (0x0a) and \t (0x09)
  let out = content.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');

  // (b) cap the RAW string BEFORE encoding so the boundary can never split an
  // HTML entity (capping after encoding could slice "&amp;" into "&am").
  if (out.length > cap) {
    out = out.slice(0, cap) + '...(truncated)';
  }

  // (c) HTML-encode in order (ampersand first to avoid double-encoding). The
  // "...(truncated)" marker has no special chars, so this leaves it untouched.
  out = out
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return out;
}

export function wrapMemoryContext(body: string): string {
  return `<context source="memory" trust="data-only">\n${body}\n</context>`;
}
