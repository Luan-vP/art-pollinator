/**
 * Content validation on ingest (issue #49) — the last line of defence
 * *before* an inbound `offer` message's items are handed to `AcceptPolicy`
 * or ever touch a repository write.
 *
 * `core/src/protocol/swap-message-codec.ts`'s `decodeSwapProtocolMessage`
 * already rejects a structurally malformed envelope (bad JSON, unsupported
 * version, unknown message kind) outright. What it does *not* check is
 * whether the *contents* of a well-formed `offer` message are reasonable:
 * nothing before this batch stopped a peer from offering an individual
 * token far beyond the ~5 KB budget (AGENTS.md §6 — `isWithinSizeBudget`
 * already exists in `../metadata/metadata-token.ts` but nothing called it on
 * receipt), or from offering an implausibly large *number* of items in one
 * message to burn CPU/memory on this side's `AcceptPolicy`/signature
 * verification pass. This module is that missing check, applied by
 * `app`'s `SwapService` to every inbound `offer` before anything else
 * touches it (see that file's doc comment).
 */
import { isWithinSizeBudget, type MetadataToken } from "../metadata/metadata-token.js";

/**
 * Hard cap on the number of items a single `offer` message may carry.
 * Generous relative to any real `Library` capacity in this codebase today
 * (a node's configured upper bound is 2,000 total slots —
 * `clients/node/src/composition/node-capacity.ts` — and a phone's is 10),
 * while still being small enough that a peer cannot use "just send an
 * enormous items array" as a resource-exhaustion vector against the
 * signature-verification and `AcceptPolicy` passes that would otherwise run
 * over every one of them. Deliberately generous rather than tightly tuned
 * to today's numbers — a node's configured capacity is expected to grow
 * over time (issue #46), and this cap exists to catch orders-of-magnitude
 * abuse, not to second-guess a legitimate large `Library`.
 */
export const MAX_OFFER_ITEMS = 5_000;

export interface OfferValidationResult {
  /** Items that passed both checks (within the size budget, and the offer as a whole was within {@link MAX_OFFER_ITEMS}). */
  readonly accepted: readonly MetadataToken[];
  /** Items dropped for exceeding the per-token size budget (AGENTS.md §6) — never handed to `AcceptPolicy`. */
  readonly rejectedOversizedItems: readonly MetadataToken[];
  /** `true` if the whole offer was rejected outright for carrying more than {@link MAX_OFFER_ITEMS} items — in that case `accepted` and `rejectedOversizedItems` are both empty; the caller should treat this as a protocol-level abuse signal (abort the swap), not a partial acceptance. */
  readonly rejectedWholeOfferTooLarge: boolean;
}

/**
 * Validate an inbound offer's items against the size and count budgets,
 * before anything else (signature verification, `AcceptPolicy`) ever sees
 * them.
 *
 * A whole offer exceeding {@link MAX_OFFER_ITEMS} is rejected in full — no
 * partial "take the first N" behaviour, since a peer that sends an
 * absurdly large array is exhibiting protocol abuse, not an innocent
 * oversized batch worth salvaging part of. An offer within the count limit
 * still has each *individual* item checked against the ~5 KB token budget;
 * oversized individual items are dropped (not the whole offer), mirroring
 * how {@link import("../metadata/metadata-token.js").verifyMetadataTokenSignature}
 * drops individual unverified items rather than aborting the whole swap.
 */
export function validateOfferItems(items: readonly MetadataToken[]): OfferValidationResult {
  if (items.length > MAX_OFFER_ITEMS) {
    return { accepted: [], rejectedOversizedItems: [], rejectedWholeOfferTooLarge: true };
  }

  const accepted: MetadataToken[] = [];
  const rejectedOversizedItems: MetadataToken[] = [];
  for (const item of items) {
    if (isWithinSizeBudget(item)) {
      accepted.push(item);
    } else {
      rejectedOversizedItems.push(item);
    }
  }
  return { accepted, rejectedOversizedItems, rejectedWholeOfferTooLarge: false };
}
