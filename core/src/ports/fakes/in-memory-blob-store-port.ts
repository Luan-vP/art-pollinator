/**
 * InMemoryBlobStorePort — a `BlobStorePort` fake backed by a plain `Map`,
 * keyed by content hash (SPEC.md §3.2: blobs always addressed by content
 * hash regardless of storage backend). Zero I/O: bytes live only in process
 * memory (issue #18, IMPLEMENTATION.md Phase 1a item 18).
 */
import type { BlobStorePort } from "../blob-store-port.js";

export class InMemoryBlobStorePort implements BlobStorePort {
  private readonly byContentHash = new Map<string, Uint8Array>();

  put(contentHash: string, data: Uint8Array): Promise<void> {
    this.byContentHash.set(contentHash, data);
    return Promise.resolve();
  }

  get(contentHash: string): Promise<Uint8Array | undefined> {
    return Promise.resolve(this.byContentHash.get(contentHash));
  }

  has(contentHash: string): Promise<boolean> {
    return Promise.resolve(this.byContentHash.has(contentHash));
  }

  delete(contentHash: string): Promise<void> {
    this.byContentHash.delete(contentHash);
    return Promise.resolve();
  }
}
