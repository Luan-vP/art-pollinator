/**
 * InMemoryBlobFetchQueueStorePort — a `BlobFetchQueueStorePort` fake.
 *
 * ## Simulating a restart without simulating a process restart
 *
 * A genuinely fresh `InMemoryBlobFetchQueueStorePort` instance holds no
 * state — same as any other in-memory fake here. What proves "queue state
 * survives a simulated restart" (issue #41's explicit test requirement) is
 * constructing a **second, independent `DeferredBlobQueue`** against the
 * **same** `InMemoryBlobFetchQueueStorePort` instance the first one wrote
 * to: the backing `entries` array below plays the role "the disk" plays for
 * a real adapter — it outlives any one `DeferredBlobQueue` object, so a new
 * queue instance reading from it sees exactly what the previous instance
 * last persisted, without either instance sharing any other state. See
 * `app/src/blob/deferred-blob-queue.test.ts`'s restart-survival case.
 */
import type { BlobFetchQueueStorePort, QueuedBlobFetch } from "../blob-fetch-queue-store-port.js";

export class InMemoryBlobFetchQueueStorePort implements BlobFetchQueueStorePort {
  private entries: readonly QueuedBlobFetch[] = [];

  load(): Promise<readonly QueuedBlobFetch[]> {
    return Promise.resolve(this.entries);
  }

  saveAll(entries: readonly QueuedBlobFetch[]): Promise<void> {
    this.entries = entries;
    return Promise.resolve();
  }
}
