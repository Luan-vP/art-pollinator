import { describe, expect, it } from "vitest";
import {
  EMPTY_LIBRARY,
  InMemoryClockPort,
  InMemoryEncounterLogPort,
  InMemoryIdentityPort,
  InMemoryMetadataRepositoryPort,
  InMemorySignatureVerifierPort,
  MAX_LOCKABLE_SLOTS,
  SWAPPABLE_SLOTS,
  addItem,
  createInMemoryTransportPair,
  lockItem,
  naiveAcceptPolicy,
  naiveEvictionPolicy,
  naiveOfferPolicy,
  toPriority,
  type AcceptPolicy,
  type DiscoveredPeer,
  type Library,
  type MetadataToken,
  type PeerAddress,
} from "@art-pollinator/core";
import { signMetadataToken } from "../identity/sign-metadata-token.js";
import { SwapService } from "./swap-service.js";

function token(contentHash: string): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "A piece worth passing on.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { contentHash },
    contentHash,
    signature: "",
  };
}

function buildLibrary(
  specs: readonly { hash: string; priority?: number; locked?: boolean }[],
): Library {
  let library = EMPTY_LIBRARY;
  for (const spec of specs) {
    const added = addItem(library, token(spec.hash), toPriority(spec.priority ?? 0));
    if (!added.ok) throw new Error(`fixture setup failed: ${added.error}`);
    library = added.library;
    if (spec.locked) {
      const locked = lockItem(library, spec.hash);
      if (!locked.ok) throw new Error(`fixture setup failed: ${locked.error}`);
      library = locked.library;
    }
  }
  return library;
}

function hashes(items: readonly MetadataToken[]): string[] {
  return items.map((i) => i.contentHash).sort();
}

describe("SwapService: full two-way swap between two simulated devices (in-memory fakes only)", () => {
  it("moves offered items each way and reconciles both libraries when everything fits", async () => {
    const addressA: PeerAddress = { id: "device-a" };
    const addressB: PeerAddress = { id: "device-b" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    const libraryA = buildLibrary([{ hash: "alpha" }, { hash: "beta" }, { hash: "gamma" }]);
    const libraryB = buildLibrary([{ hash: "delta" }, { hash: "epsilon" }]);

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

    expect(outcomeA.state.phase).toBe("completed");
    expect(outcomeB.state.phase).toBe("completed");

    // A offered all 3 of its items; B had room for all 3 (2 held + 3 = 5).
    expect(hashes(outcomeA.sent)).toEqual(["alpha", "beta", "gamma"]);
    // B offered both of its items; A had room for both (3 held + 2 = 5).
    expect(hashes(outcomeA.accepted)).toEqual(["delta", "epsilon"]);
    expect(outcomeA.evicted).toEqual([]);

    expect(hashes(outcomeB.sent)).toEqual(["delta", "epsilon"]);
    expect(hashes(outcomeB.accepted)).toEqual(["alpha", "beta", "gamma"]);
    expect(outcomeB.evicted).toEqual([]);

    expect(Object.keys(Object.fromEntries(outcomeA.library.entries)).sort()).toEqual([
      "alpha",
      "beta",
      "delta",
      "epsilon",
      "gamma",
    ]);
    expect(Object.keys(Object.fromEntries(outcomeB.library.entries)).sort()).toEqual([
      "alpha",
      "beta",
      "delta",
      "epsilon",
      "gamma",
    ]);
  });
});

describe("SwapService: one-way (asymmetric) swap — SPEC.md §6.3", () => {
  it("lets a seeder give items to an empty receiver without receiving anything back", async () => {
    const addressA: PeerAddress = { id: "seeder" };
    const addressB: PeerAddress = { id: "receiver" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    const libraryA = buildLibrary([{ hash: "seed-1" }, { hash: "seed-2" }]);
    const libraryB = EMPTY_LIBRARY;

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

    const [outcomeSeeder, outcomeReceiver] = await Promise.all([
      serviceA.swap({ address: addressB, kind: "person" }, libraryA),
      serviceB.swap({ address: addressA, kind: "person" }, libraryB),
    ]);

    // The state machine reaches the *same* terminal phase as a two-way
    // swap — asymmetry shows up only in which fields are empty, never as a
    // distinct phase or a special "one-way" branch (core/src/swap/swap-state-machine.ts).
    expect(outcomeSeeder.state.phase).toBe("completed");
    expect(outcomeReceiver.state.phase).toBe("completed");
    if (outcomeSeeder.state.phase === "completed") {
      expect(hashes(outcomeSeeder.state.sent)).toEqual(["seed-1", "seed-2"]);
      expect(outcomeSeeder.state.received).toEqual([]);
    }
    if (outcomeReceiver.state.phase === "completed") {
      expect(outcomeReceiver.state.sent).toEqual([]);
      expect(hashes(outcomeReceiver.state.received)).toEqual(["seed-1", "seed-2"]);
    }

    // The seeder's own library is untouched: it gave, but received nothing.
    expect(hashes(outcomeSeeder.accepted)).toEqual([]);
    expect(outcomeSeeder.evicted).toEqual([]);
    expect(Object.keys(Object.fromEntries(outcomeSeeder.library.entries)).sort()).toEqual([
      "seed-1",
      "seed-2",
    ]);

    // The receiver gained both seeded items and sent nothing of its own.
    expect(hashes(outcomeReceiver.sent)).toEqual([]);
    expect(hashes(outcomeReceiver.accepted)).toEqual(["seed-1", "seed-2"]);
    expect(Object.keys(Object.fromEntries(outcomeReceiver.library.entries)).sort()).toEqual([
      "seed-1",
      "seed-2",
    ]);
  });
});

describe("SwapService: locked items are never evicted through the full orchestrated path", () => {
  it("keeps locked items resident even when accepting incoming items forces a full swappable-pool eviction", async () => {
    const addressA: PeerAddress = { id: "device-a" };
    const addressB: PeerAddress = { id: "device-b" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    // Device B: swappable pool completely full (5 items, ascending
    // priority so s-0 is the lowest), plus 2 *locked* items given an even
    // lower priority than any swappable item — if the locked-item
    // invariant were not enforced end-to-end, the naive "lowest priority
    // first" EvictionPolicy would pick these first.
    const libraryB = buildLibrary([
      { hash: "locked-0", priority: -1_000, locked: true },
      { hash: "locked-1", priority: -1_000, locked: true },
      { hash: "swap-0", priority: 0 },
      { hash: "swap-1", priority: 1 },
      { hash: "swap-2", priority: 2 },
      { hash: "swap-3", priority: 3 },
      { hash: "swap-4", priority: 4 },
    ]);
    expect(MAX_LOCKABLE_SLOTS).toBeGreaterThanOrEqual(2);
    expect(SWAPPABLE_SLOTS).toBe(5);

    // Device A offers exactly SWAPPABLE_SLOTS new items — enough to force
    // B to evict everything in its swappable pool to make room, *if* B's
    // AcceptPolicy accepts all of them (a policy that accepts beyond
    // currently-free capacity, expecting EvictionPolicy to make room —
    // the naive "accept what fits" default never does this, so this test
    // supplies a policy that does, to actually exercise reconciliation).
    const libraryA = buildLibrary(
      Array.from({ length: SWAPPABLE_SLOTS }, (_, i) => ({ hash: `incoming-${String(i)}` })),
    );
    const acceptEverythingPolicy: AcceptPolicy = {
      selectAccept: (offered) => [...offered],
    };

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
      acceptPolicy: acceptEverythingPolicy,
      evictionPolicy: naiveEvictionPolicy,
    });

    const [, outcomeB] = await Promise.all([
      serviceA.swap({ address: addressB, kind: "person" }, libraryA),
      serviceB.swap({ address: addressA, kind: "person" }, libraryB),
    ]);

    expect(outcomeB.state.phase).toBe("completed");

    // Every swappable item was evicted to make room — none of them locked.
    expect(hashes(outcomeB.evicted)).toEqual(["swap-0", "swap-1", "swap-2", "swap-3", "swap-4"]);

    // Both locked items are still present and still locked.
    const finalEntries = outcomeB.library.entries;
    expect(finalEntries.get("locked-0")).toMatchObject({ locked: true });
    expect(finalEntries.get("locked-1")).toMatchObject({ locked: true });

    // The final library holds exactly the 2 locked items plus the 5 newly
    // accepted incoming items — the evicted swappable items are gone.
    expect([...finalEntries.keys()].sort()).toEqual(
      [
        "locked-0",
        "locked-1",
        "incoming-0",
        "incoming-1",
        "incoming-2",
        "incoming-3",
        "incoming-4",
      ].sort(),
    );
  });
});

describe("SwapService: item-scoped encounter memory suppresses re-offering across a rotated peer identity", () => {
  it("suppresses a previously-declined item when 'revisiting' a peer under a new identity, and un-suppresses it once the window elapses", async () => {
    const addressA: PeerAddress = { id: "device-a" };
    const suppressionWindowMs = 1_000;

    const clockA = new InMemoryClockPort(0);
    const encounterLogA = new InMemoryEncounterLogPort();
    const repositoryA = new InMemoryMetadataRepositoryPort();

    // Device A always holds the same 3 items across every "encounter" —
    // only the peer-facing identity changes between rounds.
    let libraryA = buildLibrary([{ hash: "alpha" }, { hash: "beta" }, { hash: "gamma" }]);

    // B declines "alpha" specifically every time (everything else it
    // accepts normally) — a stand-in for a peer that never wants this one
    // piece, deterministic and independent of capacity.
    const declineAlphaPolicy: AcceptPolicy = {
      selectAccept: (offered, library) =>
        naiveAcceptPolicy.selectAccept(
          offered.filter((item) => item.contentHash !== "alpha"),
          library,
        ),
    };

    function makeServiceA(
      transport: ReturnType<typeof createInMemoryTransportPair>["a"],
    ): SwapService {
      return new SwapService({
        transport,
        metadataRepository: repositoryA,
        encounterLog: encounterLogA,
        clock: clockA,
        offerPolicy: naiveOfferPolicy,
        acceptPolicy: naiveAcceptPolicy,
        evictionPolicy: naiveEvictionPolicy,
        encounterSuppressionWindowMs: suppressionWindowMs,
      });
    }

    function makeServiceB(
      transport: ReturnType<typeof createInMemoryTransportPair>["b"],
      library: Library,
    ): { service: SwapService; library: Library } {
      return {
        service: new SwapService({
          transport,
          metadataRepository: new InMemoryMetadataRepositoryPort(),
          encounterLog: new InMemoryEncounterLogPort(),
          clock: new InMemoryClockPort(0),
          offerPolicy: naiveOfferPolicy,
          acceptPolicy: declineAlphaPolicy,
          evictionPolicy: naiveEvictionPolicy,
        }),
        library,
      };
    }

    // --- Round 1: first encounter. B declines "alpha". ---
    {
      const addressB1: PeerAddress = { id: "device-b#ephemeral-1" };
      const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB1);
      const serviceA = makeServiceA(transportA);
      const { service: serviceB, library: libraryB } = makeServiceB(transportB, EMPTY_LIBRARY);

      const [outcomeA] = await Promise.all([
        serviceA.swap({ address: addressB1, kind: "person" }, libraryA),
        serviceB.swap({ address: addressA, kind: "person" }, libraryB),
      ]);

      expect(hashes(outcomeA.offered)).toEqual(["alpha", "beta", "gamma"]); // nothing suppressed yet
      expect(hashes(outcomeA.sent)).toEqual(["beta", "gamma"]); // alpha declined by B
      libraryA = outcomeA.library;

      await expect(encounterLogA.history("alpha")).resolves.toEqual([
        { outcome: "declined", atEpochMs: 0 },
      ]);
    }

    // --- Round 2: "revisit" the same peer under a rotated ephemeral
    // identity, still well within the suppression window. Alpha must stay
    // suppressed — encounter memory is item-scoped, not peer-scoped, so a
    // new peer address cannot evade it (SPEC.md §6.4/§7). ---
    clockA.advance(10);
    {
      const addressB2: PeerAddress = { id: "device-b#ephemeral-2" };
      const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB2);
      const serviceA = makeServiceA(transportA);
      const { service: serviceB, library: libraryB } = makeServiceB(transportB, EMPTY_LIBRARY);

      const [outcomeA] = await Promise.all([
        serviceA.swap({ address: addressB2, kind: "person" }, libraryA),
        serviceB.swap({ address: addressA, kind: "person" }, libraryB),
      ]);

      expect(hashes(outcomeA.offered)).toEqual(["beta", "gamma"]); // alpha suppressed
      expect(outcomeA.offered.some((item) => item.contentHash === "alpha")).toBe(false);
      libraryA = outcomeA.library;
    }

    // --- Round 3: the suppression window has fully elapsed — alpha is
    // eligible to be offered again. ---
    clockA.advance(suppressionWindowMs);
    {
      const addressB3: PeerAddress = { id: "device-b#ephemeral-3" };
      const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB3);
      const serviceA = makeServiceA(transportA);
      const { service: serviceB, library: libraryB } = makeServiceB(transportB, EMPTY_LIBRARY);

      const [outcomeA] = await Promise.all([
        serviceA.swap({ address: addressB3, kind: "person" }, libraryA),
        serviceB.swap({ address: addressA, kind: "person" }, libraryB),
      ]);

      expect(hashes(outcomeA.offered)).toEqual(["alpha", "beta", "gamma"]); // un-suppressed
    }
  });
});

describe("SwapService: provenance hop count advances across successive hops (issue #21)", () => {
  it("increments hop count on receipt, and the incremented value is what gets re-offered to a third party", async () => {
    // Round 1: A (originator, hopCount 0) swaps "piece" to B.
    const addressA: PeerAddress = { id: "device-a" };
    const addressB: PeerAddress = { id: "device-b" };
    const round1 = createInMemoryTransportPair(addressA, addressB);

    const libraryA = buildLibrary([{ hash: "piece" }]); // provenance.hopCount 0, via the `token()` fixture
    const serviceA = new SwapService({
      transport: round1.a,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: naiveOfferPolicy,
      acceptPolicy: naiveAcceptPolicy,
      evictionPolicy: naiveEvictionPolicy,
    });
    const serviceB = new SwapService({
      transport: round1.b,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: naiveOfferPolicy,
      acceptPolicy: naiveAcceptPolicy,
      evictionPolicy: naiveEvictionPolicy,
    });

    const [, outcomeB] = await Promise.all([
      serviceA.swap({ address: addressB, kind: "person" }, libraryA),
      serviceB.swap({ address: addressA, kind: "person" }, EMPTY_LIBRARY),
    ]);

    // B received the piece with hop count incremented from 0 to 1 — B did
    // not author it, it travelled one hop to reach B.
    expect(outcomeB.accepted).toHaveLength(1);
    expect(outcomeB.accepted[0]?.provenance.hopCount).toBe(1);
    expect(outcomeB.library.entries.get("piece")?.token.provenance.hopCount).toBe(1);

    // Round 2: B re-offers its (now hop-count-1) library on to C.
    const addressC: PeerAddress = { id: "device-c" };
    const round2 = createInMemoryTransportPair(addressB, addressC);
    const serviceB2 = new SwapService({
      transport: round2.a,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: naiveOfferPolicy,
      acceptPolicy: naiveAcceptPolicy,
      evictionPolicy: naiveEvictionPolicy,
    });
    const serviceC = new SwapService({
      transport: round2.b,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: naiveOfferPolicy,
      acceptPolicy: naiveAcceptPolicy,
      evictionPolicy: naiveEvictionPolicy,
    });

    const [outcomeBAgain, outcomeC] = await Promise.all([
      serviceB2.swap({ address: addressC, kind: "person" }, outcomeB.library),
      serviceC.swap({ address: addressB, kind: "person" }, EMPTY_LIBRARY),
    ]);

    // B offered the piece it already holds at hop count 1 — offering does
    // not itself increment hop count, only receiving does.
    expect(outcomeBAgain.offered[0]?.provenance.hopCount).toBe(1);

    // C received it and incremented it again: 1 -> 2. The token has now
    // demonstrably passed through two hops since its origin, and nothing
    // anywhere in this chain ever recorded *which* devices it passed
    // through — only the count (docs/adr/0007-provenance-hop-count-only.md).
    expect(outcomeC.accepted[0]?.provenance.hopCount).toBe(2);
    expect(outcomeC.library.entries.get("piece")?.token.provenance.hopCount).toBe(2);
  });
});

describe("SwapService: signature verification (issue #58)", () => {
  function signedToken(
    identity: InMemoryIdentityPort,
    contentHash: string,
  ): Promise<MetadataToken> {
    return signMetadataToken(token(contentHash), identity);
  }

  it("accepts a properly signed token when a signatureVerifier is configured", async () => {
    const addressA: PeerAddress = { id: "device-a" };
    const addressB: PeerAddress = { id: "device-b" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    const artist = new InMemoryIdentityPort("artist-1");
    const signed = await signedToken(artist, "signed-piece");
    let libraryA = EMPTY_LIBRARY;
    const added = addItem(libraryA, signed, toPriority(0));
    if (!added.ok) throw new Error(added.error);
    libraryA = added.library;

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
      signatureVerifier: new InMemorySignatureVerifierPort(),
    });

    const [, outcomeB] = await Promise.all([
      serviceA.swap({ address: addressB, kind: "person" }, libraryA),
      serviceB.swap({ address: addressA, kind: "person" }, EMPTY_LIBRARY),
    ]);

    expect(hashes(outcomeB.accepted)).toEqual(["signed-piece"]);
    expect(outcomeB.rejectedUnverified).toEqual([]);
  });

  it("rejects an unsigned token when a signatureVerifier is configured, without evicting or erroring", async () => {
    const addressA: PeerAddress = { id: "device-a" };
    const addressB: PeerAddress = { id: "device-b" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    // Plain `token()` fixture: signature "" and no signerPublicKey — unsigned.
    const libraryA = buildLibrary([{ hash: "unsigned-piece" }]);

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
      signatureVerifier: new InMemorySignatureVerifierPort(),
    });

    const [, outcomeB] = await Promise.all([
      serviceA.swap({ address: addressB, kind: "person" }, libraryA),
      serviceB.swap({ address: addressA, kind: "person" }, EMPTY_LIBRARY),
    ]);

    expect(outcomeB.accepted).toEqual([]);
    expect(hashes(outcomeB.rejectedUnverified)).toEqual(["unsigned-piece"]);
  });

  it("rejects a tampered token (signed, then mutated in transit) when a signatureVerifier is configured", async () => {
    const addressA: PeerAddress = { id: "device-a" };
    const addressB: PeerAddress = { id: "device-b" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    const artist = new InMemoryIdentityPort("artist-1");
    const signed = await signedToken(artist, "tampered-piece");
    // Simulate tampering in transit: mutate a signed field after signing.
    const tampered: MetadataToken = { ...signed, title: `${signed.title} (forged edit)` };
    let libraryA = EMPTY_LIBRARY;
    const added = addItem(libraryA, tampered, toPriority(0));
    if (!added.ok) throw new Error(added.error);
    libraryA = added.library;

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
      signatureVerifier: new InMemorySignatureVerifierPort(),
    });

    const [, outcomeB] = await Promise.all([
      serviceA.swap({ address: addressB, kind: "person" }, libraryA),
      serviceB.swap({ address: addressA, kind: "person" }, EMPTY_LIBRARY),
    ]);

    expect(outcomeB.accepted).toEqual([]);
    expect(hashes(outcomeB.rejectedUnverified)).toEqual(["tampered-piece"]);
  });

  it("skips verification entirely (accepts unsigned tokens) when no signatureVerifier is configured — backward compatible default", async () => {
    const addressA: PeerAddress = { id: "device-a" };
    const addressB: PeerAddress = { id: "device-b" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    const libraryA = buildLibrary([{ hash: "unsigned-piece" }]);

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
      // no signatureVerifier configured
    });

    const [, outcomeB] = await Promise.all([
      serviceA.swap({ address: addressB, kind: "person" }, libraryA),
      serviceB.swap({ address: addressA, kind: "person" }, EMPTY_LIBRARY),
    ]);

    expect(hashes(outcomeB.accepted)).toEqual(["unsigned-piece"]);
    expect(outcomeB.rejectedUnverified).toEqual([]);
  });
});
