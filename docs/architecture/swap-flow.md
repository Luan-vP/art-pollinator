# Swap flow

The two pictures `SPEC.md` §6.2 describes in prose — "discover a peer → exchange
tokens → negotiate → transfer → reconcile" — and what `SwapService`
(`app/src/swap/swap-service.ts`) and the swap state machine
(`core/src/swap/swap-state-machine.ts`) actually do. Both diagrams were built by
reading those two files line by line, not from the spec alone — where the code adds
detail the spec doesn't (rate limiting, revocation, trust adjustment), it's shown here.

## 1. One swap, end to end

Drawn from Device A's perspective; Device B runs the identical logic symmetrically.
Steps 1–4 (the HTTP auth handshake) only happen when the peer is a node with
`security` configured (`ADR-0013`) — BLE and unauthenticated HTTP skip straight to the
rate-limit check.

```mermaid
sequenceDiagram
    autonumber
    participant A as Device A<br/><small>(initiates the connection)</small>
    participant B as Device B / Node<br/><small>(SwapService.swap)</small>

    Note over A,B: HTTP transport only, opt-in (ADR-0013) — BLE and<br/>unauthenticated HTTP skip to step 5
    A->>B: POST /handshake/challenge
    B-->>A: 200 { nonce } <small>(per-IP rate limited)</small>
    A->>B: POST /handshake/response { publicKey, signature(nonce) }
    B-->>A: 200 session (TTL) — or 401 rejected

    Note over A,B: SwapService.swap() — state: idle → discovered
    A->>A: swapRateLimiter.recordAndCheck(peerId)
    Note right of A: exceeded → abort + trustTracker "throttled"<br/>(node peers only, ADR-0017)

    Note over A,B: state: discovered → negotiating
    opt revocationLog configured on both sides (issue #51)
        A->>B: revocation { known revoked hashes }
        B->>A: revocation { known revoked hashes }
        A->>A: verify signatures, apply inbound revocations to own library
    end

    A->>A: OfferPolicy.selectOffer() → filterSuppressedCandidates()<br/><small>(item-scoped encounter memory, SPEC.md §6.4)</small>
    A->>B: offer { candidate MetadataTokens }
    B->>A: offer { candidate MetadataTokens } <small>(B runs the same selection)</small>

    A->>A: validateOfferItems() → partitionBySignature() → drop known-revoked
    Note right of A: oversized / unsigned items dropped here →<br/>trustTracker "rejectedContent" (node peers only)
    A->>A: trust-adjusted AcceptPolicy.selectAccept()
    A->>B: accept { accepted content hashes }
    B->>A: accept { accepted content hashes }

    Note over A,B: state: negotiating → negotiated → transferred
    A->>A: incrementHopCount() per accepted item <small>(ADR-0007, hop-count only)</small>
    A->>A: metadataRepository.save() per accepted item

    Note over A,B: state: transferred → completed (reconcile)
    A->>A: EvictionPolicy.selectEvict() → remove evicted → addItem() accepted
    A->>A: encounterLog.record(declined / evicted)
    A->>A: trustTracker.recordOutcome() <small>(reciprocal swaps only, node peers only)</small>
```

**Any step failing — a timeout, a transport error, a malformed message — throws
`SwapAbortedError` and drives the state machine's `ABORT` event from wherever it
currently sits** (issue #47). Because the repository write only happens after both
negotiation round trips fully resolve, an abort during negotiation always precedes any
write — there's no code path that leaves a half-written token.

## 2. The state machine underneath

`core/src/swap/swap-state-machine.ts`'s actual states and transitions — a pure
`transition(state, event)` reducer, never a class, so every case above is just an
assertion on a returned value.

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> discovered: PEER_DISCOVERED
    discovered --> negotiating: BEGIN_NEGOTIATION
    negotiating --> negotiated: NEGOTIATION_COMPLETE
    negotiated --> transferred: TRANSFER_COMPLETE
    transferred --> completed: RECONCILE_COMPLETE
    completed --> [*]

    idle --> aborted: ABORT
    discovered --> aborted: ABORT
    negotiating --> aborted: ABORT
    negotiated --> aborted: ABORT
    transferred --> aborted: ABORT
    aborted --> [*]

    note right of completed
        toSend/toReceive and sent/received are always
        plain arrays, never required non-empty — a
        one-way swap (SPEC.md §6.3) takes the identical
        path, not a separate branch.
    end note

    note right of aborted
        Legal from any non-terminal phase.
        Never legal from completed or aborted —
        both are true terminal states.
    end note
```

## Notes on reading this against the code

- The sequence diagram compresses "A does X, B does the same" into one arrow where the
  logic is symmetric (e.g. both sides run `OfferPolicy.selectOffer` independently) —
  the code doesn't have a single shared "negotiation" step, each side computes its own.
- `revocationLog`, `signatureVerifier`, `swapRateLimiter`, and `trustTracker` are all
  optional constructor dependencies on `SwapService` (`SwapServiceDeps`). Every "opt"
  block and trust-tracker line above is skipped entirely when the corresponding
  dependency isn't wired in — this diagram shows the fully-configured node path, which
  is what `clients/node`'s composition root actually wires.
- Trust tracking is deliberately scoped to `peer.kind === "node"` only, never
  `"person"` — see `docs/adr/0017-trust-tracker-scoped-to-node-identities.md` and the
  [security pipeline](./security-pipeline.md) doc for why.
