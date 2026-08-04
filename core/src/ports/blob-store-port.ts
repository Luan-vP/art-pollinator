/**
 * BlobStorePort — store and fetch the heavy asset a `MetadataToken` points at.
 *
 * SPEC.md §3.2: "Blobs are always addressed by content hash, regardless of
 * storage location." This port's shape follows directly from that: every
 * method takes/returns a content hash, never a filesystem path or URL, so a
 * local-filesystem adapter (issue #40, Phase 1 per SPEC.md §3.2) and a
 * future cloud-bucket adapter can implement the identical interface without
 * either leaking its storage model into `core` (AGENTS.md §2 rule 3).
 */
export interface BlobStorePort {
  /** Store a blob's bytes under its content hash. */
  put(contentHash: string, data: Uint8Array): Promise<void>;

  /** Fetch a blob's bytes by content hash, or `undefined` if not held locally. */
  get(contentHash: string): Promise<Uint8Array | undefined>;

  /** `true` if the blob is already held locally, without fetching it. */
  has(contentHash: string): Promise<boolean>;

  /** Remove a locally-held blob. A no-op if not held. */
  delete(contentHash: string): Promise<void>;
}
