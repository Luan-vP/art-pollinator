# ADR-0009: Swap protocol versioning — reject on any mismatch

**Status:** Accepted
**Date:** 2026-08-04

## Context

Issue #22 requires the transport-agnostic swap protocol message schema to
carry "a version field... with a defined negotiation strategy" for
mismatched versions. Issue #24's wire codec then has to actually enforce
whatever that strategy is when decoding.

At the point this batch lands, exactly one version of the protocol has
ever existed — `SwapService`'s prior placeholder (ADR-0006) had no version
field at all. There is no real backward-compatibility requirement yet:
no shipped client has ever spoken a different version, and no version 2
design exists to downgrade _to_. The decision this ADR settles is what the
_first_ version's negotiation behaviour should be, in a way that doesn't
paint a future version bump into a corner.

## Decision

**Reject on any version mismatch.** `core/src/protocol/swap-message.ts`
defines a single constant, `SWAP_PROTOCOL_VERSION = 1`, and
`isSupportedVersion(version)` returns `true` only for an exact match.
`decodeSwapProtocolMessage` (`core/src/protocol/swap-message-codec.ts`)
checks this before trusting anything else in the envelope — an unsupported
version fails decoding outright with a descriptive error, never a partial
or best-effort parse. `negotiateVersion(peerVersion)` exposes the same
check as a standalone `{ ok, version } | { ok, reason }` result, usable by
a future composition root that wants to negotiate a version explicitly
(e.g. during a `discover-ack` handshake) before committing to a full swap.

This is the simplest safe default precisely because there is only one
version: "reject" and "there is nothing to downgrade to yet" are the same
statement right now. The design deliberately keeps the _seam_ generic
(`isSupportedVersion`'s single equality check, `negotiateVersion`'s
`{ ok, ... }` result shape) so that a future version 2 needing to
interoperate with older peers can widen `isSupportedVersion` into an
explicit supported range (e.g. a minimum and maximum) without changing
either function's signature or any of their call sites.

## Alternatives considered and rejected

- **Downgrade to the lower of the two versions when they differ.**
  Rejected for now: with only one version in existence, there is no lower
  version to downgrade to, so this alternative can't actually be
  implemented yet — it would be speculative code for a scenario that
  cannot occur. Revisit when version 2 exists and a real compatibility
  matrix needs deciding (e.g. "v2 readers can downgrade to v1 semantics for
  fields both versions share" is a genuine, non-speculative design question
  at that point).
- **No version field at all, matching the placeholder protocol it
  replaces.** Rejected: issue #22 explicitly requires one, and a protocol
  with no version field cannot ever detect a mismatch to negotiate at all —
  every future protocol change would then be a silent, un-diagnosable
  incompatibility instead of a clear rejection with a descriptive error.
- **A `(major, minor)` pair instead of a single integer, allowing minor
  version differences to be tolerated automatically.** Rejected for this
  batch as unnecessary complexity for a protocol with exactly one version
  and no defined semantics yet for what would constitute a "minor" change
  (e.g. is adding an optional field to a message body major or minor?).
  `SWAP_PROTOCOL_VERSION`'s plain-integer shape doesn't foreclose moving to
  a major/minor scheme later — that would be a version 2 concern, decided
  when there's a concrete second version to reason about.

## Consequences

- Every message this codebase sends carries `version: 1` today; there is
  no code path anywhere that constructs a message with a different version.
- A future protocol change that isn't purely additive (i.e. would break an
  old decoder) must bump `SWAP_PROTOCOL_VERSION` and, at that point, decide
  a real compatibility strategy — this ADR explicitly does not pre-decide
  that; it only fixes what happens _today_, with one version in existence.
- Any composition root wiring `SwapService` to a real transport (BLE, HTTP)
  should treat a `decodeSwapProtocolMessage` version-rejection error as a
  signal to abort the swap cleanly (the swap state machine's `ABORT` event,
  `core/src/swap/swap-state-machine.ts`) rather than to retry or coerce —
  there is nothing to coerce to yet.
