/**
 * AcceptPolicy — the strategy seam for choosing which offered items to
 * accept into this library.
 *
 * ⚠️ SPEC.md §5 / AGENTS.md §7: **this is a security control, not a
 * convenience filter.** One-way seeding is permitted (SPEC.md §6.3) — a
 * hostile node may offer items without ever intending to receive any back —
 * so accept-side filtering (and, later, rate limiting: issue #59) is the
 * domain's primary defence against a flooding peer.
 *
 * `selectAccept(offered, library) -> Item[]` (SPEC.md §5) deliberately takes
 * the *whole* `offered` array, not a capped or paginated slice. A naive
 * default that silently assumed "offered is always small" would foreclose
 * #59 wrapping or extending this exact interface with flood defence later —
 * issue #13's explicit acceptance criterion. This implementation makes a
 * single linear pass over `offered` and stops accepting the moment
 * remaining swappable capacity is exhausted, so its own cost stays bounded
 * regardless of how large `offered` is — but that is a *performance*
 * property of this naive default, not a *security* one: nothing here yet
 * rejects or throttles a peer for sending a huge `offered` array in the
 * first place, or tracks *how often* a peer has offered. That is explicitly
 * out of scope for this issue and must not be read as already solved.
 */

import { SWAPPABLE_SLOTS } from "../constants.js";
import { hasContentHash, swappableCount, type Library } from "../library/library.js";
import type { Item } from "./policy-types.js";

export interface AcceptPolicy {
  selectAccept(offered: readonly Item[], library: Library): Item[];
}

/**
 * Naive default `AcceptPolicy`: "accept what fits" (IMPLEMENTATION.md Phase
 * 1a item 13) — accept offered items, in the order offered, up to whatever
 * swappable capacity currently remains.
 *
 * Skips anything the library already holds (by content hash): duplicates
 * are `Library.addItem`'s job to reject/no-op, but counting a duplicate
 * against *this* function's remaining-capacity budget would under-count how
 * much real room is left, since adding it back would not actually consume a
 * slot. Also skips a content hash repeated *within* `offered` itself — a
 * peer offering the same item twice must not consume two capacity slots.
 *
 * `swappableSlots` defaults to the phone's fixed {@link SWAPPABLE_SLOTS}
 * (AGENTS.md §6) — pass a larger value for a node with a larger configured
 * `Library` capacity (see
 * `docs/adr/0012-node-library-capacity-generalization.md`) so this policy's
 * notion of "remaining capacity" agrees with what `Library.addItem` will
 * actually accept, rather than silently capping every node at 5 regardless
 * of its real configured size.
 */
export function createNaiveAcceptPolicy(swappableSlots: number = SWAPPABLE_SLOTS): AcceptPolicy {
  return {
    selectAccept(offered: readonly Item[], library: Library): Item[] {
      const remainingCapacity = Math.max(0, swappableSlots - swappableCount(library));
      const accepted: Item[] = [];
      const acceptedHashes = new Set<string>();

      for (const item of offered) {
        if (accepted.length >= remainingCapacity) break;
        if (hasContentHash(library, item.contentHash)) continue; // already held; addItem would no-op
        if (acceptedHashes.has(item.contentHash)) continue; // duplicate within this same offer batch
        acceptedHashes.add(item.contentHash);
        accepted.push(item);
      }

      return accepted;
    },
  };
}

/** A ready-to-use naive `AcceptPolicy` instance for callers that don't need a custom one. */
export const naiveAcceptPolicy: AcceptPolicy = createNaiveAcceptPolicy();
