# ADR-0006: SwapService's placeholder wire protocol, and where encounter memory plugs in

**Status:** Accepted
**Date:** 2026-08-04

## Context

Issue #19 asks for `SwapService` in `app/` to orchestrate discovery →
negotiate (`OfferPolicy`/`AcceptPolicy`) → transfer → reconcile
(`EvictionPolicy`) against `core`'s ports, driving the swap state machine
(ADR-0005), and to prove it end to end against the in-memory fakes —
including a one-way swap (SPEC.md §6.3).

Issue #20 asks for item-scoped encounter memory (SPEC.md §6.4/§7) that
suppresses re-offering a previously declined-or-evicted content hash within
a configurable window, and for `SwapService` to actually use it.

Three things needed deciding that neither issue nor SPEC.md §22 (the real
wire protocol, a later batch) fixes yet: how `SwapService` learns about a
peer at all, what bytes actually cross `TransportPort` before issue #22
exists, and exactly where encounter-memory filtering plugs into the
orchestration.

## Decision

**Discovery is a caller concern.** `SwapService.swap(peer: DiscoveredPeer,
library: Library)` takes an already-discovered peer rather than holding a
`DiscoveryPort` and calling `startDiscovery` itself. The state machine's own
`PEER_DISCOVERED` transition still fires (at the top of `swap`), so "discover"
as a _lifecycle step_ is still modelled and exercised — only the scanning
mechanism (duty cycle, callback registration — `DiscoveryPort`, issue #35's
concern later) is left to whatever drives `SwapService`.

**A minimal placeholder wire protocol**, pending issue #22/#24: two rounds
per swap over `TransportPort`. Round 1: each side sends its
(`OfferPolicy`-selected, encounter-memory-filtered) full `MetadataToken`s as
an `{ kind: "offer", items }` message and receives the peer's. Round 2: each
side runs `AcceptPolicy` against what it received and sends back
`{ kind: "ack", acceptedContentHashes }`; each side then knows which of its
own offered items the peer declined. See `app/src/swap/swap-message-codec.ts`
— a hand-rolled UTF-8 JSON codec, matching the pattern already established
by `core/src/ports/fakes/fakes-integration.test.ts` (necessary because
neither `core`'s nor `app`'s `tsconfig.json` includes DOM/Node lib types, so
`TextEncoder`/`TextDecoder` aren't available).

**Encounter memory plugs in once, at the offer step**, filtering
`OfferPolicy.selectOffer`'s output before anything is sent
(`core/src/encounter/encounter-memory.ts`'s `filterSuppressedCandidates`,
called from `SwapService.swap` before the round-1 send). Both suppressing
outcomes (`"declined"`, `"evicted"`) are checked together by the same
filter at this one call site.

## Alternatives considered and rejected

- **`SwapService` owns a `DiscoveryPort` and loops over discovered peers
  itself.** Rejected: that makes `SwapService` a long-running daemon
  ("scan forever, swap with whoever appears"), conflating "swap with this
  peer" with "manage the scan lifecycle" — the latter is `SchedulerPort`
  territory (issue #35, a later batch) and belongs above this class, not
  inside it. Keeping `swap` a single-peer, single-call method matches how
  `core/src/ports/fakes/fakes-integration.test.ts` already drives discovery
  (`simulateDiscovered`) as a separate step from moving bytes.
- **Sending only content hashes in the offer round, fetching full tokens
  on demand.** Rejected: SPEC.md §3.1 fixes tokens at under ~5 KB
  specifically so they're cheap to send in full over a short BLE contact
  window — a hash-then-fetch round trip adds a full extra message pair for
  no benefit at this size, and would need a "fetch by hash" message this
  ADR would then have to invent anyway.
- **Suppressing evicted items on the _accept_ side instead of (or in
  addition to) the offer side.** This was seriously considered — SPEC.md
  §6.4's "evicted items boomerang back" reads most literally as "don't
  re-accept something I evicted," which is an accept-time concern. Rejected
  in favour of a single offer-side filter for two reasons: (1) issue #20's
  own acceptance-test framing is explicitly "a candidate set of items _to
  offer_," and (2) a unified single-call-site filter (both outcomes, one
  place) is simpler to review against that acceptance criterion than two
  independent filters with different trigger conditions. The accept-side
  "boomerang" scenario is still exercised indirectly: an evicted item is
  usually no longer resident, so it is not even a candidate to offer; the
  encounter-memory test suite (`core/src/encounter/encounter-memory.test.ts`)
  and `SwapService`'s test directly verify the suppression mechanics
  (declined and evicted alike) at the one call site this ADR settles on. If
  a future issue finds the accept-side boomerang case insufficiently
  covered by this, revisit — the exported `filterSuppressedCandidates`
  function is generic enough to add a second call site without changing its
  own shape.
- **Recording `"offered"` and `"accepted"` outcomes too**, matching
  `EncounterLogPort`'s full `EncounterOutcome` union. Rejected for this
  batch: issue #20's task explicitly scopes the required behaviour to
  `"declined"`/`"evicted"` recording and suppression. Recording the other
  two outcomes would be harmless but is out of scope; the port already
  supports it if a later issue wants it.

## Consequences

- `SwapService`'s constructor takes exactly the ports and policies it uses
  (`TransportPort`, `MetadataRepositoryPort`, `EncounterLogPort`,
  `ClockPort`, plus `OfferPolicy`/`AcceptPolicy`/`EvictionPolicy`) — not all
  eight ports from issue #17. `IdentityPort`, `BlobStorePort`, and
  `SchedulerPort` are unused by this Phase 1a slice (no signing, no blob
  transfer, no scan scheduling yet) and are deliberately not threaded
  through as unused constructor parameters.
- The two-message-per-direction protocol requires both sides' `swap()`
  calls to run concurrently (e.g. via `Promise.all`) against a paired
  `InMemoryTransportPort` — a single side calling `swap()` alone will hang
  on its first `receive()`. This matches how
  `core/src/ports/fakes/in-memory-transport-port.ts` is documented to work
  and is exercised throughout `app/src/swap/swap-service.test.ts`.
- When issue #22's real transport-agnostic message schema lands, only
  `swap-message-codec.ts` and the two `transport.send`/`receive` call sites
  in `swap-service.ts` need to change — the state-machine driving, the
  policy calls, and the encounter-memory plug-in point are unaffected.
