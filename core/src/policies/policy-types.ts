/**
 * Item — the unit every policy seam (`OfferPolicy`, `AcceptPolicy`,
 * `EvictionPolicy`) operates on.
 *
 * SPEC.md §5 names the type generically in each seam's signature
 * (`selectOffer(library, peerKind) -> Item[]`, etc) without defining it
 * further — "their logic is deliberately undefined here — only the seams
 * are fixed." The only token-shaped value `core` has that actually flows
 * through a swap is `MetadataToken` (issue #9): that's what `Library`
 * (issue #10) stores per entry, and what SPEC.md §3.1 describes as what
 * travels between devices. So `Item` is a plain alias, not a new type,
 * until some later issue needs a policy-facing shape richer than a bare
 * token (at which point this is the one place that would change).
 */
import type { MetadataToken } from "../metadata/metadata-token.js";

export type Item = MetadataToken;
