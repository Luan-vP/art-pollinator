import { describe, expect, it } from "vitest";
import {
  EMPTY_LIBRARY,
  InMemoryBlobFetchQueueStorePort,
  InMemoryBlobStorePort,
  InMemoryClockPort,
  InMemoryEncounterLogPort,
  InMemoryMetadataRepositoryPort,
  InMemoryNetworkStatusPort,
  addItem,
  createInMemoryTransportPair,
  naiveAcceptPolicy,
  naiveEvictionPolicy,
  naiveOfferPolicy,
  toPriority,
  type BlobPointer,
  type BlobStorePort,
  type DiscoveredPeer,
  type MetadataToken,
  type PeerAddress,
} from "@art-pollinator/core";
import { SwapService } from "../swap/swap-service.js";
import { DeferredBlobQueue, backoffDelayMs } from "./deferred-blob-queue.js";

const HASH_A = "blob-a";
const POINTER_A: BlobPointer = { scheme: "local-filesystem", contentHash: HASH_A };

function makeQueue(
  overrides: {
    remoteSource?: BlobStorePort;
    localStore?: InMemoryBlobStorePort;
    networkStatus?: InMemoryNetworkStatusPort;
    queueStore?: InMemoryBlobFetchQueueStorePort;
    clock?: InMemoryClockPort;
    allowMetered?: boolean;
    backoff?: { baseDelayMs: number; maxDelayMs: number; maxAttempts?: number };
  } = {},
) {
  const localStore = overrides.localStore ?? new InMemoryBlobStorePort();
  const remoteSource = overrides.remoteSource ?? new InMemoryBlobStorePort();
  const networkStatus = overrides.networkStatus ?? new InMemoryNetworkStatusPort();
  const queueStore = overrides.queueStore ?? new InMemoryBlobFetchQueueStorePort();
  const clock = overrides.clock ?? new InMemoryClockPort(0);
  return {
    localStore,
    remoteSource,
    networkStatus,
    queueStore,
    clock,
    create: () =>
      DeferredBlobQueue.create({
        localStore,
        remoteSource,
        networkStatus,
        queueStore,
        clock,
        ...(overrides.allowMetered !== undefined ? { allowMetered: overrides.allowMetered } : {}),
        ...(overrides.backoff !== undefined ? { backoff: overrides.backoff } : {}),
      }),
  };
}

describe("DeferredBlobQueue — Wi-Fi-only gating (AGENTS.md §6)", () => {
  it("does NOT fetch when the connection is not Wi-Fi (e.g. cellular)", async () => {
    const remoteSource = new InMemoryBlobStorePort();
    await remoteSource.put(HASH_A, new Uint8Array([1, 2, 3]));

    const h = makeQueue({ remoteSource });
    h.networkStatus.set({ kind: "cellular", isMetered: false });
    const queue = await h.create();
    await queue.enqueue(HASH_A, POINTER_A);

    const result = await queue.processDue();

    expect(result.skippedIneligibleNetwork).toBe(true);
    expect(result.fetched).toEqual([]);
    await expect(h.localStore.has(HASH_A)).resolves.toBe(false);
    expect(queue.pending().map((e) => e.contentHash)).toEqual([HASH_A]);
  });

  it("does NOT fetch when the connection reports 'none'", async () => {
    const remoteSource = new InMemoryBlobStorePort();
    await remoteSource.put(HASH_A, new Uint8Array([1]));
    const h = makeQueue({ remoteSource });
    // default InMemoryNetworkStatusPort is already "none" — no explicit set() needed.
    const queue = await h.create();
    await queue.enqueue(HASH_A, POINTER_A);

    const result = await queue.processDue();
    expect(result.skippedIneligibleNetwork).toBe(true);
    await expect(h.localStore.has(HASH_A)).resolves.toBe(false);
  });

  it("does NOT fetch on metered Wi-Fi by default (AGENTS.md §6: not on metered by default)", async () => {
    const remoteSource = new InMemoryBlobStorePort();
    await remoteSource.put(HASH_A, new Uint8Array([1]));
    const h = makeQueue({ remoteSource }); // allowMetered not set -> defaults false
    h.networkStatus.set({ kind: "wifi", isMetered: true });
    const queue = await h.create();
    await queue.enqueue(HASH_A, POINTER_A);

    const result = await queue.processDue();
    expect(result.skippedIneligibleNetwork).toBe(true);
    await expect(h.localStore.has(HASH_A)).resolves.toBe(false);
  });

  it("DOES fetch on metered Wi-Fi when allowMetered is explicitly configured", async () => {
    const remoteSource = new InMemoryBlobStorePort();
    const data = new Uint8Array([1, 2, 3]);
    await remoteSource.put(HASH_A, data);
    const h = makeQueue({ remoteSource, allowMetered: true });
    h.networkStatus.set({ kind: "wifi", isMetered: true });
    const queue = await h.create();
    await queue.enqueue(HASH_A, POINTER_A);

    const result = await queue.processDue();
    expect(result.fetched).toEqual([HASH_A]);
    await expect(h.localStore.get(HASH_A)).resolves.toEqual(data);
  });

  it("fetches over unmetered Wi-Fi", async () => {
    const remoteSource = new InMemoryBlobStorePort();
    const data = new Uint8Array([9, 9, 9]);
    await remoteSource.put(HASH_A, data);
    const h = makeQueue({ remoteSource });
    h.networkStatus.set({ kind: "wifi", isMetered: false });
    const queue = await h.create();
    await queue.enqueue(HASH_A, POINTER_A);

    const result = await queue.processDue();
    expect(result.fetched).toEqual([HASH_A]);
    expect(queue.pending()).toEqual([]); // removed from the queue once fetched
    await expect(h.localStore.get(HASH_A)).resolves.toEqual(data);
  });

  it("enqueue is a no-op if the blob is already held locally", async () => {
    const h = makeQueue();
    await h.localStore.put(HASH_A, new Uint8Array([1]));
    const queue = await h.create();
    await queue.enqueue(HASH_A, POINTER_A);
    expect(queue.pending()).toEqual([]);
  });

  it("enqueue is a no-op if already pending", async () => {
    const h = makeQueue();
    const queue = await h.create();
    await queue.enqueue(HASH_A, POINTER_A);
    await queue.enqueue(HASH_A, POINTER_A);
    expect(queue.pending().length).toBe(1);
  });
});

describe("DeferredBlobQueue — retries with backoff on failure", () => {
  it("a fetch that returns nothing (blob not yet available remotely) reschedules with backoff, not immediately", async () => {
    const h = makeQueue({ backoff: { baseDelayMs: 1000, maxDelayMs: 60_000 } });
    h.networkStatus.set({ kind: "wifi", isMetered: false });
    const queue = await h.create();
    await queue.enqueue(HASH_A, POINTER_A); // remoteSource never gets this blob put to it

    const first = await queue.processDue();
    expect(first.fetched).toEqual([]);
    expect(first.failed).toEqual([HASH_A]);

    const pendingAfterFirst = queue.pending()[0]!;
    expect(pendingAfterFirst.attempts).toBe(1);
    expect(pendingAfterFirst.nextAttemptAtEpochMs).toBe(
      backoffDelayMs(1, { baseDelayMs: 1000, maxDelayMs: 60_000 }),
    );

    // Immediately calling processDue again (clock unchanged) must NOT
    // re-attempt — the entry isn't due yet.
    const second = await queue.processDue();
    expect(second.failed).toEqual([]);
    expect(queue.pending()[0]!.attempts).toBe(1); // unchanged — not attempted again

    // Advance the clock past the backoff delay: now it is due again.
    h.clock.advance(backoffDelayMs(1, { baseDelayMs: 1000, maxDelayMs: 60_000 }));
    const third = await queue.processDue();
    expect(third.failed).toEqual([HASH_A]);
    expect(queue.pending()[0]!.attempts).toBe(2);
  });

  it("backoff grows exponentially between attempts, capped at maxDelayMs", () => {
    const config = { baseDelayMs: 1000, maxDelayMs: 5000 };
    expect(backoffDelayMs(1, config)).toBe(1000);
    expect(backoffDelayMs(2, config)).toBe(2000);
    expect(backoffDelayMs(3, config)).toBe(4000);
    expect(backoffDelayMs(4, config)).toBe(5000); // capped: 8000 -> 5000
    expect(backoffDelayMs(5, config)).toBe(5000); // still capped
  });

  it("gives up (drops the entry) after maxAttempts consecutive failures", async () => {
    const h = makeQueue({ backoff: { baseDelayMs: 0, maxDelayMs: 0, maxAttempts: 2 } });
    h.networkStatus.set({ kind: "wifi", isMetered: false });
    const queue = await h.create();
    await queue.enqueue(HASH_A, POINTER_A);

    const first = await queue.processDue();
    expect(first.failed).toEqual([HASH_A]);
    expect(queue.pending().length).toBe(1);

    const second = await queue.processDue();
    expect(second.gaveUp).toEqual([HASH_A]);
    expect(queue.pending()).toEqual([]); // dropped
  });

  it("a remoteSource.get() that throws is treated as a failed attempt, not an unhandled rejection", async () => {
    const throwingRemote: BlobStorePort = {
      put: () => Promise.resolve(),
      get: () => Promise.reject(new Error("network error")),
      has: () => Promise.resolve(false),
      delete: () => Promise.resolve(),
    };
    const h = makeQueue({ remoteSource: throwingRemote });
    h.networkStatus.set({ kind: "wifi", isMetered: false });
    const queue = await h.create();
    await queue.enqueue(HASH_A, POINTER_A);

    const result = await queue.processDue();
    expect(result.failed).toEqual([HASH_A]);
    expect(result.fetched).toEqual([]);
  });
});

describe("DeferredBlobQueue — survives restart (issue #41 DoD)", () => {
  it("a second DeferredBlobQueue reading the same persisted queueStore sees the first queue's pending entries", async () => {
    const sharedQueueStore = new InMemoryBlobFetchQueueStorePort();
    const clock = new InMemoryClockPort(0);

    const first = await DeferredBlobQueue.create({
      localStore: new InMemoryBlobStorePort(),
      remoteSource: new InMemoryBlobStorePort(), // empty: enqueue only, never fetched
      networkStatus: new InMemoryNetworkStatusPort({ kind: "none", isMetered: false }),
      queueStore: sharedQueueStore,
      clock,
    });
    await first.enqueue(HASH_A, POINTER_A);
    expect(first.pending().length).toBe(1);

    // "Restart": a brand new DeferredBlobQueue instance, sharing nothing
    // with `first` except the same underlying persistence (`sharedQueueStore`)
    // — modelling a fresh process reading the same persisted state back.
    const second = await DeferredBlobQueue.create({
      localStore: new InMemoryBlobStorePort(),
      remoteSource: new InMemoryBlobStorePort(),
      networkStatus: new InMemoryNetworkStatusPort({ kind: "none", isMetered: false }),
      queueStore: sharedQueueStore,
      clock,
    });

    expect(second.pending()).toEqual(first.pending());
    expect(second.pending()[0]!.contentHash).toBe(HASH_A);
  });

  it("state also survives a restart after a failed attempt (attempts/backoff persisted, not reset)", async () => {
    const sharedQueueStore = new InMemoryBlobFetchQueueStorePort();
    const clock = new InMemoryClockPort(0);
    const remoteSource = new InMemoryBlobStorePort(); // never has HASH_A -> every attempt fails

    const first = await DeferredBlobQueue.create({
      localStore: new InMemoryBlobStorePort(),
      remoteSource,
      networkStatus: new InMemoryNetworkStatusPort({ kind: "wifi", isMetered: false }),
      queueStore: sharedQueueStore,
      clock,
      backoff: { baseDelayMs: 1000, maxDelayMs: 60_000 },
    });
    await first.enqueue(HASH_A, POINTER_A);
    await first.processDue(); // fails once, attempts -> 1

    const second = await DeferredBlobQueue.create({
      localStore: new InMemoryBlobStorePort(),
      remoteSource,
      networkStatus: new InMemoryNetworkStatusPort({ kind: "wifi", isMetered: false }),
      queueStore: sharedQueueStore,
      clock,
      backoff: { baseDelayMs: 1000, maxDelayMs: 60_000 },
    });

    expect(second.pending()[0]!.attempts).toBe(1);
    expect(second.pending()[0]!.nextAttemptAtEpochMs).toBe(
      first.pending()[0]?.nextAttemptAtEpochMs,
    );
  });
});

function token(contentHash: string): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "A piece.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
}

describe("DeferredBlobQueue — never blocks a metadata swap (issue #41 DoD)", () => {
  it("SwapService.swap() resolves even while this queue's processDue() is still stuck on a stalled remote fetch", async () => {
    // A remoteSource whose get() never resolves — the worst case for "does
    // a stalled blob fetch block anything else."
    const stalledRemote: BlobStorePort = {
      put: () => Promise.resolve(),
      get: () => new Promise<Uint8Array | undefined>(() => {}), // never settles
      has: () => Promise.resolve(false),
      delete: () => Promise.resolve(),
    };
    const h = makeQueue({ remoteSource: stalledRemote });
    h.networkStatus.set({ kind: "wifi", isMetered: false });
    const queue = await h.create();
    await queue.enqueue(HASH_A, POINTER_A);

    let queueSettled = false;
    // Deliberately not awaited — this is the "some background scheduler is
    // driving the queue independently" case.
    void queue.processDue().then(() => {
      queueSettled = true;
    });

    // Meanwhile, a completely independent metadata swap runs to completion.
    const addressA: PeerAddress = { id: "device-a" };
    const addressB: PeerAddress = { id: "device-b" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(addressA, addressB);

    const libraryA = addItem(EMPTY_LIBRARY, token("alpha"), toPriority(0));
    if (!libraryA.ok) throw new Error("fixture setup failed");
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

    const peerB: DiscoveredPeer = { address: addressB, kind: "person" };
    const peerA: DiscoveredPeer = { address: addressA, kind: "person" };

    const [outcomeA, outcomeB] = await Promise.all([
      serviceA.swap(peerB, libraryA.library),
      serviceB.swap(peerA, libraryB),
    ]);

    expect(outcomeA.state.phase).toBe("completed");
    expect(outcomeB.state.phase).toBe("completed");
    // The swap finished; the stalled blob fetch, by construction, never will.
    expect(queueSettled).toBe(false);
  });
});
