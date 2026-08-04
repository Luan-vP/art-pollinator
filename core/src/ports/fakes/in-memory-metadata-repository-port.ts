/**
 * InMemoryMetadataRepositoryPort — a `MetadataRepositoryPort` fake backed by
 * a plain `Map`, keyed by content hash (matching how `Library` already keys
 * items — see `../../library/library.ts`). Zero I/O: no filesystem, no
 * database (issue #18, IMPLEMENTATION.md Phase 1a item 18).
 */
import type { MetadataToken } from "../../metadata/metadata-token.js";
import type { MetadataRepositoryPort } from "../metadata-repository-port.js";

export class InMemoryMetadataRepositoryPort implements MetadataRepositoryPort {
  private readonly byContentHash = new Map<string, MetadataToken>();

  save(token: MetadataToken): Promise<void> {
    this.byContentHash.set(token.contentHash, token);
    return Promise.resolve();
  }

  findByContentHash(contentHash: string): Promise<MetadataToken | undefined> {
    return Promise.resolve(this.byContentHash.get(contentHash));
  }

  delete(contentHash: string): Promise<void> {
    this.byContentHash.delete(contentHash);
    return Promise.resolve();
  }

  listAll(): Promise<readonly MetadataToken[]> {
    return Promise.resolve([...this.byContentHash.values()]);
  }
}
