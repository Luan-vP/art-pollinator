/**
 * FileBlobFetchQueueStorePort — a `BlobFetchQueueStorePort` implementation
 * backed by a single JSON file on disk (issue #41's "survives restart" DoD
 * bullet, for a real, non-simulated restart on a Node-capable target).
 *
 * See `@art-pollinator/core`'s `BlobFetchQueueStorePort` doc comment for why
 * this is a dedicated small port rather than piggybacked on
 * `adapters/metadata-repository-sqlite` (that package is scoped to the Node
 * server target; the mobile client currently has no real
 * `MetadataRepositoryPort` adapter of its own either — see
 * `clients/mobile/src/composition/composition-root.native.ts`'s wiring —
 * so tying the queue's persistence to SQLite specifically would not help
 * the client target this queue actually ships on first). This adapter lives
 * in the same package as `FilesystemBlobStorePort` because both are "plain
 * `node:fs`, Node-only" storage adapters (the same scoping
 * `adapters/metadata-repository-sqlite`'s README already documents for its
 * own Node-only choice) — not because the two ports are related in any
 * other way.
 *
 * ## Format: one JSON array, rewritten whole on every `saveAll`
 *
 * Matches `BlobFetchQueueStorePort`'s own "load/saveAll, not per-entry CRUD"
 * design (see that port's doc comment): the entire queue snapshot is small,
 * so there's no need for anything richer than
 * `JSON.stringify(entries)`/`JSON.parse`. Writes go through a temp file plus
 * atomic rename so a process crash mid-write can never leave a
 * half-written, unparseable queue file behind for the next `load()` to trip
 * over.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BlobFetchQueueStorePort, QueuedBlobFetch } from "@art-pollinator/core";

export interface FileBlobFetchQueueStorePortOptions {
  /** Path to the JSON file the queue's state is persisted to. Parent directory is created if it does not yet exist. */
  readonly filePath: string;
}

export class FileBlobFetchQueueStorePort implements BlobFetchQueueStorePort {
  private readonly filePath: string;

  constructor(options: FileBlobFetchQueueStorePortOptions) {
    this.filePath = options.filePath;
  }

  async load(): Promise<readonly QueuedBlobFetch[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return []; // no file yet (first run) — an empty queue, not an error.
    }
    if (raw.trim() === "") {
      return [];
    }
    return JSON.parse(raw) as readonly QueuedBlobFetch[];
  }

  async saveAll(entries: readonly QueuedBlobFetch[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp-${String(process.pid)}-${String(Date.now())}`;
    await writeFile(tempPath, JSON.stringify(entries), "utf8");
    await rename(tempPath, this.filePath); // atomic on the same filesystem — see this file's doc comment.
  }
}
