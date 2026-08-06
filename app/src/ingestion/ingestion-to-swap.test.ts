/**
 * End-to-end proof for issue #55's DoD: "the authored piece successfully
 * swaps to another device/node end to end" — not just "the form submits."
 *
 * This test authors a token via `IngestionService` (issue #53) exactly the
 * way `clients/mobile`'s `AuthoringScreen` does, then runs the resulting
 * `Library` through the real `SwapService`/`OfferPolicy` flow (issue #19),
 * against a second simulated device, using the same in-memory-fake pattern
 * `app/src/swap/swap-service.test.ts` already establishes for a full
 * two-device swap. No UI is involved — this proves the *use case*, which is
 * what issue #55 actually gates on, independent of any specific screen.
 */
import { describe, expect, it } from "vitest";
import {
  InMemoryBlobStorePort,
  InMemoryClockPort,
  InMemoryEncounterLogPort,
  InMemoryMetadataRepositoryPort,
  createInMemoryTransportPair,
  naiveAcceptPolicy,
  naiveEvictionPolicy,
  naiveOfferPolicy,
  type DiscoveredPeer,
  type PeerAddress,
} from "@art-pollinator/core";
import { LibraryService } from "../library/library-service.js";
import { SwapService } from "../swap/swap-service.js";
import { IngestionService } from "./ingestion-service.js";

describe("Authored piece is a genuine, offerable candidate end to end (issue #55)", () => {
  it("a piece authored via IngestionService is offered by OfferPolicy, accepted by a peer, and lands in the peer's library after a real SwapService swap", async () => {
    // --- Device A: the authoring device. One piece authored via IngestionService,
    // exactly as `AuthoringScreen` (clients/mobile) would call it. ---
    const blobStoreA = new InMemoryBlobStorePort();
    const libraryServiceA = LibraryService.createEmpty(new InMemoryMetadataRepositoryPort());
    const ingestionService = new IngestionService({
      libraryService: libraryServiceA,
      blobStore: blobStoreA,
    });

    const authoredBlob = new TextEncoder().encode("synthetic-demo-blob:my-own-piece");
    const ingestionResult = await ingestionService.ingest({
      title: "My Own Piece",
      creator: "The Artist",
      description: "Authored end to end via the authoring screen's use case.",
      contentType: "image/png",
      blob: authoredBlob,
    });
    expect(ingestionResult.ok).toBe(true);
    if (!ingestionResult.ok) return;
    const authoredContentHash = ingestionResult.token.contentHash;

    // Sanity: it is genuinely resident in A's library, unlocked (swappable).
    const libraryAfterIngest = libraryServiceA.getLibrary();
    expect(libraryAfterIngest.entries.has(authoredContentHash)).toBe(true);
    expect(libraryAfterIngest.entries.get(authoredContentHash)?.locked).toBe(false);

    // Sanity: `OfferPolicy` itself would genuinely select it as a candidate
    // to offer — this is the exact policy `SwapService` calls below, proven
    // directly rather than only implied by the swap outcome further down.
    const candidateOffer = naiveOfferPolicy.selectOffer(libraryAfterIngest, "person");
    expect(candidateOffer.map((item) => item.contentHash)).toContain(authoredContentHash);

    // --- Device B: an empty peer device, ready to receive. ---
    const libraryServiceB = LibraryService.createEmpty(new InMemoryMetadataRepositoryPort());

    // --- Real SwapService <-> SwapService swap over an in-memory transport pair. ---
    const addressA: PeerAddress = { id: "authoring-device" };
    const addressB: PeerAddress = { id: "peer-device" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    const swapServiceA = new SwapService({
      transport: transportA,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: naiveOfferPolicy,
      acceptPolicy: naiveAcceptPolicy,
      evictionPolicy: naiveEvictionPolicy,
    });
    const swapServiceB = new SwapService({
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
      swapServiceA.swap(peerB, libraryAfterIngest),
      swapServiceB.swap(peerA, libraryServiceB.getLibrary()),
    ]);

    expect(outcomeA.state.phase).toBe("completed");
    expect(outcomeB.state.phase).toBe("completed");

    // A actually SENT the authored piece...
    expect(outcomeA.sent.map((item) => item.contentHash)).toContain(authoredContentHash);
    // ...and B actually ACCEPTED it.
    expect(outcomeB.accepted.map((item) => item.contentHash)).toContain(authoredContentHash);

    // It genuinely lands in B's reconciled library, not just in the wire message.
    expect(outcomeB.library.entries.has(authoredContentHash)).toBe(true);
    const receivedEntry = outcomeB.library.entries.get(authoredContentHash);
    expect(receivedEntry?.token.title).toBe("My Own Piece");
    expect(receivedEntry?.token.creator).toBe("The Artist");
    // Hop count advanced by exactly one hop, per issue #21's provenance model.
    expect(receivedEntry?.token.provenance.hopCount).toBe(1);
  });
});
