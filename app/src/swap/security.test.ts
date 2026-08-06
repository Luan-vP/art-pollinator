/**
 * SwapService security tests (issue #49) — proving the two concrete DoD
 * claims directly:
 *
 * 1. A flooding peer making many rapid swap attempts gets throttled/
 *    rejected past the configured limit.
 * 2. A connection sending a malformed/oversized message is rejected before
 *    any repository write.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_LIBRARY,
  InMemoryClockPort,
  InMemoryEncounterLogPort,
  InMemoryLoggerPort,
  InMemoryMetadataRepositoryPort,
  SlidingWindowRateLimiter,
  addItem,
  naiveAcceptPolicy,
  naiveEvictionPolicy,
  naiveOfferPolicy,
  toPriority,
  createInMemoryTransportPair,
  type AcceptPolicy,
  type MetadataToken,
  type PeerAddress,
} from "@art-pollinator/core";
import { SwapAbortedError, SwapService } from "./swap-service.js";

function token(contentHash: string, descriptionLength = 10): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "x".repeat(descriptionLength),
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
}

describe("SwapService rate limiting (issue #49)", () => {
  it("allows swap attempts within the configured limit", async () => {
    const rateLimiter = new SlidingWindowRateLimiter({ maxEvents: 5, windowMs: 60_000 });
    const clock = new InMemoryClockPort(0);
    const addressA: PeerAddress = { id: "flooder" };
    const addressB: PeerAddress = { id: "target" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    const serviceA = new SwapService({
      transport: transportA,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock,
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
      swapRateLimiter: rateLimiter,
    });

    const [, outcomeB] = await Promise.all([
      serviceA.swap({ address: addressB, kind: "person" }, EMPTY_LIBRARY),
      serviceB.swap({ address: addressA, kind: "person" }, EMPTY_LIBRARY),
    ]);
    expect(outcomeB.state.phase).toBe("completed");
  });

  it("rejects a flooding peer's attempts past the configured limit, before any negotiation or repository access", async () => {
    const rateLimiter = new SlidingWindowRateLimiter({ maxEvents: 2, windowMs: 60_000 });
    const clock = new InMemoryClockPort(0);
    const repositoryB = new InMemoryMetadataRepositoryPort();
    const logger = new InMemoryLoggerPort();
    const flooderAddress: PeerAddress = { id: "flooder" };

    async function attempt(): Promise<"completed" | "aborted"> {
      const targetAddress: PeerAddress = { id: "target" };
      const { a: transportFlooder, b: transportTarget } = createInMemoryTransportPair(
        flooderAddress,
        targetAddress,
      );
      const flooderService = new SwapService({
        transport: transportFlooder,
        metadataRepository: new InMemoryMetadataRepositoryPort(),
        encounterLog: new InMemoryEncounterLogPort(),
        clock: new InMemoryClockPort(0),
        offerPolicy: naiveOfferPolicy,
        acceptPolicy: naiveAcceptPolicy,
        evictionPolicy: naiveEvictionPolicy,
        // Short: if the target rejects this attempt immediately (rate
        // limited), it never sends anything back — the flooder side must
        // not hang the real 30s default waiting for a reply that will
        // never come.
        receiveTimeoutMs: 200,
      });
      const targetService = new SwapService({
        transport: transportTarget,
        metadataRepository: repositoryB,
        encounterLog: new InMemoryEncounterLogPort(),
        clock,
        offerPolicy: naiveOfferPolicy,
        acceptPolicy: naiveAcceptPolicy,
        evictionPolicy: naiveEvictionPolicy,
        swapRateLimiter: rateLimiter,
        logger,
      });

      // Both sides must run concurrently (as every other swap test in this
      // codebase does) — a rate-limited target rejects before ever calling
      // transport.send, so the flooder side's own receive() would hang
      // forever if the two were awaited sequentially instead.
      const [, targetResult] = await Promise.allSettled([
        flooderService.swap({ address: targetAddress, kind: "person" }, EMPTY_LIBRARY),
        targetService.swap({ address: flooderAddress, kind: "person" }, EMPTY_LIBRARY),
      ]);
      return targetResult.status === "fulfilled" ? "completed" : "aborted";
    }

    const first = await attempt();
    const second = await attempt();
    expect(first).toBe("completed");
    expect(second).toBe("completed");

    // Third attempt exceeds maxEvents: 2 — rejected immediately, never
    // reaching negotiation.
    const third = await attempt();
    expect(third).toBe("aborted");

    // The rate-limit rejection was logged (issue #52 tie-in).
    expect(logger.history().some((e) => e.event === "security.rate_limited")).toBe(true);

    // The rejected attempt never wrote anything new to the repository
    // beyond what the two successful attempts already wrote (both of which
    // offered/accepted nothing, so the repository stays empty throughout).
    expect(await repositoryB.listAll()).toEqual([]);
  });
});

describe("SwapService content validation on ingest (issue #49)", () => {
  it("drops an oversized item before it reaches AcceptPolicy or the repository, keeping normal-sized items", async () => {
    const addressA: PeerAddress = { id: "device-a" };
    const addressB: PeerAddress = { id: "device-b" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    let libraryA = EMPTY_LIBRARY;
    for (const item of [token("huge", 10_000), token("normal")]) {
      const result = addItem(libraryA, item, toPriority(0));
      if (!result.ok) throw new Error(result.error);
      libraryA = result.library;
    }

    const repositoryB = new InMemoryMetadataRepositoryPort();
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
      metadataRepository: repositoryB,
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

    expect(outcomeB.rejectedOversized.map((i) => i.contentHash)).toEqual(["huge"]);
    expect(outcomeB.accepted.map((i) => i.contentHash)).toEqual(["normal"]);

    // The repository only ever received the item that passed validation —
    // never the oversized one.
    const persisted = await repositoryB.listAll();
    expect(persisted.map((i) => i.contentHash)).toEqual(["normal"]);
  });

  it("aborts the whole swap (no repository write at all) when the peer sends an implausibly large item count", async () => {
    const addressA: PeerAddress = { id: "device-a" };
    const addressB: PeerAddress = { id: "device-b" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    // AcceptPolicy that would accept everything, standing in for "a hostile
    // peer whose own AcceptPolicy is permissive" — irrelevant here because
    // the whole-offer-too-large check runs before AcceptPolicy is ever
    // reached on the *offering* side's own send, so this test instead
    // forces the abuse via a custom OfferPolicy on side A that floods side
    // B's receive() with more items than MAX_OFFER_ITEMS permits.
    let hugeLibrary = EMPTY_LIBRARY;
    for (let i = 0; i < 5_001; i++) {
      const result = addItem(hugeLibrary, token(`item-${String(i)}`), toPriority(0), {
        maxLockableSlots: 0,
        swappableSlots: 6_000,
      });
      if (!result.ok) throw new Error(result.error);
      hugeLibrary = result.library;
    }

    const acceptEverything: AcceptPolicy = { selectAccept: (offered) => [...offered] };
    const repositoryB = new InMemoryMetadataRepositoryPort();

    const serviceA = new SwapService({
      transport: transportA,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: { selectOffer: () => [...hugeLibrary.entries.values()].map((e) => e.token) },
      acceptPolicy: acceptEverything,
      evictionPolicy: naiveEvictionPolicy,
      libraryCapacity: { maxLockableSlots: 0, swappableSlots: 6_000 },
      // Short: once B aborts (rejecting the huge offer), it never sends A
      // a reply — A must not hang the real 30s default waiting for one.
      receiveTimeoutMs: 200,
    });
    const serviceB = new SwapService({
      transport: transportB,
      metadataRepository: repositoryB,
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: naiveOfferPolicy,
      acceptPolicy: acceptEverything,
      evictionPolicy: naiveEvictionPolicy,
      receiveTimeoutMs: 200,
    });

    const [aResult, bResult] = await Promise.allSettled([
      serviceA.swap({ address: addressB, kind: "person" }, hugeLibrary),
      serviceB.swap({ address: addressA, kind: "person" }, EMPTY_LIBRARY),
    ]);

    expect(aResult.status).toBe("rejected"); // A also aborts once B disconnects — irrelevant to this test's real claim
    expect(bResult.status).toBe("rejected");
    if (bResult.status === "rejected") {
      expect(bResult.reason).toBeInstanceOf(SwapAbortedError);
    }
    expect(await repositoryB.listAll()).toEqual([]);
  });
});
