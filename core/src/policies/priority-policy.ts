/**
 * PriorityPolicy — the strategy seam for scoring an item's priority.
 *
 * SPEC.md §5 fixes the signature (`score(item, context) -> priority`) but
 * deliberately leaves the scoring logic undefined — "their logic is
 * deliberately undefined here — only the seams are fixed." Scoring is
 * tunable, so it lives behind this interface, resolved at the composition
 * root (AGENTS.md §2 rule 3), never hardcoded into the `Library` aggregate
 * (IMPLEMENTATION.md Phase 1a item 8).
 */

import type { MetadataToken } from "../metadata/metadata-token.js";
import { toPriority, type Priority, type PriorityContext } from "../priority/priority.js";

/**
 * Scores a single item's priority given its current context. Implementations
 * are pure functions of their inputs — no I/O, no ambient clock (context
 * carries whatever time-derived signals are needed, already computed by the
 * caller via `ClockPort`).
 */
export interface PriorityPolicy {
  score(item: MetadataToken, context: PriorityContext): Priority;
}

/** Relative weight given to each signal when combining them into one `Priority` scalar. */
export interface PriorityWeights {
  readonly userRank: number;
  readonly recency: number;
  readonly hopCount: number;
  readonly dwell: number;
}

/**
 * Naive default weights, chosen to make each signal's intended direction
 * legible rather than to be tuned for any particular outcome:
 *
 * - `userRank` dominates when present — an explicit user signal should
 *   outrank inferred ones.
 * - `recency` is negative: a *larger* `recencyMs` (older) should *lower*
 *   priority.
 * - `hopCount` is negative: more hops from origin should lower priority.
 * - `dwell` is positive but small: time spent kept is a weak signal that
 *   directly floods the score before proving itself is undesirable.
 *
 * These are a starting point, not a considered tuning — see
 * IMPLEMENTATION.md item 8 ("naive default implementation").
 */
export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  userRank: 100,
  recency: -1 / 60_000, // one point lost per minute of age
  hopCount: -10,
  dwell: 1 / 3_600_000, // one point gained per hour dwelled
};

/**
 * Naive default `PriorityPolicy`: a weighted linear combination of the four
 * candidate signals named in SPEC.md §5. `userRank` is treated as neutral
 * (contributes 0) when the item has not been explicitly ranked, rather than
 * being coerced to a numeric default that would read as "ranked at zero."
 *
 * This is intentionally simple — documented here rather than left
 * unexplained, per IMPLEMENTATION.md item 8's call for *a* naive default,
 * not a tuned one. Composition roots are free to register a different
 * `PriorityPolicy` (e.g. recency-only, or a machine-learned scorer) without
 * touching `Library` or any other policy seam.
 */
export function createWeightedPriorityPolicy(
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
): PriorityPolicy {
  return {
    score(_item: MetadataToken, context: PriorityContext): Priority {
      const rankTerm = (context.userRank ?? 0) * weights.userRank;
      const recencyTerm = context.recencyMs * weights.recency;
      const hopTerm = context.hopCount * weights.hopCount;
      const dwellTerm = context.dwellMs * weights.dwell;
      return toPriority(rankTerm + recencyTerm + hopTerm + dwellTerm);
    },
  };
}

/** A ready-to-use default policy instance for callers that don't need custom weights. */
export const defaultPriorityPolicy: PriorityPolicy = createWeightedPriorityPolicy();
