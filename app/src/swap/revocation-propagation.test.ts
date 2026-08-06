/**
 * Moderation and takedown propagation (issue #51).
 *
 * SPEC.md §11 open question 7 / IMPLEMENTATION.md Phase 2 item 51: revocation
 * must propagate opportunistically through swaps (no always-on central
 * authority), and a device that was offline when the original revocation
 * happened must still receive and apply it later — via *any* peer that
 * already knows about it, not only the original revoker.
 *
 * All three devices below use real in-memory transports and a real
 * `SwapService` (`app`'s own class, unmodified test double for anything —
 * see `swap-service.test.ts`'s identical pattern), each with its own
 * `RevocationLogPort` — exactly how two independent devices would each hold
 * their own local knowledge in production.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_LIBRARY,
  InMemoryClockPort,
  InMemoryEncounterLogPort,
  InMemoryIdentityPort,
  InMemoryMetadataRepositoryPort,
  InMemoryRevocationLogPort,
  InMemorySignatureVerifierPort,
  addItem,
  createInMemoryTransportPair,
  naiveAcceptPolicy,
  naiveEvictionPolicy,
  naiveOfferPolicy,
  toPriority,
  type Library,
  type PeerAddress,
  type RevocationLogPort,
} from "@art-pollinator/core";
import { signMetadataToken } from "../identity/sign-metadata-token.js";
import { signRevocationEntry } from "../identity/sign-revocation.js";
import { SwapService } from "./swap-service.js";

function buildService(
  transport: ReturnType<typeof createInMemoryTransportPair>["a"],
  revocationLog: RevocationLogPort,
): SwapService {
  return new SwapService({
    transport,
    metadataRepository: new InMemoryMetadataRepositoryPort(),
    encounterLog: new InMemoryEncounterLogPort(),
    clock: new InMemoryClockPort(0),
    offerPolicy: naiveOfferPolicy,
    acceptPolicy: naiveAcceptPolicy,
    evictionPolicy: naiveEvictionPolicy,
    signatureVerifier: new InMemorySignatureVerifierPort(),
    revocationLog,
  });
}

async function swapPair(
  addressA: PeerAddress,
  addressB: PeerAddress,
  libraryA: Library,
  libraryB: Library,
  revocationLogA: RevocationLogPort,
  revocationLogB: RevocationLogPort,
): Promise<{
  outcomeA: Awaited<ReturnType<SwapService["swap"]>>;
  outcomeB: Awaited<ReturnType<SwapService["swap"]>>;
}> {
  const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);
  const serviceA = buildService(transportA, revocationLogA);
  const serviceB = buildService(transportB, revocationLogB);
  const [outcomeA, outcomeB] = await Promise.all([
    serviceA.swap({ address: addressB, kind: "person" }, libraryA),
    serviceB.swap({ address: addressA, kind: "person" }, libraryB),
  ]);
  return { outcomeA, outcomeB };
}

describe("Revocation propagation (issue #51)", () => {
  it("a peer directly swapping with the revoker immediately loses the revoked item", async () => {
    const artist = new InMemoryIdentityPort("artist-1");
    const piece = await signMetadataToken(
      {
        title: "Piece",
        creator: "Artist",
        description: "d",
        provenance: { hopCount: 0 },
        contentType: "image/jpeg",
        blobPointer: { scheme: "local-filesystem", contentHash: "piece-1" },
        contentHash: "piece-1",
        signature: "",
      },
      artist,
    );

    // Device B already holds the piece (signed by the same artist).
    let libraryB = EMPTY_LIBRARY;
    const addedB = addItem(libraryB, piece, toPriority(0));
    if (!addedB.ok) throw new Error(addedB.error);
    libraryB = addedB.library;

    // Device A (the revoker) knows a revocation for it, signed by the same artist key.
    const revocationLogA = new InMemoryRevocationLogPort();
    const revocationEntry = await signRevocationEntry("piece-1", 5_000, artist);
    await revocationLogA.record(revocationEntry);

    const { outcomeB } = await swapPair(
      { id: "device-a" },
      { id: "device-b" },
      EMPTY_LIBRARY,
      libraryB,
      revocationLogA,
      new InMemoryRevocationLogPort(),
    );

    expect(outcomeB.revoked).toEqual(["piece-1"]);
    expect(outcomeB.library.entries.has("piece-1")).toBe(false);
  });

  it("an offline device receives and applies a revocation via a third-party intermediary, not the original revoker", async () => {
    const artist = new InMemoryIdentityPort("artist-1");
    const piece = await signMetadataToken(
      {
        title: "Piece",
        creator: "Artist",
        description: "d",
        provenance: { hopCount: 0 },
        contentType: "image/jpeg",
        blobPointer: { scheme: "local-filesystem", contentHash: "piece-1" },
        contentHash: "piece-1",
        signature: "",
      },
      artist,
    );

    // --- Device Offline: was offline when the artist revoked "piece-1".
    // It still holds a copy, signed by the same artist, and has never heard
    // of the revocation. ---
    let libraryOffline = EMPTY_LIBRARY;
    const addedOffline = addItem(libraryOffline, piece, toPriority(0));
    if (!addedOffline.ok) throw new Error(addedOffline.error);
    libraryOffline = addedOffline.library;
    const revocationLogOffline = new InMemoryRevocationLogPort();

    // --- Device Intermediary: was online, already swapped with the artist
    // at some point in the past, and therefore already knows about the
    // revocation — but does NOT hold the piece itself (already evicted, or
    // never received it). ---
    const revocationLogIntermediary = new InMemoryRevocationLogPort();
    const revocationEntry = await signRevocationEntry("piece-1", 5_000, artist);
    await revocationLogIntermediary.record(revocationEntry);

    // Sanity check: Device Offline has not yet learned of the revocation.
    expect(await revocationLogOffline.has("piece-1")).toBe(false);
    expect(libraryOffline.entries.has("piece-1")).toBe(true);

    // --- Device Offline comes back online and swaps with Device
    // Intermediary — NOT the original artist/revoker. ---
    const { outcomeA: outcomeOffline } = await swapPair(
      { id: "device-offline" },
      { id: "device-intermediary" },
      libraryOffline,
      EMPTY_LIBRARY,
      revocationLogOffline,
      revocationLogIntermediary,
    );

    // The revocation propagated opportunistically through a peer that was
    // never the original revoker, and Device Offline applied it: the piece
    // is gone from its library, and it now knows the revocation itself
    // (ready to pass it on to whoever it meets next).
    expect(outcomeOffline.revoked).toEqual(["piece-1"]);
    expect(outcomeOffline.library.entries.has("piece-1")).toBe(false);
    expect(await revocationLogOffline.has("piece-1")).toBe(true);
  });

  it("does not remove content when the revocation's signer does not match the original content's signer (unauthorized)", async () => {
    const artist = new InMemoryIdentityPort("artist-1");
    const impostor = new InMemoryIdentityPort("impostor");
    const piece = await signMetadataToken(
      {
        title: "Piece",
        creator: "Artist",
        description: "d",
        provenance: { hopCount: 0 },
        contentType: "image/jpeg",
        blobPointer: { scheme: "local-filesystem", contentHash: "piece-1" },
        contentHash: "piece-1",
        signature: "",
      },
      artist,
    );

    let libraryB = EMPTY_LIBRARY;
    const addedB = addItem(libraryB, piece, toPriority(0));
    if (!addedB.ok) throw new Error(addedB.error);
    libraryB = addedB.library;

    // The impostor (not the artist) tries to revoke the artist's piece.
    const revocationLogA = new InMemoryRevocationLogPort();
    const forgedRevocation = await signRevocationEntry("piece-1", 5_000, impostor);
    await revocationLogA.record(forgedRevocation);

    const { outcomeB } = await swapPair(
      { id: "device-a" },
      { id: "device-b" },
      EMPTY_LIBRARY,
      libraryB,
      revocationLogA,
      new InMemoryRevocationLogPort(),
    );

    // The entry's signature is valid (the impostor really does control that
    // key) so it is still recorded/relayed, but it is NOT authorized against
    // the piece B actually holds (different signer) — B keeps its copy.
    expect(outcomeB.revoked).toEqual([]);
    expect(outcomeB.library.entries.has("piece-1")).toBe(true);
  });

  it("a revoked item is never re-offered or re-accepted once known, even across further swaps", async () => {
    const artist = new InMemoryIdentityPort("artist-1");
    const piece = await signMetadataToken(
      {
        title: "Piece",
        creator: "Artist",
        description: "d",
        provenance: { hopCount: 0 },
        contentType: "image/jpeg",
        blobPointer: { scheme: "local-filesystem", contentHash: "piece-1" },
        contentHash: "piece-1",
        signature: "",
      },
      artist,
    );

    // Device C still has the piece and does NOT know about the revocation.
    let libraryC = EMPTY_LIBRARY;
    const addedC = addItem(libraryC, piece, toPriority(0));
    if (!addedC.ok) throw new Error(addedC.error);
    libraryC = addedC.library;

    // Device D already knows the revocation (learned from elsewhere) but
    // does not hold the piece.
    const revocationLogD = new InMemoryRevocationLogPort();
    const revocationEntry = await signRevocationEntry("piece-1", 5_000, artist);
    await revocationLogD.record(revocationEntry);

    const { outcomeA: outcomeC } = await swapPair(
      { id: "device-c" },
      { id: "device-d" },
      libraryC,
      EMPTY_LIBRARY,
      new InMemoryRevocationLogPort(),
      revocationLogD,
    );

    // C learns of the revocation in the very first (revocation) round of
    // this same swap, removes the piece from its own working library
    // before OfferPolicy ever runs — so it is never even offered, let
    // alone sent.
    expect(outcomeC.offered.some((item) => item.contentHash === "piece-1")).toBe(false);
    expect(outcomeC.sent).toEqual([]);
    expect(outcomeC.revoked).toEqual(["piece-1"]);
    expect(outcomeC.library.entries.has("piece-1")).toBe(false);
  });
});
