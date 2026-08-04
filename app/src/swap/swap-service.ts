/**
 * SwapService — orchestrates one swap with a discovered peer: negotiate
 * (`OfferPolicy`/`AcceptPolicy`) → transfer (metadata tokens move between
 * `MetadataRepositoryPort`s via `TransportPort`) → reconcile
 * (`EvictionPolicy`), driving the swap state machine from `core`
 * (issue #19, IMPLEMENTATION.md Phase 1a item 19).
 *
 * Lives in `app/` and depends only on `core` (AGENTS.md §2 rule 2, §5): the
 * eight port interfaces, the four policies, and the pure swap state machine
 * — never a concrete adapter, never platform code. This is the first real
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
 * ## Design: the negotiation protocol is a minimal placeholder, not issue #22
 *
 * The real swap protocol message schema (versioned, negotiated, identical
 * over BLE and HTTP) is issue #22, a later batch. This service needs
 * *some* concrete message shape today to drive `TransportPort`, so it uses
 * a two-round exchange (see `./swap-message-codec.ts`): each side sends its
 * (already `OfferPolicy`-selected, encounter-memory-filtered) candidate
 * offer as full `MetadataToken`s — cheap, per SPEC.md §3.1's size budget —
 * then each side sends back which content hashes of the *peer's* offer its
 * own `AcceptPolicy` decided to accept. This is enough to let each side
 * learn (a) what it actually received (to persist and reconcile) and
 * (b) which of *its own* offered items were declined by the peer (to record
 * via `EncounterLogPort`, issue #20) — without needing issue #22's full
 * design. A future adapter or the real protocol design replaces this codec
 * without needing to change the shape of this method's orchestration.
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
 */
import {
  addItem,
  createInitialSwapState,
  filterSuppressedCandidates,
  removeItem,
  transition,
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
  type SwapState,
  type SwapTransitionResult,
  type TransportPort,
} from "@art-pollinator/core";
import { decodeSwapMessage, encodeSwapMessage } from "./swap-message-codec.js";

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
}

/** The outcome of one completed swap, from this device's point of view. */
export interface SwapOutcome {
  /** This device's `Library` after reconciliation — a new value, `library` passed in is never mutated. */
  readonly library: Library;
  /** What this device actually attempted to offer (post encounter-memory filtering), before learning what the peer accepted. */
  readonly offered: readonly Item[];
  /** The subset of `offered` the peer actually accepted. */
  readonly sent: readonly Item[];
  /** What this device accepted from the peer's offer (before reconciliation may evict other items to make room). */
  readonly accepted: readonly Item[];
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

    await transport.send(peer.address, encodeSwapMessage({ kind: "offer", items: offered }));
    const inboundOffer = decodeSwapMessage((await transport.receive()).message);
    if (inboundOffer.kind !== "offer") {
      throw new Error(`SwapService: expected an "offer" message, got "${inboundOffer.kind}"`);
    }
    const peerOffer = inboundOffer.items;

    // --- Accept step ---
    const accepted = acceptPolicy.selectAccept(peerOffer, library);

    await transport.send(
      peer.address,
      encodeSwapMessage({
        kind: "ack",
        acceptedContentHashes: accepted.map((item) => item.contentHash),
      }),
    );
    const inboundAck = decodeSwapMessage((await transport.receive()).message);
    if (inboundAck.kind !== "ack") {
      throw new Error(`SwapService: expected an "ack" message, got "${inboundAck.kind}"`);
    }
    const peerAcceptedHashes = new Set(inboundAck.acceptedContentHashes);
    const sent = offered.filter((item) => peerAcceptedHashes.has(item.contentHash));
    const declinedByPeer = offered.filter((item) => !peerAcceptedHashes.has(item.contentHash));

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

    return { library: nextLibrary, offered, sent, accepted, evicted, state };
  }
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
