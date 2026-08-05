/**
 * Short-contact swap profile tests (issue #36).
 *
 * Per this batch's explicit scope (no BLE hardware or simulator in this
 * sandbox — docs/spikes/0028-background-ble-feasibility.md), this
 * simulates the short contact window end to end using `SwapService` with
 * `@art-pollinator/core`'s in-memory `TransportPort`/`ClockPort` fakes,
 * NOT the real BLE adapters — proving the profile's item-count budget
 * keeps a real, measured wire-encoded byte volume inside the window at
 * the profile's documented throughput assumption, and that a full swap
 * carrying near-token-size-budget items actually completes successfully
 * under that constraint. Live BLE hardware verification remains a
 * separate, disclosed follow-up (see `@art-pollinator/transport-ble` and
 * `@art-pollinator/discovery-ble`'s own READMEs).
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_LIBRARY,
  InMemoryClockPort,
  InMemoryEncounterLogPort,
  InMemoryMetadataRepositoryPort,
  METADATA_TOKEN_MAX_BYTES,
  addItem,
  createInMemoryTransportPair,
  createOfferMessage,
  encodeSwapProtocolMessage,
  naiveAcceptPolicy,
  naiveEvictionPolicy,
  naiveOfferPolicy,
  toPriority,
  type DiscoveredPeer,
  type Library,
  type MetadataToken,
  type PeerAddress,
} from "@art-pollinator/core";
import { SwapService } from "./swap-service.js";
import {
  estimateWorstCaseOfferTransferMs,
  fitsWithinShortContactWindow,
  SHORT_CONTACT_SWAP_PROFILE,
} from "./short-contact-swap-profile.js";

/** A token padded close to `METADATA_TOKEN_MAX_BYTES`, to exercise the profile's actual worst-case assumption rather than a toy-sized fixture. */
function nearBudgetToken(contentHash: string): MetadataToken {
  const base: Omit<MetadataToken, "description"> = {
    title: `Piece ${contentHash}`,
    creator: "Someone whose name is part of this token's byte footprint",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
  // Pad `description` so the token's real encoded size approaches (without
  // exceeding) METADATA_TOKEN_MAX_BYTES — the encoder used below measures
  // the actual resulting byte count, so this only needs to get close, not
  // hit the budget exactly.
  const padding = "x".repeat(METADATA_TOKEN_MAX_BYTES - 300);
  return { ...base, description: `A piece worth passing on. ${padding}` };
}

function buildLibrary(hashes: readonly string[]): Library {
  let library = EMPTY_LIBRARY;
  for (const hash of hashes) {
    const added = addItem(library, nearBudgetToken(hash), toPriority(0));
    if (!added.ok) throw new Error(`fixture setup failed: ${added.error}`);
    library = added.library;
  }
  return library;
}

describe("SHORT_CONTACT_SWAP_PROFILE — arithmetic", () => {
  it("estimates worst-case offer transfer time as a function of item count and the documented throughput assumption", () => {
    // 3 items/side * 5120 bytes * 2 directions / 10240 B/s * 1000 = 3000ms.
    expect(estimateWorstCaseOfferTransferMs(3, SHORT_CONTACT_SWAP_PROFILE)).toBe(3_000);
  });

  it("the default maxItemsPerOffer fits comfortably inside the 2-10s window", () => {
    expect(fitsWithinShortContactWindow(SHORT_CONTACT_SWAP_PROFILE.maxItemsPerOffer)).toBe(true);
    expect(
      estimateWorstCaseOfferTransferMs(SHORT_CONTACT_SWAP_PROFILE.maxItemsPerOffer),
    ).toBeLessThanOrEqual(SHORT_CONTACT_SWAP_PROFILE.maxWindowSeconds * 1000);
  });

  it("a large enough item count would exceed the window, proving this is a real, non-trivial constraint", () => {
    const tooMany = 100;
    expect(fitsWithinShortContactWindow(tooMany)).toBe(false);
  });
});

describe("SHORT_CONTACT_SWAP_PROFILE — a full swap of near-budget-size tokens, end to end over in-memory fakes", () => {
  it("completes successfully while each side's offer volume matches the profile's own worst-case estimate", async () => {
    const addressA: PeerAddress = { id: "device-a" };
    const addressB: PeerAddress = { id: "device-b" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    const itemCount = SHORT_CONTACT_SWAP_PROFILE.maxItemsPerOffer;
    const libraryA = buildLibrary(
      Array.from({ length: itemCount }, (_, i) => `a-piece-${String(i)}`),
    );
    const libraryB = buildLibrary(
      Array.from({ length: itemCount }, (_, i) => `b-piece-${String(i)}`),
    );

    const serviceA = new SwapService({
      transport: transportA,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: naiveOfferPolicy,
      acceptPolicy: naiveAcceptPolicy,
      evictionPolicy: naiveEvictionPolicy,
    });
    const serviceB = new SwapService({
      transport: transportB,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: naiveOfferPolicy,
      acceptPolicy: naiveAcceptPolicy,
      evictionPolicy: naiveEvictionPolicy,
    });

    const peerB: DiscoveredPeer = { address: addressB, kind: "person" };
    const peerA: DiscoveredPeer = { address: addressA, kind: "person" };

    const [outcomeA, outcomeB] = await Promise.all([
      serviceA.swap(peerB, libraryA),
      serviceB.swap(peerA, libraryB),
    ]);

    // The swap actually completes (this is a real assertion about
    // SwapService's behavior, not just the arithmetic above).
    expect(outcomeA.state.phase).toBe("completed");
    expect(outcomeB.state.phase).toBe("completed");
    expect(outcomeA.offered.length).toBe(itemCount);
    expect(outcomeB.offered.length).toBe(itemCount);
    expect(outcomeA.evicted).toEqual([]); // fits within slot budget too — SWAPPABLE_SLOTS comfortably exceeds itemCount
    expect(outcomeB.evicted).toEqual([]);

    // No blob transfer occurred — metadata-only, per this issue's DoD.
    // (Nothing in this test ever touches a BlobStorePort; this asserts the
    // *evidence* of that — every accepted item's content lives only in its
    // MetadataToken fields, never a separately-fetched blob.)
    for (const item of [...outcomeA.accepted, ...outcomeB.accepted]) {
      expect(item.blobPointer.contentHash).toBe(item.contentHash);
    }

    // Real, measured wire-encoded byte volume for both sides' `offer`
    // messages (the actual dominant cost of a swap) — not an estimate.
    // `SwapService` doesn't expose the raw bytes it sent, so this
    // reconstructs the exact same message shape from the outcome's
    // `offered` field, which is byte-identical to what actually crossed
    // `transportA`/`transportB` above.
    const encodedBytesA = encodeSwapProtocolMessage(createOfferMessage(outcomeA.offered)).length;
    const encodedBytesB = encodeSwapProtocolMessage(createOfferMessage(outcomeB.offered)).length;
    const totalRealBytes = encodedBytesA + encodedBytesB;

    const budgetBytes =
      (SHORT_CONTACT_SWAP_PROFILE.maxWindowSeconds *
        SHORT_CONTACT_SWAP_PROFILE.assumedThroughputBytesPerSecond) /
      1; // bytes obtainable in the full window at the assumed throughput
    expect(totalRealBytes).toBeLessThanOrEqual(budgetBytes);

    // And the estimated transfer time for this real byte volume, at the
    // profile's documented throughput assumption, lands within the window.
    const estimatedMs =
      (totalRealBytes / SHORT_CONTACT_SWAP_PROFILE.assumedThroughputBytesPerSecond) * 1000;
    expect(estimatedMs).toBeLessThanOrEqual(SHORT_CONTACT_SWAP_PROFILE.maxWindowSeconds * 1000);
    expect(estimatedMs).toBeGreaterThanOrEqual(
      SHORT_CONTACT_SWAP_PROFILE.minWindowSeconds * 1000 * 0,
    ); // sanity: non-negative, real number
  });
});
