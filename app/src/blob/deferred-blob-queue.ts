/**
 * DeferredBlobQueue — the deferred blob fetch queue (issue #41,
 * IMPLEMENTATION.md Phase 1b item 41). AGENTS.md §6 (fixed parameters):
 * "Blob fetching: Wi-Fi only; never over BLE; not on metered connections by
 * default." SPEC.md §3.1/§3.2: a `MetadataToken`'s blob (the thumbnail /
 * full asset) is a *deferred* blob, "fetched later over a high-bandwidth
 * link" — never part of the metadata-gossip swap itself.
 *
 * Lives in `app/` — this is orchestration/use-case logic (AGENTS.md §2
 * rule 2: "app/ — use cases ... Depends on core only"), not pure domain
 * (it drives I/O through ports, sequences retries, and reads a clock — none
 * of which `core` is allowed to do) and not adapter-specific (it is
 * composable with *any* `BlobStorePort` + `NetworkStatusPort` +
 * `BlobFetchQueueStorePort` implementation, exactly the task's own framing).
 *
 * ## Design: two `BlobStorePort`s, not a bespoke "blob fetcher" abstraction
 *
 * `BlobStorePort`'s shape (put/get/has/delete by content hash) is already
 * general enough to represent *either* "the local on-device store" *or* "a
 * remote source reachable over the network" — a future HTTP-backed
 * `BlobStorePort` adapter fetching from a stationary node is exactly as
 * valid an implementation of this port as `adapters/blob-store-filesystem`'s
 * local one. Rather than invent a second, blob-fetching-specific port
 * (`BlobFetcherPort` or similar) that would duplicate `BlobStorePort`'s
 * `get`, this queue takes two `BlobStorePort`s — `remoteSource` (where
 * bytes are fetched *from*) and `localStore` (where they're written *to*
 * once fetched) — and pulls from one into the other. This is the literal
 * reading of the task's "composable with any `BlobStorePort`" framing, and
 * means this queue needs no new domain port at all beyond
 * `NetworkStatusPort`/`BlobFetchQueueStorePort` (issue #41's own two new
 * ports). No real `remoteSource` adapter exists yet in this batch — wiring
 * one (e.g. over the HTTP transport, issue #43) is separate, later work;
 * this queue's own tests use a fake `BlobStorePort` standing in for it.
 *
 * ## Design: never blocks a metadata swap
 *
 * `SwapService` (`./swap/swap-service.ts`) never references this queue, and
 * this queue never references `SwapService` — the two are fully
 * independent objects with no shared call path. A metadata swap completes
 * (or fails) purely as a function of `TransportPort`/`MetadataRepositoryPort`/
 * the policies; nothing here can make it wait. `processDue()` (this queue's
 * one long-running operation — it may await a real network fetch) is meant
 * to be driven by something outside a swap entirely, e.g. a
 * `SchedulerPort`-scheduled recurring task in a composition root, once a
 * real `remoteSource` exists. `deferred-blob-queue.test.ts`'s
 * "never blocks a metadata swap" case demonstrates this empirically, not
 * just by code inspection: it constructs a `remoteSource` whose `get()`
 * never resolves, starts `processDue()` without awaiting it, then runs a
 * complete `SwapService.swap()` to its own resolution — proving the swap's
 * promise settles regardless of the stalled fetch still in flight.
 *
 * ## Design: network eligibility gates the whole pass, not per-item
 *
 * `NetworkStatusPort.current()` reflects one connection for the whole
 * device at a given moment — there is no such thing as "this blob may
 * fetch over Wi-Fi but that one may not" at a single point in time. So
 * `processDue()` checks eligibility once per call: if the connection is not
 * Wi-Fi, or is metered and `allowMetered` is not set, **no** due entry is
 * attempted this pass — every one stays exactly as pending as it was
 * before, with no attempt-count increment (this is "excluded," not
 * "failed": AGENTS.md §6 draws that same distinction — "not on metered
 * connections by default," a policy exclusion, is not the same condition
 * as a fetch that was attempted and failed).
 */
import type {
  BlobFetchQueueStorePort,
  BlobPointer,
  BlobStorePort,
  ClockPort,
  NetworkStatusPort,
  QueuedBlobFetch,
} from "@art-pollinator/core";

export interface BackoffConfig {
  /** Delay before the first retry, in ms, after one failed attempt. */
  readonly baseDelayMs: number;
  /** Delay never exceeds this, regardless of how many attempts have failed. */
  readonly maxDelayMs: number;
  /** Give up (drop the entry) after this many failed attempts. `undefined` — the default — retries forever. */
  readonly maxAttempts?: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseDelayMs: 5_000,
  maxDelayMs: 5 * 60_000,
};

/** Exponential backoff, capped at `config.maxDelayMs`: `baseDelayMs * 2^(attempts - 1)`. */
export function backoffDelayMs(attempts: number, config: BackoffConfig = DEFAULT_BACKOFF): number {
  if (attempts <= 0) return 0;
  const delay = config.baseDelayMs * 2 ** (attempts - 1);
  return Math.min(delay, config.maxDelayMs);
}

export interface DeferredBlobQueueDeps {
  /** The local on-device store a fetched blob is written into. */
  readonly localStore: BlobStorePort;
  /** Where blobs are fetched *from* — see this file's doc comment on why this is also a `BlobStorePort`. */
  readonly remoteSource: BlobStorePort;
  readonly networkStatus: NetworkStatusPort;
  readonly queueStore: BlobFetchQueueStorePort;
  readonly clock: ClockPort;
  /** Allow fetching on a metered connection. Defaults to `false` — AGENTS.md §6: "not on metered connections by default." */
  readonly allowMetered?: boolean;
  readonly backoff?: BackoffConfig;
}

/** Whether `current()`'s reported connection is eligible to start a blob fetch right now, per AGENTS.md §6. */
function isEligibleToFetch(
  status: { readonly kind: string; readonly isMetered: boolean },
  allowMetered: boolean,
): boolean {
  if (status.kind !== "wifi") return false; // never BLE, never cellular/ethernet/none/unknown — Wi-Fi only.
  if (status.isMetered && !allowMetered) return false;
  return true;
}

export interface ProcessDueResult {
  /** Content hashes successfully fetched and written to `localStore` this pass. */
  readonly fetched: readonly string[];
  /** Content hashes that failed this pass and were rescheduled with backoff. */
  readonly failed: readonly string[];
  /** Content hashes that exhausted `backoff.maxAttempts` and were dropped from the queue. */
  readonly gaveUp: readonly string[];
  /** `true` if this pass attempted nothing because the current connection is not eligible (not Wi-Fi, or metered without `allowMetered`). */
  readonly skippedIneligibleNetwork: boolean;
}

/**
 * Orchestrates deferred blob fetching: enqueue blobs a `MetadataToken`
 * points at, and periodically call {@link processDue} (driven by something
 * outside this class — a scheduler, a manual trigger in tests, etc) to
 * attempt fetching whatever is due, gated on network eligibility, with
 * backoff on failure, surviving restart via `queueStore`.
 */
export class DeferredBlobQueue {
  private entries: QueuedBlobFetch[];

  private constructor(
    private readonly deps: DeferredBlobQueueDeps,
    initialEntries: readonly QueuedBlobFetch[],
  ) {
    this.entries = [...initialEntries];
  }

  /** Construct a queue, loading any previously-persisted entries from `deps.queueStore` (issue #41: "survives restart"). */
  static async create(deps: DeferredBlobQueueDeps): Promise<DeferredBlobQueue> {
    const persisted = await deps.queueStore.load();
    return new DeferredBlobQueue(deps, persisted);
  }

  /** Every entry currently pending (not yet fetched), as a read-only snapshot. */
  pending(): readonly QueuedBlobFetch[] {
    return [...this.entries];
  }

  /**
   * Enqueue a blob for later fetch. A no-op if already pending, or already
   * held in `localStore` (nothing to fetch). Persists immediately.
   */
  async enqueue(contentHash: string, blobPointer: BlobPointer): Promise<void> {
    if (this.entries.some((e) => e.contentHash === contentHash)) return;
    if (await this.deps.localStore.has(contentHash)) return;

    const now = this.deps.clock.now();
    this.entries.push({
      contentHash,
      blobPointer,
      attempts: 0,
      nextAttemptAtEpochMs: now,
      enqueuedAtEpochMs: now,
    });
    await this.persist();
  }

  /**
   * Attempt every entry currently due (`nextAttemptAtEpochMs <= now`),
   * subject to network eligibility (see this file's doc comment on why
   * eligibility gates the whole pass, not per-item). Safe to call
   * repeatedly (e.g. from a recurring `SchedulerPort` task) — a call with
   * nothing due, or with an ineligible connection, is a cheap no-op.
   */
  async processDue(): Promise<ProcessDueResult> {
    const now = this.deps.clock.now();
    const status = await this.deps.networkStatus.current();
    const allowMetered = this.deps.allowMetered ?? false;

    if (!isEligibleToFetch(status, allowMetered)) {
      return { fetched: [], failed: [], gaveUp: [], skippedIneligibleNetwork: true };
    }

    const backoff = this.deps.backoff ?? DEFAULT_BACKOFF;
    const fetched: string[] = [];
    const failed: string[] = [];
    const gaveUp: string[] = [];
    const remaining: QueuedBlobFetch[] = [];

    for (const entry of this.entries) {
      if (entry.nextAttemptAtEpochMs > now) {
        remaining.push(entry); // not due yet this pass
        continue;
      }

      let bytes: Uint8Array | undefined;
      try {
        bytes = await this.deps.remoteSource.get(entry.contentHash);
      } catch {
        bytes = undefined; // a remote fetch error is just another failed attempt, not a crash of the whole pass.
      }

      if (bytes !== undefined) {
        await this.deps.localStore.put(entry.contentHash, bytes);
        fetched.push(entry.contentHash);
        continue; // fetched: drop from the queue, nothing to re-add to `remaining`.
      }

      const attempts = entry.attempts + 1;
      if (backoff.maxAttempts !== undefined && attempts >= backoff.maxAttempts) {
        gaveUp.push(entry.contentHash);
        continue; // exhausted retries: drop from the queue.
      }
      failed.push(entry.contentHash);
      remaining.push({
        ...entry,
        attempts,
        nextAttemptAtEpochMs: now + backoffDelayMs(attempts, backoff),
      });
    }

    this.entries = remaining;
    await this.persist();

    return { fetched, failed, gaveUp, skippedIneligibleNetwork: false };
  }

  private async persist(): Promise<void> {
    await this.deps.queueStore.saveAll(this.entries);
  }
}
