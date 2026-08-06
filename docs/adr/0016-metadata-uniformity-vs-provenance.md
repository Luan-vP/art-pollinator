# ADR-0016: Metadata uniformity review — bucket-pad the wire message, don't pad every token to the full 5 KB budget

**Status:** Accepted
**Date:** 2026-08-06

## Context

SPEC.md §3.1: "Resist filling the budget. Tokens uniform in size and shape
are harder to fingerprint as they circulate." IMPLEMENTATION.md's
cross-cutting item 60 names an explicit tension with issue #21's provenance
field: a hop _count_ (`MetadataToken.provenance.hopCount`) necessarily
varies in _value_ as a token circulates, even though its _shape_ (a JSON
object with one integer field) never changes.

This ADR is the real review issue #60 asks for, not just an opinion: a
representative sample of realistic `MetadataToken`s was constructed (short
title, long title/creator near what a UI would plausibly allow, empty
through generous descriptions, signed and unsigned, `local-filesystem` and
`bucket` blob pointers, ASCII and multi-byte-UTF-8 content) and measured
with `core`'s existing `metadataTokenByteSize` and
`encodeSwapProtocolMessage` (`core/src/metadata/metadata-token.test.ts`'s
`realisticShapes` fixtures were the starting point; this review extended
that sample and instrumented it for direct byte measurement rather than
just a pass/fail budget check).

### Measured results

| Sample                                                                       | Token bytes |
| ---------------------------------------------------------------------------- | ----------- |
| Minimal: short title, empty description, unsigned                            | 328         |
| Typical: short title/creator, ~150 char description, unsigned                | 497         |
| Typical, signed                                                              | 710         |
| Long title/creator, moderate (600 char) description, signed                  | 1,330       |
| Generous (1,500 char) description, signed                                    | 2,069       |
| Maximal plausible: long everything, high hop count, signed, `bucket` pointer | 4,374       |
| Unicode-heavy title/creator/description, unsigned                            | 1,162       |

**Range: 328–4,374 bytes — a ~13.3x spread, from ~6.4% to ~85.4% of the
~5 KB (5,120 byte) budget.**

Isolating each field's own contribution (holding everything else fixed at
the "typical" sample):

- **Hop count** (`provenance.hopCount`, issue #21's field under review):
  497 bytes at `hopCount: 0`, 497 bytes at `hopCount: 9`, 498 bytes at
  `hopCount: 47`, 499 bytes at `hopCount: 999`. **A ~2 byte swing across
  three orders of magnitude of hop count** — the extra byte(s) are purely
  the JSON-encoded integer growing an extra digit. This is not a
  meaningful fingerprinting vector on its own: an observer inferring "this
  token has hopped ~1,000 times" from one extra character in a multi-
  hundred-byte message is a vanishingly weak signal next to the token's
  free-text fields.
- **Signed vs. unsigned** (same content otherwise): 497 bytes unsigned,
  710 bytes signed — a **213 byte, one-time step** (a 128-hex-char
  signature plus a 64-hex-char public key, plus their JSON quoting/keys).
  This is a deterministic function of _whether the protocol requires
  signing at all_ (issue #58: unsigned tokens are meant to be rejected by
  policy, so nearly every token actually in circulation is signed), not a
  per-token _choice_ a holder or author makes — it does not vary
  token-to-token the way free text does.
- **Free text (title/creator/description)** is overwhelmingly the
  dominant driver of the 328–4,374 byte range measured above — moving
  description length alone from empty to ~3,500 characters accounts for
  nearly the entire spread.

### Conclusion

**Issue #21's provenance field is not a meaningful contributor to size
variance.** The tension IMPLEMENTATION.md names between "provenance
varies" and "uniform size" is real in principle but measures out to
roughly 2 bytes in practice — background noise next to the ~4,000 byte
swing free-text content length already produces, which predates #21
entirely. No engineering response is needed specifically for provenance;
`docs/adr/0007-provenance-hop-count-only.md`'s existing decision (hop
count, never an identified path) already keeps its _shape_ fixed, which is
what actually matters for this ADR's purposes.

The real uniformity question is therefore about the token's free-text
fields and the signed/unsigned step, not provenance — and about whether
resolving it is worth its cost.

## Decision

**Do not pad every `MetadataToken`/message to a single fixed size (e.g.
the full 5,120-byte budget).** Instead, `core/src/protocol/swap-message-codec.ts`'s
`encodeSwapProtocolMessage` rounds every encoded wire message up to the
next multiple of `DEFAULT_WIRE_PADDING_BLOCK_BYTES` (256 bytes), by
default, before it is handed to `TransportPort.send`. This collapses the
measured 328–4,374 byte continuous range into roughly 20 observable size
buckets, capping worst-case padding overhead at roughly 256 bytes (plus a
small, fixed per-message cost for the padding field itself) regardless of
the real message size — negligible relative overhead for anything but the
smallest messages (an empty `accept`, for instance, at most roughly
doubles), and no more than a low-single-digit percentage overhead for a
typical multi-hundred-byte token.

Implementation: one extra envelope field, `__pad` (a string of ASCII
digit filler, which needs no JSON escaping so its length maps 1:1 to
output bytes), computed by first serializing with an empty pad to learn
the unpadded length, then filling to the next block boundary.
`decodeSwapProtocolMessage` strips this field before returning, so every
existing caller sees the identical message shape it always has — proven
by round-trip tests (`core/src/protocol/swap-message-codec.test.ts`'s
"wire-level padding" suite) across every message kind, at realistic
sizes, with default padding on.

This is scoped to the wire codec — the token's own `metadataTokenByteSize`/
`isWithinSizeBudget` (its ~5 KB field-content budget) are unchanged.
Padding is a transport-time concern layered on top of an already-
budget-compliant token, not a change to what "fits in the token" means.

## Alternatives considered and rejected

- **Pad every token to the full ~5,120-byte budget.** This is the
  "maximum uniformity" option — every token, and every message, would be
  byte-identical in length regardless of content. Rejected: the measured
  range shows a _typical_ small swap (the common person-to-person BLE
  case SPEC.md §3.1 is actually describing — "hot-swapped with someone
  passed in the street") sits around 500–1,000 bytes; padding it to 5,120
  bytes is a **5–15x bandwidth multiplier** on exactly the transfer SPEC.md
  §3.1 wants to complete "well under a second over BLE" within a 2–10
  second contact window (`app/src/swap/short-contact-swap-profile.ts`).
  Given `SHORT_CONTACT_SWAP_PROFILE.maxItemsPerOffer = 3` items per side
  is already sized against the _un-inflated_ budget, blanket full-size
  padding would force that constant down further or eat most of the
  window's margin, for a privacy benefit that other side channels (see
  next point) already undermine.
- **Do nothing (leave sizes fully unpadded).** Rejected as too permissive
  given the measured 13.3x spread is real and easy to observe on the wire
  — an observer who can distinguish a 328-byte message from a 4,374-byte
  one over BLE/HTTP learns something concrete about the content (at
  minimum, "this token has little vs. a lot of text"), even without
  decrypting anything. A cheap mitigation exists (bucketing); declining to
  apply it with no cost argument against it would not be a defensible
  "we measured and concluded uniformity doesn't matter" position — the
  measurement instead shows a _cheap, partial_ mitigation is worth doing.
- **Per-field padding inside `MetadataToken` itself (e.g. always pad
  `description` to a fixed length with a documented "real length" marker).**
  Rejected: this pushes padding into the domain type, `core`'s signed
  payload (`canonicalizeTokenForSigning`), and every persistence layer
  (SQLite columns, in-memory fakes) — a far larger, more invasive change
  than a wire-level transform applied once at
  `encodeSwapProtocolMessage`/`decodeSwapProtocolMessage`, for no
  additional uniformity benefit (the _wire_ bytes are what an observer
  actually sees; padding a field that then gets bucketed anyway at the
  wire layer is redundant work).
- **A much smaller block size (e.g. 16 bytes) for tighter bucketing.**
  Rejected as false precision: BLE/Wi-Fi framing, transport headers, and
  TLS record overhead (where enabled, ADR-0014) already add their own
  non-uniform overhead outside this codec's control, so bucketing far
  finer than ~256 bytes buys negligible additional real-world uniformity
  while adding more buckets (less collapsing) for no measured benefit.
- **A much larger block size (e.g. 5,120 bytes — one bucket, the full
  budget).** This is arithmetically identical to "pad every token to the
  full budget," already rejected above for its bandwidth cost.

## Consequences

- Every message crossing `TransportPort` is now up to 255 bytes larger
  than its raw canonical encoding by default; `app/src/swap/short-contact-swap-profile.test.ts`'s
  real-byte-volume assertions were re-run against this change and remain
  comfortably within budget (the profile's margin — ~30 KB of real traffic
  against a ~100 KB window budget — absorbs it without adjustment).
- This is a **partial** mitigation, stated plainly: an observer capturing
  raw bytes on the wire still learns which of ~20 size buckets a message
  falls into, still sees exact message _counts_ and _timing_ (RSSI, contact
  duration, number of `offer` round trips), and still sees the message
  _kind_ itself (an `offer` looks structurally different from an
  `accept`) — none of which this ADR addresses, and none of which
  per-token padding would have addressed either. `docs/security/threat-model.md`
  §3's existing adversary list (a passive network observer, adversary D)
  is the right place to track those larger, unaddressed channels if a
  future batch wants to take them on; this ADR only closes the specific,
  measured "exact byte length of a token/message" leak SPEC.md §3.1 names.
- `padToBlockBytes` is exposed as an option (default 256, `0` disables)
  rather than hardcoded, so a future batch revisiting the bucket width —
  or a caller with a specific reason to see true unpadded sizes — has a
  seam without another wire-format change.
- If a future batch adds a field to `MetadataToken` whose _value range_ is
  genuinely large (unlike hop count's ~2-byte swing measured here), this
  review's method — construct a representative sample, measure with
  `metadataTokenByteSize`/`encodeSwapProtocolMessage`, isolate the new
  field's contribution before concluding anything — should be repeated
  rather than assumed to still hold.
