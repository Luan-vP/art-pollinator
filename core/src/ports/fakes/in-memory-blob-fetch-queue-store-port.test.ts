import { describe, expect, it } from "vitest";
import { InMemoryBlobFetchQueueStorePort } from "./in-memory-blob-fetch-queue-store-port.js";
import type { QueuedBlobFetch } from "../blob-fetch-queue-store-port.js";

const entry: QueuedBlobFetch = {
  contentHash: "a",
  blobPointer: { scheme: "local-filesystem", contentHash: "a" },
  attempts: 0,
  nextAttemptAtEpochMs: 0,
  enqueuedAtEpochMs: 0,
};

describe("InMemoryBlobFetchQueueStorePort", () => {
  it("a fresh instance loads as empty", async () => {
    const store = new InMemoryBlobFetchQueueStorePort();
    await expect(store.load()).resolves.toEqual([]);
  });

  it("saveAll then load round-trips the exact entries", async () => {
    const store = new InMemoryBlobFetchQueueStorePort();
    await store.saveAll([entry]);
    await expect(store.load()).resolves.toEqual([entry]);
  });

  it("saveAll replaces the entire snapshot, not a merge", async () => {
    const store = new InMemoryBlobFetchQueueStorePort();
    await store.saveAll([entry]);
    await store.saveAll([]);
    await expect(store.load()).resolves.toEqual([]);
  });

  it("a second instance does not see a first instance's state (no shared backing)", async () => {
    const first = new InMemoryBlobFetchQueueStorePort();
    await first.saveAll([entry]);

    const second = new InMemoryBlobFetchQueueStorePort();
    await expect(second.load()).resolves.toEqual([]);
  });

  it("the SAME instance handed to a new consumer preserves state — this is how a 'simulated restart' is modelled", async () => {
    const store = new InMemoryBlobFetchQueueStorePort();
    await store.saveAll([entry]);

    // A "new DeferredBlobQueue after restart" is modelled as a fresh reader
    // of the same store instance, not a fresh store.
    await expect(store.load()).resolves.toEqual([entry]);
  });
});
