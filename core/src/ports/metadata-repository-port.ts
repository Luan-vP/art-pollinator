/**
 * MetadataRepositoryPort — persist and query `MetadataToken`s.
 *
 * Shaped around content-hash identity (matching how `Library` already keys
 * items, see `../library/library.ts`) rather than around any particular
 * storage engine's query model — a later SQLite adapter (issue #25) and the
 * in-memory fake (issue #18) both implement exactly this, and both must
 * pass the same contract suite (issue #26, AGENTS.md §2 rule 5).
 */

import type { MetadataToken } from "../metadata/metadata-token.js";

export interface MetadataRepositoryPort {
  /** Persist a token. Overwrites any existing token with the same content hash. */
  save(token: MetadataToken): Promise<void>;

  /** Look up a token by content hash, or `undefined` if not held. */
  findByContentHash(contentHash: string): Promise<MetadataToken | undefined>;

  /** Remove a token by content hash. A no-op if not held. */
  delete(contentHash: string): Promise<void>;

  /** All tokens currently persisted. */
  listAll(): Promise<readonly MetadataToken[]>;
}
