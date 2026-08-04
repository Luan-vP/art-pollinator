/**
 * SqliteMetadataRepository — the real `MetadataRepositoryPort`
 * implementation backed by SQLite (issue #25).
 *
 * ## Binding choice: `node:sqlite`, not `better-sqlite3`
 *
 * Node's built-in `node:sqlite` module (stable enough for this adapter as
 * of the Node version this monorepo targets here — verified with
 * `node --version` / a smoke test before committing to it, per this
 * issue's own instruction) is used instead of the `better-sqlite3` npm
 * package. Both expose a synchronous, ergonomic API
 * (`DatabaseSync`/`Database`, prepared statements with `.run`/`.get`/`.all`)
 * that maps cleanly onto this port. `node:sqlite` wins because:
 *
 * - **Zero added dependency.** `better-sqlite3` ships a native addon that
 *   must be compiled (node-gyp) or fetched as a prebuilt binary per
 *   platform/architecture/Node ABI — a real supply-chain and CI surface for
 *   a monorepo that otherwise keeps `core` dependency-free and adapters
 *   minimal. `node:sqlite` needs nothing beyond the Node binary already
 *   running this code.
 * - **It is a real fit for this project's runtime.** SPEC.md §8 / AGENTS.md
 *   §5: the node-server target runs on plain Node — exactly where
 *   `node:sqlite` lives. (It does not help React Native directly — that
 *   target would need its own storage adapter regardless of this choice,
 *   same as any other Node-only built-in.)
 *
 * The trade-off, noted rather than hidden: `node:sqlite` is still marked
 * experimental upstream (it logs an `ExperimentalWarning` on first use) and
 * requires a reasonably recent Node (this package's `engines.node` records
 * the floor verified against). If a future target needs a Node version
 * where `node:sqlite` is unavailable or unstable, swap the small surface
 * this file touches (`DatabaseSync`, `.exec`, `.prepare().run/.get/.all`)
 * for `better-sqlite3`'s near-identical API — the port and the contract
 * suite this adapter passes do not change either way.
 *
 * ## Schema: flattened columns, not a JSON blob
 *
 * Each `MetadataToken` field gets its own column rather than one
 * `raw_json TEXT` column holding `JSON.stringify(token)`. A blob column
 * would dodge needing schema migrations for token shape changes, but would
 * also make `runMigrations` (issue #27) nothing more than theatre — this
 * adapter's whole point is to demonstrate real, verifiable migrations
 * (`migrations.ts`), and `MetadataToken` has already grown once for real
 * (issues #57/#58 added `signature`/`signerPublicKey` on top of the
 * original fields) — precisely the kind of change flattened columns force
 * a genuine migration to handle, and a blob column would silently absorb.
 *
 * `blobPointer` is flattened to its one current field
 * (`blob_pointer_hash`) rather than given a satellite table — `BlobPointer`
 * is a single-field placeholder today (`metadata-token.ts`'s doc comment:
 * "the real ... blob pointer design is issue #39"). When that type grows,
 * the migration that adds columns/tables for it is the correct place to
 * revisit this, not a JSON-blob workaround now.
 */
import type { MetadataRepositoryPort, MetadataToken } from "@art-pollinator/core";
// `./node-sqlite.js` re-exports `node:sqlite`'s `DatabaseSync` — see that
// file's header comment for why this isn't a direct `node:sqlite` import.
import { DatabaseSync } from "./node-sqlite.js";
import { runMigrations } from "./migrations.js";

interface MetadataTokenRow {
  content_hash: string;
  title: string;
  creator: string;
  description: string;
  content_type: string;
  blob_pointer_hash: string;
  hop_count: number;
  signature: string;
  signer_public_key: string | null;
}

function rowToToken(row: MetadataTokenRow): MetadataToken {
  const hasSigner = row.signer_public_key !== null && row.signer_public_key !== "";
  return {
    title: row.title,
    creator: row.creator,
    description: row.description,
    provenance: { hopCount: row.hop_count },
    contentType: row.content_type,
    blobPointer: { contentHash: row.blob_pointer_hash },
    contentHash: row.content_hash,
    signature: row.signature,
    ...(hasSigner ? { signerPublicKey: row.signer_public_key as string } : {}),
  };
}

export interface SqliteMetadataRepositoryOptions {
  /** Path to the SQLite database file. Use `:memory:` for an ephemeral, process-local database (still passes the full contract suite; does not survive restart by design). */
  readonly filePath: string;
}

export class SqliteMetadataRepository implements MetadataRepositoryPort {
  private readonly db: DatabaseSync;

  /**
   * Opens (creating if necessary) the SQLite database at `options.filePath`
   * and runs any pending schema migrations synchronously before returning
   * — issue #27's "runs automatically on startup" means "by the time this
   * constructor returns, the schema is current." Every other method may
   * assume the current schema exists.
   */
  constructor(options: SqliteMetadataRepositoryOptions) {
    this.db = new DatabaseSync(options.filePath);
    runMigrations(this.db);
  }

  save(token: MetadataToken): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO metadata_tokens
           (content_hash, title, creator, description, content_type, blob_pointer_hash, hop_count, signature, signer_public_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(content_hash) DO UPDATE SET
           title = excluded.title,
           creator = excluded.creator,
           description = excluded.description,
           content_type = excluded.content_type,
           blob_pointer_hash = excluded.blob_pointer_hash,
           hop_count = excluded.hop_count,
           signature = excluded.signature,
           signer_public_key = excluded.signer_public_key`,
      )
      .run(
        token.contentHash,
        token.title,
        token.creator,
        token.description,
        token.contentType,
        token.blobPointer.contentHash,
        token.provenance.hopCount,
        token.signature,
        token.signerPublicKey ?? null,
      );
    return Promise.resolve();
  }

  findByContentHash(contentHash: string): Promise<MetadataToken | undefined> {
    const row = this.db
      .prepare(`SELECT * FROM metadata_tokens WHERE content_hash = ?`)
      .get(contentHash) as MetadataTokenRow | undefined;
    return Promise.resolve(row ? rowToToken(row) : undefined);
  }

  delete(contentHash: string): Promise<void> {
    this.db.prepare(`DELETE FROM metadata_tokens WHERE content_hash = ?`).run(contentHash);
    return Promise.resolve();
  }

  listAll(): Promise<readonly MetadataToken[]> {
    const rows = this.db
      .prepare(`SELECT * FROM metadata_tokens`)
      .all() as unknown as MetadataTokenRow[];
    return Promise.resolve(rows.map(rowToToken));
  }

  /** Closes the underlying SQLite connection. Safe to call once the repository is no longer needed; not part of `MetadataRepositoryPort` (which has no lifecycle method), so callers that hold a `SqliteMetadataRepository` concretely (not just through the port interface) call this directly — e.g. a composition root on shutdown, or a test tearing down a temp database. */
  close(): void {
    this.db.close();
  }
}
