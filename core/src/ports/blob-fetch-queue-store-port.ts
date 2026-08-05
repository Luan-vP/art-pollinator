/**
 * BlobFetchQueueStorePort — persistence for the deferred blob queue's
 * pending-fetch state (issue #41, `app/src/blob/deferred-blob-queue.ts`).
 *
 * ## Design: a dedicated small persistence port, not piggybacked on SQLite
 *
 * Issue #41 leaves this an open call ("you can piggyback on the existing
 * SQLite adapter pattern or keep it simpler with a dedicated small
 * persistence port; your call, document it"). Decision: a dedicated port.
 * `adapters/metadata-repository-sqlite` is explicitly scoped to the Node
 * server target (`node:sqlite` — see that package's README), so it cannot
 * back a mobile client's deferred blob queue without a second, RN-specific
 * repository adapter that does not exist yet (the mobile composition root
 * already carries this same gap for `MetadataRepositoryPort` itself — see
 * `clients/mobile/src/composition/composition-root.native.ts`'s wiring,
 * which uses the in-memory fake for exactly this reason). A queue entry
 * (content hash, blob pointer, attempt count, next-attempt time) is also a
 * much smaller, flatter shape than a full `MetadataToken` repository — a
 * dedicated port with one load/save-all round trip is enough, and keeps
 * `app/`'s queue composable with *any* persistence backend (in-memory fake
 * for tests, this port's own real adapters — `adapters/blob-store-filesystem`
 * ships a JSON-file-backed one for Node targets, issue #40/#41 — later, a
 * mobile-specific one) without pulling in SQLite's heavier surface.
 *
 * ## Design: load/saveAll, not per-entry CRUD
 *
 * The deferred blob queue's whole working set is small (bounded by how many
 * distinct blobs a 10-slot library can reference) and it already holds the
 * canonical in-memory copy while running — this port only needs to answer
 * "what was pending last time" (`load`, called once at start-up) and
 * "here is the complete current state, persist it" (`saveAll`, called after
 * every enqueue/attempt/completion) rather than tracking incremental deltas
 * itself. This keeps the port trivial to implement correctly (a real
 * adapter can just serialise the whole array) and trivial to fake.
 */
import type { BlobPointer } from "../metadata/metadata-token.js";

/** One blob still pending local fetch. */
export interface QueuedBlobFetch {
  readonly contentHash: string;
  readonly blobPointer: BlobPointer;
  /** Number of fetch attempts made so far (0 before the first attempt). */
  readonly attempts: number;
  /** Epoch ms (per `ClockPort`) before which no further attempt should be made. */
  readonly nextAttemptAtEpochMs: number;
  /** Epoch ms this entry was first enqueued — informational, not used for scheduling. */
  readonly enqueuedAtEpochMs: number;
}

export interface BlobFetchQueueStorePort {
  /** Every entry persisted from a previous session, in no particular order. */
  load(): Promise<readonly QueuedBlobFetch[]>;

  /** Replace the entire persisted queue state with `entries` — the queue's complete current snapshot, not a delta. */
  saveAll(entries: readonly QueuedBlobFetch[]): Promise<void>;
}
