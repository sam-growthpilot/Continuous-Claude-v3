/**
 * QW-06 Fix A (D3b-01) — hybrid floor pins.
 *
 * Pre-fix, the hook floored on the DECAY-ADJUSTED score: a row whose pre-decay
 * base RRF was 0.0154 (comfortably above HYBRID_FLOOR=0.01) was suppressed once
 * freshness decay dropped its effective score to ~0.009 (below the floor). Fix A
 * makes checkDbMemory carry the pre-decay `base_score` into the floor in hybrid
 * mode, so the row survives. These tests pin the floor primitive directly:
 *   - a 0.0154 (base-RRF) row SURVIVES applyFloor(HYBRID_FLOOR)
 *   - a 0.009 (decay-adjusted) row is DROPPED at the same floor
 *
 * In-process import is safe because main()'s on-import auto-run is guarded by
 * `if (!process.env.VITEST)` (QW-06). The real hook is spawned with VITEST unset,
 * so runtime behaviour is unchanged.
 */

import { describe, it, expect } from 'vitest';
import { applyFloor, HYBRID_FLOOR } from '../memory-awareness.js';
import type { MemoryMatch } from '../memory-awareness.js';

/** A single-row hybrid MemoryMatch carrying `score` (the value applyFloor gates on). */
function matchWithScore(score: number): MemoryMatch {
  return {
    count: 1,
    results: [
      { id: 'abc12345', type: 'WORKING_SOLUTION', content: 'hybrid recall floor decay note', score },
    ],
    source: 'db',
  };
}

describe('QW-06 Fix A: hybrid floor on pre-decay base RRF', () => {
  it('HYBRID_FLOOR is 0.01 (RRF fused scores sit in 0.01-0.03)', () => {
    expect(HYBRID_FLOOR).toBe(0.01);
  });

  it('KEEPS a base-RRF 0.0154 row (Fix A: floor on pre-decay base score)', () => {
    const out = applyFloor(matchWithScore(0.0154), HYBRID_FLOOR);
    expect(out).not.toBeNull();
    expect(out!.results).toHaveLength(1);
    expect(out!.results[0].score).toBeCloseTo(0.0154);
  });

  it('DROPS a 0.009 decay-adjusted row (pre-fix this is what got floored out)', () => {
    const out = applyFloor(matchWithScore(0.009), HYBRID_FLOOR);
    expect(out).toBeNull();
  });

  it('the 0.0154 vs 0.009 pair straddles the floor (the exact pre-fix bug)', () => {
    // base-RRF 0.0154 > 0.01 > 0.009 decay-adjusted: the whole point of Fix A
    // is choosing the left value, not the right, in hybrid mode.
    expect(0.0154).toBeGreaterThan(HYBRID_FLOOR);
    expect(0.009).toBeLessThan(HYBRID_FLOOR);
    expect(applyFloor(matchWithScore(0.0154), HYBRID_FLOOR)).not.toBeNull();
    expect(applyFloor(matchWithScore(0.009), HYBRID_FLOOR)).toBeNull();
  });
});
