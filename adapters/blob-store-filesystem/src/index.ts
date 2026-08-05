/**
 * `@art-pollinator/blob-store-filesystem` — real local-filesystem adapters:
 * `FilesystemBlobStorePort` (`BlobStorePort`, issue #40) and
 * `FileBlobFetchQueueStorePort` (`BlobFetchQueueStorePort`, issue #41).
 * Depends on `core`, never depended on by it (AGENTS.md §2). Real I/O
 * (`node:fs`) lives here, never in `core`. Scoped to Node-capable targets
 * (SPEC.md §8's node-server target, or a Node-based dev/test harness) —
 * see `filesystem-blob-store.ts`'s and `file-blob-fetch-queue-store.ts`'s
 * doc comments for why this is not yet wired into the mobile client's
 * composition root.
 */
export * from "./filesystem-blob-store.js";
export * from "./file-blob-fetch-queue-store.js";
