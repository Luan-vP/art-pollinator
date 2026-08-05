/**
 * FilesystemBlobStorePort — the real `BlobStorePort` implementation backed
 * by the local filesystem (issue #40, IMPLEMENTATION.md Phase 1b item 40).
 * SPEC.md §3.2: "Phase 1 stores blobs on the local filesystem only."
 *
 * ## Layout: content-addressed, sharded by hash prefix
 *
 * A blob with content hash `h` is stored at `<baseDir>/<h[0:2]>/<h>` —
 * e.g. content hash `abcdef...` lands at `<baseDir>/ab/abcdef...`. The
 * two-character shard prefix keeps any single directory from accumulating
 * one entry per blob ever stored (a real concern once a node's library
 * grows past a handful of items — many filesystems degrade well before
 * tens of thousands of entries in one directory); 256 possible shards
 * (`00`-`ff`) is more than enough for the slot counts AGENTS.md §6 fixes
 * (10 slots on a peer, larger-but-still-bounded on a node — SPEC.md §4).
 *
 * ## Integrity verification on fetch (issue #40's own DoD bullet)
 *
 * `get` recomputes the SHA-256 of the bytes actually read off disk using
 * `@art-pollinator/core`'s existing `sha256Hex` (the same hashing primitive
 * `contentHash` itself is defined in terms of — SPEC.md §3.2, issue #23) and
 * compares it against the content hash the caller asked for. A mismatch
 * (bit rot, a manually-truncated file, tampering, anything that changed the
 * bytes after `put` wrote them) throws rather than silently returning
 * corrupted data — "reject on mismatch," not "reject at write time," since
 * `put`'s own bytes are exactly what the caller handed it and could not
 * yet have diverged from `contentHash` unless the caller passed a wrong
 * hash to begin with (a separate, not-this-adapter's-job caller bug).
 *
 * ## Design: throws from `get`, rather than returning `undefined`
 *
 * `BlobStorePort.get` returns `Promise<Uint8Array | undefined>`; that
 * `undefined` case means "not held locally," which is a different, benign
 * condition from "held locally, but corrupted." Returning `undefined` for
 * both would silently mask real data corruption as an ordinary cache miss —
 * exactly what issue #40 asks this adapter to detect and reject, not hide.
 * Any async function may reject regardless of its resolved-value type, so
 * this is a valid (if not exhaustively documented on the interface itself)
 * outcome for a `Promise`-returning port method; see this package's README
 * for the full reasoning and the alternative considered (a richer result
 * type on the port itself, rejected as an interface change every other
 * `BlobStorePort` implementation — including the in-memory fake — would
 * have had to adopt for a failure mode only a real backing store can ever
 * produce).
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BlobStorePort } from "@art-pollinator/core";
import { sha256Hex } from "@art-pollinator/core";

export class BlobIntegrityError extends Error {
  constructor(
    public readonly contentHash: string,
    public readonly actualHash: string,
  ) {
    super(
      `FilesystemBlobStorePort: blob integrity check failed for content hash "${contentHash}" ` +
        `(bytes on disk hash to "${actualHash}" instead) — the stored file is corrupted or was tampered with.`,
    );
    this.name = "BlobIntegrityError";
  }
}

export interface FilesystemBlobStorePortOptions {
  /** Root directory blobs are stored under. Created (recursively) on first use if it does not yet exist. */
  readonly baseDir: string;
}

function shardDir(baseDir: string, contentHash: string): string {
  const prefix = contentHash.slice(0, 2) || "00"; // "00" fallback: only reachable for a pathological empty-string hash, never a real SHA-256 hex digest.
  return join(baseDir, prefix);
}

function blobPath(baseDir: string, contentHash: string): string {
  return join(shardDir(baseDir, contentHash), contentHash);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export class FilesystemBlobStorePort implements BlobStorePort {
  private readonly baseDir: string;

  constructor(options: FilesystemBlobStorePortOptions) {
    this.baseDir = options.baseDir;
  }

  async put(contentHash: string, data: Uint8Array): Promise<void> {
    const dir = shardDir(this.baseDir, contentHash);
    await mkdir(dir, { recursive: true });
    await writeFile(blobPath(this.baseDir, contentHash), data);
  }

  /**
   * Fetch a blob by content hash. Returns `undefined` if no file exists at
   * the expected path. Throws {@link BlobIntegrityError} if a file exists
   * but its bytes do not hash to `contentHash` (see this file's doc
   * comment).
   */
  async get(contentHash: string): Promise<Uint8Array | undefined> {
    const path = blobPath(this.baseDir, contentHash);
    if (!(await pathExists(path))) {
      return undefined;
    }
    const buffer = await readFile(path);
    const bytes = new Uint8Array(buffer);
    const actualHash = sha256Hex(bytes);
    if (actualHash !== contentHash) {
      throw new BlobIntegrityError(contentHash, actualHash);
    }
    return bytes;
  }

  async has(contentHash: string): Promise<boolean> {
    return pathExists(blobPath(this.baseDir, contentHash));
  }

  async delete(contentHash: string): Promise<void> {
    const path = blobPath(this.baseDir, contentHash);
    await rm(path, { force: true });
  }
}
