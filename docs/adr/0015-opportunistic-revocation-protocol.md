# ADR-0015: Revocation as a new, versioned protocol message kind, exchanged as the first round of every swap; authorization requires the revoker's key to match the content's original signer

**Status:** Accepted
**Date:** 2026-08-06

## Context

Issue #51 / SPEC.md §11 open question 7: moderation and takedown must propagate opportunistically (no always-on central authority — this is an offline-first, opportunistic-contact system by design), and a device that was offline when a revocation happened must still receive and apply it later, from _any_ peer that already knows about it, not only the original revoker.

Two design questions needed resolving: (1) does revocation need a new wire message kind, or can it be represented within the existing `offer`/`accept` exchange; and (2) who is allowed to revoke what — a question with no obvious single answer in a system with no central authority.

## Decision

### A new message kind, and a protocol version bump

`core/src/protocol/swap-message.ts` gains a `revocation` message kind (`RevocationBody: { revocations: RevocationEntry[] }`), and `SWAP_PROTOCOL_VERSION` bumps from `1` to `2`. A new kind was chosen over overloading `discover-ack` or `offer` because revocation is conceptually a _third_ thing a swap exchanges (alongside "what I have" and "what I'll accept") — folding it into an existing message would have made that message's meaning conditional on which fields happen to be populated, exactly the kind of implicit-schema drift `core`'s existing envelope-plus-kind design avoids everywhere else. Per ADR-0009's own "reject on mismatch" strategy and its explicit anticipation of a future version bump, this is a clean bump: no shipped deployment of this codebase exists yet to interoperate with, so there is no real compatibility matrix to design.

### Exchanged as round zero, before offer/accept

`SwapService.swap()` (`app/src/swap/swap-service.ts`), when `revocationLog` is configured, sends and receives a `revocation` message _before_ the offer step. Both sides merge whatever the other side sends into their own `RevocationLogPort`, then:

- immediately remove any now-revoked item they currently hold (if authorized — see below), and
- filter revoked content hashes out of both what they offer and what they're willing to accept for the remainder of _that same swap_.

This ordering means a revocation a peer already knew about takes effect before any stale content could otherwise be re-offered or re-accepted in the very same encounter — not just recorded for next time.

### Opportunistic gossip, not authority-scoped

A device sends `revocationLog.listAll()` — _everything it currently knows_, regardless of who told it — not just revocations it originated. This is what makes the offline-device scenario work: Device Offline, which never met the original revoker, learns the revocation from Device Intermediary, which itself only knows about it because it swapped with someone else earlier. See `app/src/swap/revocation-propagation.test.ts`'s explicit "an offline device receives and applies a revocation via a third-party intermediary, not the original revoker" test — this is the concrete DoD requirement, proven directly.

### Authorization: the revoking key must match the content's original signer

`core/src/security/revocation.ts`'s `isRevocationAuthorizedForToken` requires `RevocationEntry.signerPublicKey === MetadataToken.signerPublicKey` before a device that currently holds the referenced content will actually remove it. A `RevocationEntry`'s own signature (verified independently via `verifyRevocationEntrySignature`, the same `SignatureVerifierPort` machinery as everything else) proves _who created the revocation entry_; the authorization check proves _that the same identity also created the content being revoked_ — i.e., the default model is **self-revocation**: the artist/publisher who signed a piece is the one whose revocation of it is honored network-wide.

**Node-operator moderation is a separate, narrower authority.** `app/src/admin/admin-service.ts`'s `revokeContent` lets a node operator remove _anything from their own node's library_ unconditionally — that is ordinary custodial authority over one's own collection, not something that needs cryptographic authorization from the original artist. But the `RevocationEntry` that operation records and gossips onward is signed with the _node's own_ identity, which will generally **not** match the original signer for third-party content — meaning other devices that already hold a copy signed by the real artist will not remove it on the strength of the node's revocation alone. This is a deliberate, conservative default: **no single node's moderation call is unilaterally binding on the rest of the network.** A node can always stop _itself_ from continuing to circulate something; it cannot, by this mechanism alone, force every other device to delete their own copy.

## Alternatives considered and rejected

- **Fold revocation into `discover-ack`.** Rejected: `discover-ack` is the discovery-handshake step (not yet sent over the wire by any batch to date — see `swap-message.ts`'s own doc comment), a different point in the flow than "two devices are now negotiating a swap." Revocation needs to run _every_ time two devices actually swap, not only at initial discovery.
- **No new message kind — track revocations purely locally and let `AcceptPolicy`/`OfferPolicy` filter, with no wire exchange at all.** Rejected: this cannot satisfy the opportunistic-propagation requirement at all — a device with no wire mechanism to _tell_ a peer about a revocation it knows about can never pass that knowledge on, which is the entire point of issue #51.
- **Any keyholder may revoke any content (no authorization check at all — trust every signed revocation unconditionally).** Rejected: this makes takedown-as-censorship trivial — anyone who can sign _anything_ could revoke anyone else's content network-wide. The whole value of "self-revocation" as a model evaporates without an authorization check.
- **A central moderation authority / registrar of "who is allowed to revoke what."** Rejected outright: contradicts this system's entire offline-first, no-central-authority premise (SPEC.md's TL;DR). There is no server this design could even register with.
- **Make node-operator takedown network-binding (i.e., trust a node's revocation of third-party content the same as self-revocation).** Rejected: this would let any single hostile or compromised node censor content across the whole network merely by claiming to revoke it, with no relationship to the actual rights holder. The chosen design accepts a smaller, safer authority for nodes (binding only on their own collection) in exchange for not creating a single point of censorship.
- **Require a device to hold the content to accept a revocation for it at all (reject/drop revocations for unknown content hashes instead of relaying them).** Rejected as the propagation mechanism: this would break the offline-device scenario, since an intermediary that never held the content (por has already evicted it) still needs to be able to _pass along_ what it knows for a later holder to act on. The trade-off this creates (a device can't verify authorization for content it doesn't have, and relays on trust in the signature alone) is accepted and documented as a residual risk in `docs/security/threat-model.md` §3.6, rather than solved by refusing to gossip at all.

## Consequences

- `SWAP_PROTOCOL_VERSION` is now `2`; every message any part of this codebase constructs carries that version. Both sides of a swap must agree on whether `revocationLog` is configured (the same way both sides must agree on the protocol version itself) — `SwapServiceDeps.revocationLog`'s doc comment states this explicitly, and `clients/node/src/e2e-client-node-swap.test.ts` was updated to configure it on the test client to match the node's own (always-on) configuration.
- `RevocationLogPort` (`core/src/ports/revocation-log-port.ts`) is a new driven port, with `InMemoryRevocationLogPort` as its fake — used by every composition root wired in this batch. **Disclosed gap, consistent with this codebase's existing precedent for `EncounterLogPort`:** no SQLite-backed adapter exists yet, so a node's revocation knowledge does not survive a process restart. A real persistent adapter is separate future work.
- Revocation lists grow monotonically with no pruning/expiry mechanism — named as an open question in the threat model rather than solved here.
- `AdminService.revokeContent` (issue #50) is the one piece of this batch that actually _originates_ a revocation as a deliberate operator action, rather than merely propagating one learned from a peer — see that method's own doc comment for the exact authorization-scope reasoning summarized above.
