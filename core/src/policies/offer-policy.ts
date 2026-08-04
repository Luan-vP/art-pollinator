/**
 * OfferPolicy — the strategy seam for choosing what to offer to a peer.
 *
 * SPEC.md §5 fixes the signature: `selectOffer(library, peerKind) -> Item[]`.
 * SPEC.md §6.3: only a bare `PeerKind` discriminator is passed — no fuller
 * peer context — partly *because* richer peer context (e.g. a stable
 * per-person identifier) is exactly what would erode the rotating-identity
 * privacy property people rely on (see `../ports/discovery-port.ts`).
 *
 * AGENTS.md §6: a locked item is never offered, and that invariant must be
 * enforced *independently* at every chokepoint — not solely inherited from
 * `Library`'s own pool classification. That is why the naive default below
 * walks `library.entries` itself and checks each entry's own `.locked` flag
 * directly, rather than accepting some upstream "already-offerable" list on
 * trust (issue #12, IMPLEMENTATION.md Phase 1a item 12).
 */

import type { Library } from "../library/library.js";
import type { PeerKind } from "../ports/discovery-port.js";
import type { Item } from "./policy-types.js";

export interface OfferPolicy {
  selectOffer(library: Library, peerKind: PeerKind): Item[];
}

/**
 * Naive default `OfferPolicy`: offer every swappable item, regardless of
 * `peerKind` ("offer all swappable" — IMPLEMENTATION.md Phase 1a item 12).
 *
 * `peerKind` is accepted — matching SPEC.md §6.3's fixed signature, so a
 * composition root can later register a peer-kind-aware policy (e.g. one
 * that offers less to a `"node"` than a `"person"`) without touching the
 * interface — but is deliberately unused by *this* implementation.
 *
 * Never offers a locked item: this function reads `entry.locked` on each
 * entry itself and skips it, rather than delegating entirely to
 * `swappableItems()` from `library.ts` — so even a hypothetical future bug
 * in that helper would not, by itself, make this policy leak a locked item.
 */
export function createNaiveOfferPolicy(): OfferPolicy {
  return {
    selectOffer(library: Library, _peerKind: PeerKind): Item[] {
      const offered: Item[] = [];
      for (const entry of library.entries.values()) {
        if (entry.locked) continue; // independent enforcement of the locked-item invariant, AGENTS.md §6
        offered.push(entry.token);
      }
      return offered;
    },
  };
}

/** A ready-to-use naive `OfferPolicy` instance for callers that don't need a custom one. */
export const naiveOfferPolicy: OfferPolicy = createNaiveOfferPolicy();
