/**
 * SwapService — orchestrates one swap with a discovered peer: negotiate
 * (`OfferPolicy`/`AcceptPolicy`) → transfer (metadata tokens move between
 * `MetadataRepositoryPort`s via `TransportPort`) → reconcile
 * (`EvictionPolicy`), driving the swap state machine from `core`
 * (issue #19, IMPLEMENTATION.md Phase 1a item 19).
 *
 * Lives in `app/` and depends only on `core` (AGENTS.md §2 rule 2, §5): the
 * port interfaces, the four policies, and the pure swap state machine —
 * never a concrete adapter, never platform code. This is the first real
 * use-case class in `app/`.
 *
 * ## Design: peer discovery is a caller concern, not a constructor dependency
 *
 * SPEC.md §6.2 lists "discover a peer" as step 1 of the flow, but *finding*
 * peers (`DiscoveryPort.startDiscovery`'s scan-and-callback shape) and
 * *swapping with one already found* are different responsibilities. This
 * service's `swap` method takes an already-`DiscoveredPeer` — produced by
 * whatever is driving `DiscoveryPort` (a composition root, or a test, per
 * `core/src/ports/fakes/fakes-integration.test.ts`'s existing pattern of
 * calling `simulateDiscovered` directly) — rather than holding a
 * `DiscoveryPort` itself and calling `startDiscovery` internally. That
 * keeps `SwapService` a "swap with this specific peer" use case, not a
 * "run discovery forever and swap with everyone it finds" daemon — the
 * latter is exactly the shape a scan-scheduling batch (`SchedulerPort`,
 * issue #35) should own later, layered on top of this, not folded into it.
 * The swap state machine's first transition (`PEER_DISCOVERED`) is applied
 * internally at the top of `swap`, so the *state machine's* notion of
 * "discover" still exists and is still exercised — only the scanning
 * mechanism is out of scope here.
 *
 * ## Design: the real, versioned protocol schema (issue #22/#24)
 *
 * This service now speaks `core`'s real transport-agnostic message schema
 * (`@art-pollinator/core`'s `./swap-message.ts`/`./swap-message-codec.ts`,
 * superseding the placeholder ADR-0006 originally stood up). Per that ADR's
 * own prediction, only this file's `transport.send`/`receive` call sites
 * changed — the state-machine driving, policy calls, and encounter-memory
 * plug-in point below are unaffected. Two rounds per swap, same as before:
 * round 1 exchanges `offer` messages (candidate `MetadataToken`s, already
 * `OfferPolicy`-selected and encounter-memory-filtered); round 2 exchanges
 * `accept` messages (which of the peer's offered content hashes this side's
 * `AcceptPolicy` chose). The schema also defines `discover-ack`, `transfer`,
 * and `reconcile-ack` message kinds (round-trip tested in `core`) that this
 * batch does not yet send over the wire — see `core`'s
 * `./protocol/swap-message.ts` doc comment for exactly why, and what would
 * need to start sending them.
 *
 * ## Design: signature verification is a filter before AcceptPolicy runs, not inside it
 *
 * Issue #58 requires unsigned and tampered tokens to be rejected by policy.
 * Rather than change `AcceptPolicy`'s interface (a core seam other batches
 * already depend on) to thread a `SignatureVerifierPort` through it, this
 * service filters the peer's inbound `offer` through
 * `verifyMetadataTokenSignature` (`@art-pollinator/core`) *before* handing
 * anything to `AcceptPolicy.selectAccept` — the same "filter the input at
 * the orchestration layer, keep the policy itself unaware" split
 * ADR-0006 already uses for encounter-memory suppression on the offer side.
 * `signatureVerifier` is an optional constructor dependency: when supplied,
 * every unsigned or tampered item is dropped before `AcceptPolicy` ever
 * sees it (issue #58's "rejected by default" once verification is wired
 * in); when omitted, verification is skipped entirely, which keeps existing
 * callers/tests that construct plain unsigned fixture tokens working
 * unchanged. A production composition root should always supply one; see
 * `adapters/identity-node`'s `NodeSignatureVerifier` for the real
 * Ed25519-backed implementation.
 *
 * ## Design: hop count increments once, at the point a token is received
 *
 * Issue #21 (provenance/lineage — see `docs/adr/0007-provenance-hop-count-only.md`,
 * a decision that carries privacy weight, flagged prominently in this
 * batch's PR description). `core`'s `incrementHopCount` is applied to every
 * accepted item right before it is persisted and added to this device's
 * library — never to items this device only *sends* (sending is not a hop
 * for the sender). Because signatures deliberately exclude `provenance`
 * (see `incrementHopCount`'s doc comment in `core`), incrementing hop count
 * here never invalidates a token's signature, and the incremented value is
 * what's already resident the next time this device offers the same item
 * on to a third party — no separate "on offer" increment is needed.
 *
 * ## Design: where encounter-memory filtering plugs in
 *
 * SPEC.md §6.4 flags two symptoms of missing encounter memory in the same
 * breath: peers keep re-offering already-declined pieces, and evicted
 * items boomerang back. Both reduce to the same rule — don't re-offer a
 * content hash this device has recently recorded as declined-by-a-peer or
 * evicted-from-its-own-library — so `filterSuppressedCandidates`
 * (`core/src/encounter/encounter-memory.ts`) is applied once, to
 * `OfferPolicy.selectOffer`'s *output*, right before anything is sent. It
 * filters the output rather than gating the input to `selectOffer` so that
 * `OfferPolicy` implementations stay unaware of encounter memory entirely —
 * exactly the same "policies decide, the surrounding seam enforces its own
 * invariants independently" split `OfferPolicy`/`EvictionPolicy` already use
 * for the locked-item invariant (AGENTS.md §6).
 *
 * ## Design: an optional `SwapActivityLog` records every completed swap
 *
 * Issue #38's swap screen needs to "show incoming swap activity as it
 * happens," driven by `SwapService`'s outcomes — but a screen can't await a
 * `swap()` call it never made (a background discovery loop is what actually
 * calls `swap`, not the screen). `activityLog` (`./swap-activity-log.js`,
 * optional, default `undefined` to keep existing callers/tests that
 * construct a `SwapService` without one unchanged) is recorded to once, at
 * the very end of a successful `swap()` call, with the exact `SwapOutcome`
 * this method already returns — no second, UI-specific outcome shape
 * invented. A composition root that wants swap activity visible in the UI
 * supplies one; `clients/`'s swap screen subscribes to it.
 */
import {
  addItem,
  createInitialSwapState,
  createAcceptMessage,
  createOfferMessage,
  decodeSwapProtocolMessage,
  encodeSwapProtocolMessage,
  filterSuppressedCandidates,
  incrementHopCount,
  removeItem,
  transition,
  verifyMetadataTokenSignature,
  DEFAULT_ENCOUNTER_SUPPRESSION_WINDOW_MS,
  type AcceptPolicy,
  type ClockPort,
  type DiscoveredPeer,
  type EncounterHistoryByContentHash,
  type EncounterLogPort,
  type EvictionPolicy,
  type Item,
  type Library,
  type LibraryOperationResult,
  type MetadataRepositoryPort,
  type OfferPolicy,
  type SignatureVerifierPort,
  type SwapState,
  type SwapTransitionResult,
  type TransportPort,
} from "@art-pollinator/core";
import type { SwapActivityLog } from "./swap-activity-log.js";

export interface SwapServiceDeps {
  readonly transport: TransportPort;
  readonly metadataRepository: MetadataRepositoryPort;
  readonly encounterLog: EncounterLogPort;
  readonly clock: ClockPort;
  readonly offerPolicy: OfferPolicy;
  readonly acceptPolicy: AcceptPolicy;
  readonly evictionPolicy: EvictionPolicy;
  /** How long a declined/evicted content hash stays suppressed from re-offering (SPEC.md §6.4). Defaults to {@link DEFAULT_ENCOUNTER_SUPPRESSION_WINDOW_MS}. */
  readonly encounterSuppressionWindowMs?: number;
  /**
   * Verifies inbound token signatures (issue #58) before `AcceptPolicy` runs.
   * Omit to skip verification entirely (see this file's doc comment); a
   * production composition root should always supply one
   * (`adapters/identity-node`'s `NodeSignatureVerifier`, or `core`'s
   * `InMemorySignatureVerifierPort` fake in tests that want the check
   * exercised without real cryptography).
   */
  readonly signatureVerifier?: SignatureVerifierPort;
  /** Recorded to once, at the end of a successful swap (issue #38) — see this file's doc comment. Omit to skip recording entirely (default; keeps existing callers unchanged). */
  readonly activityLog?: SwapActivityLog;
}

/** The outcome of one completed swap, from this device's point of view. */
export interface SwapOutcome {
  /** This device's `Library` after reconciliation — a new value, `library` passed in is never mutated. */
  readonly library: Library;
  /** What this device actually attempted to offer (post encounter-memory filtering), before learning what the peer accepted. */
  readonly offered: readonly Item[];
  /** The subset of `offered` the peer actually accepted. */
  readonly sent: readonly Item[];
  /** What this device accepted from the peer's offer (after hop-count increment, issue #21; before reconciliation may evict other items to make room). */
  readonly accepted: readonly Item[];
  /** Items the peer offered that failed signature verification (issue #58) — tampered or unsigned, dropped before `AcceptPolicy` ever saw them. Always empty when `signatureVerifier` is not configured. */
  readonly rejectedUnverified: readonly Item[];
  /** What this device's `EvictionPolicy` evicted to make room for `accepted`. */
  readonly evicted: readonly Item[];
  /** The swap state machine's final state — `{ phase: "completed" }` on success. */
  readonly state: SwapState;
}

function unwrapTransition(result: SwapTransitionResult): SwapState {
  if (!result.ok) {
    throw new Error(`SwapService: illegal swap state transition: ${result.error}`);
  }
  return result.state;
}

function unwrapLibraryOp(result: LibraryOperationResult): Library {
  if (!result.ok) {
    throw new Error(`SwapService: library operation failed: ${result.error}`);
  }
  return result.library;
}

/**
 * Orchestrates one swap with an already-discovered peer: negotiate,
 * transfer, and reconcile, driving the `core` swap state machine throughout.
 * Depends only on `core` ports and policies (AGENTS.md §2) — constructed
 * with all of them up front so no composition-root wiring is needed beyond
 * `new SwapService({ ... })`.
 */
export class SwapService {
  constructor(private readonly deps: SwapServiceDeps) {}

  async swap(peer: DiscoveredPeer, library: Library): Promise<SwapOutcome> {
    const {
      transport,
      metadataRepository,
      encounterLog,
      clock,
      offerPolicy,
      acceptPolicy,
      evictionPolicy,
      signatureVerifier,
    } = this.deps;
    const suppressionWindowMs =
      this.deps.encounterSuppressionWindowMs ?? DEFAULT_ENCOUNTER_SUPPRESSION_WINDOW_MS;

    let state = createInitialSwapState();
    state = unwrapTransition(transition(state, { type: "PEER_DISCOVERED", peerKind: peer.kind }));
    state = unwrapTransition(transition(state, { type: "BEGIN_NEGOTIATION" }));

    // --- Offer step, with encounter-memory suppression (SPEC.md §6.4) ---
    const candidateOffer = offerPolicy.selectOffer(library, peer.kind);
    const now = clock.now();
    const offerHistory = await loadEncounterHistory(encounterLog, candidateOffer);
    const offered = filterSuppressedCandidates(
      candidateOffer,
      offerHistory,
      now,
      suppressionWindowMs,
    );

    await transport.send(peer.address, encodeSwapProtocolMessage(createOfferMessage(offered)));
    const inboundOffer = decodeSwapProtocolMessage((await transport.receive()).message);
    if (inboundOffer.kind !== "offer") {
      throw new Error(`SwapService: expected an "offer" message, got "${inboundOffer.kind}"`);
    }

    // --- Signature verification (issue #58): drop unsigned/tampered items
    // before AcceptPolicy ever sees them. Skipped entirely when no
    // verifier is configured — see this file's doc comment. ---
    const { verified: peerOffer, rejected: rejectedUnverified } = signatureVerifier
      ? partitionBySignature(inboundOffer.body.items, signatureVerifier)
      : { verified: inboundOffer.body.items, rejected: [] as readonly Item[] };

    // --- Accept step ---
    const acceptedBeforeHop = acceptPolicy.selectAccept(peerOffer, library);

    await transport.send(
      peer.address,
      encodeSwapProtocolMessage(
        createAcceptMessage(acceptedBeforeHop.map((item) => item.contentHash)),
      ),
    );
    const inboundAck = decodeSwapProtocolMessage((await transport.receive()).message);
    if (inboundAck.kind !== "accept") {
      throw new Error(`SwapService: expected an "accept" message, got "${inboundAck.kind}"`);
    }
    const peerAcceptedHashes = new Set(inboundAck.body.acceptedContentHashes);
    const sent = offered.filter((item) => peerAcceptedHashes.has(item.contentHash));
    const declinedByPeer = offered.filter((item) => !peerAcceptedHashes.has(item.contentHash));

    // --- Provenance (issue #21): hop count increments once, here, at the
    // point this device actually receives each accepted item. See this
    // file's doc comment and docs/adr/0007-provenance-hop-count-only.md. ---
    const accepted = acceptedBeforeHop.map((item) => incrementHopCount(item));

    state = unwrapTransition(
      transition(state, { type: "NEGOTIATION_COMPLETE", toSend: sent, toReceive: accepted }),
    );

    // --- Transfer step: accepted tokens move into this device's own repository ---
    for (const item of accepted) {
      await metadataRepository.save(item);
    }
    state = unwrapTransition(
      transition(state, { type: "TRANSFER_COMPLETE", sent, received: accepted }),
    );

    // --- Reconcile step: EvictionPolicy makes room, then accepted items land in the library ---
    let nextLibrary = library;
    const evicted = evictionPolicy.selectEvict(nextLibrary, accepted);
    for (const evictedItem of evicted) {
      nextLibrary = unwrapLibraryOp(removeItem(nextLibrary, evictedItem.contentHash));
    }
    for (const item of accepted) {
      nextLibrary = unwrapLibraryOp(addItem(nextLibrary, item));
    }
    state = unwrapTransition(transition(state, { type: "RECONCILE_COMPLETE", evicted }));

    // --- Record encounter outcomes (item-scoped, SPEC.md §6.4/§7) ---
    for (const item of declinedByPeer) {
      await encounterLog.record(item.contentHash, "declined", now);
    }
    for (const item of evicted) {
      await encounterLog.record(item.contentHash, "evicted", now);
    }

    const outcome: SwapOutcome = {
      library: nextLibrary,
      offered,
      sent,
      accepted,
      rejectedUnverified,
      evicted,
      state,
    };
    this.deps.activityLog?.record(outcome);
    return outcome;
  }
}

/** Split `items` into those whose signature verifies and those that don't (unsigned or tampered — issue #58). */
function partitionBySignature(
  items: readonly Item[],
  verifier: SignatureVerifierPort,
): { readonly verified: readonly Item[]; readonly rejected: readonly Item[] } {
  const verified: Item[] = [];
  const rejected: Item[] = [];
  for (const item of items) {
    if (verifyMetadataTokenSignature(item, verifier)) {
      verified.push(item);
    } else {
      rejected.push(item);
    }
  }
  return { verified, rejected };
}

async function loadEncounterHistory(
  encounterLog: EncounterLogPort,
  candidates: readonly Item[],
): Promise<EncounterHistoryByContentHash> {
  const entries = await Promise.all(
    candidates.map(
      async (item) => [item.contentHash, await encounterLog.history(item.contentHash)] as const,
    ),
  );
  return new Map(entries);
}
