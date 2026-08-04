/**
 * Encounter memory — the domain logic behind SPEC.md §6.4: "Without a
 * record of what has been seen or shed, revisiting a peer returns the same
 * pieces and evicted items boomerang back." Item-scoped, keyed by content
 * hash, **never peer-scoped** — SPEC.md §7 / AGENTS.md §7: people use
 * rotating ephemeral identities, so "I already declined this person" is
 * unrepresentable, and this module's inputs and outputs never carry a peer
 * identifier anywhere (issue #20, IMPLEMENTATION.md Phase 1a item 20).
 *
 * ## Design: a pure filter over precomputed history, not a port-calling function
 *
 * `core` has zero I/O (AGENTS.md §2 rule 1), but `EncounterLogPort.history`
 * is async. Rather than have this module call the port itself (which would
 * make it I/O, not pure), it takes an already-fetched
 * `EncounterHistoryByContentHash` map as a plain argument — the caller
 * (`SwapService`, in `app/`, which *is* allowed to do I/O) is responsible for
 * awaiting `EncounterLogPort.history(...)` for each candidate and handing the
 * results in. This is the same split `PriorityPolicy.score` already uses for
 * `ClockPort`-derived signals (`../priority/priority.ts`'s `PriorityContext`
 * doc comment): the port call is the caller's job, the decision logic is
 * `core`'s.
 *
 * ## Design: one filter, plugged into the offer step, checking both outcomes together
 *
 * SPEC.md §6.4 names two symptoms of missing encounter memory in the same
 * breath — "revisiting a peer returns the same pieces" (a previously
 * *declined* item keeps getting re-offered) and "evicted items boomerang
 * back" (a previously *evicted* item keeps getting re-offered once it
 * re-enters the library, e.g. via a later, unrelated accept). Both are
 * fixed by the identical shape of rule: don't re-offer a content hash this
 * device has recently recorded as `"declined"` or `"evicted"`. So this
 * module exposes one filter, over one combined set of "suppressing"
 * outcomes, meant to sit on the *candidate-items-to-offer* path — see
 * `SwapService.swap`'s offer step in `app/src/swap/swap-service.ts`, which
 * is the one call site that actually uses it (issue #20's explicit
 * requirement: "not just have it exist unused").
 */

import type { EncounterOutcome } from "../ports/encounter-log-port.js";
import type { Item } from "../policies/policy-types.js";

export interface EncounterHistoryEntry {
  readonly outcome: EncounterOutcome;
  readonly atEpochMs: number;
}

/** Precomputed `EncounterLogPort.history(...)` results, keyed by content hash — never by peer. */
export type EncounterHistoryByContentHash = ReadonlyMap<string, readonly EncounterHistoryEntry[]>;

/** Outcomes that suppress an item from being re-offered while still within the window. */
const SUPPRESSING_OUTCOMES: ReadonlySet<EncounterOutcome> = new Set(["declined", "evicted"]);

/** A reasonable default suppression window (24 hours). Always overridable — SPEC.md §6.4 calls for "a configurable window." */
export const DEFAULT_ENCOUNTER_SUPPRESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * `true` if `history` contains a `"declined"` or `"evicted"` outcome whose
 * age (`nowEpochMs - atEpochMs`) is still within `windowMs` — i.e. the item
 * should be suppressed from being offered again right now. A record exactly
 * `windowMs` old is still suppressed (`<=`, not `<`); once it ages past the
 * window it stops being.
 */
export function isSuppressed(
  history: readonly EncounterHistoryEntry[] | undefined,
  nowEpochMs: number,
  windowMs: number,
): boolean {
  if (!history || history.length === 0) {
    return false;
  }
  return history.some((entry) => {
    if (!SUPPRESSING_OUTCOMES.has(entry.outcome)) {
      return false;
    }
    const age = nowEpochMs - entry.atEpochMs;
    return age >= 0 && age <= windowMs;
  });
}

/**
 * Filter a candidate set of items to offer, removing any item this device
 * has recorded as `"declined"` (by a peer) or `"evicted"` (from this
 * device's own library) within `windowMs` of `nowEpochMs`. Preserves the
 * relative order of `candidates`. Item-scoped throughout: `historyByContentHash`
 * carries no peer identity, so a rotated peer identity cannot evade this
 * filter and a stable peer identity cannot be required by it either.
 */
export function filterSuppressedCandidates<T extends Item>(
  candidates: readonly T[],
  historyByContentHash: EncounterHistoryByContentHash,
  nowEpochMs: number,
  windowMs: number,
): T[] {
  return candidates.filter(
    (item) => !isSuppressed(historyByContentHash.get(item.contentHash), nowEpochMs, windowMs),
  );
}
