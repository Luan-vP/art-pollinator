/**
 * Versioned schema migrations for `SqliteMetadataRepository` (issue #27,
 * IMPLEMENTATION.md Phase 1a item 27).
 *
 * ## Versioning mechanism: `PRAGMA user_version`
 *
 * SQLite reserves a 32-bit integer in every database file's header
 * specifically for application schema versioning
 * (https://www.sqlite.org/pragma.html#pragma_user_version) — no extra
 * bookkeeping table needed, and it is available before any of our own
 * tables exist (a brand-new, empty database reads back `user_version = 0`).
 * `runMigrations` reads it, applies every migration whose `version` is
 * greater than the value on disk, in order, and writes the new version back
 * after each one. This is what "runs automatically on startup" means here —
 * `SqliteMetadataRepository`'s constructor calls `runMigrations` before the
 * repository is usable for any other operation (issue #27's "checks a
 * schema-version table/pragma and applies any pending migrations before the
 * adapter is usable").
 *
 * A brand-new database (`user_version = 0`) runs every migration from
 * `MIGRATIONS[0]` onward, so "create the schema" is not a special case
 * distinct from "upgrade an existing database" — it is just the migration
 * sequence starting from version 0 instead of some later version.
 *
 * ## Schema history
 *
 * - **v1** — initial `metadata_tokens` table. One row per `MetadataToken`,
 *   columns flattened rather than a single JSON blob (see
 *   `sqlite-metadata-repository.ts`'s header comment for why). No signing
 *   support yet — this mirrors the real history of `MetadataToken` itself,
 *   which grew `signature`/`signerPublicKey` later (issues #57/#58) on top
 *   of an already-shipped shape.
 * - **v2** — adds the `signer_public_key` column (nullable: existing rows
 *   have no signer). `signature` was present from v1 since it predates the
 *   optional public key field on `MetadataToken` (`signature` defaults to
 *   `""` for "unsigned", see `metadata-token.ts`'s `isTokenSigned`).
 * - **v3** — backfills `signer_public_key IS NULL` rows to `''`, matching
 *   the same "empty string means absent" convention `signature` already
 *   uses (`isTokenSigned`'s check is `signature !== "" && !!signerPublicKey
 *   && signerPublicKey !== ""`) so `SqliteMetadataRepository` never has to
 *   special-case `NULL` vs `''` when reading a row back. This is a genuine
 *   data transform, not just a DDL change — existing rows are rewritten.
 * - **v4** — adds `blob_pointer_scheme` and `blob_pointer_bucket_ref`
 *   columns (issue #39: `BlobPointer` grew from a single-field placeholder
 *   into a resolvable-anywhere discriminated union —
 *   `metadata-token.ts`'s doc comment predicted exactly this: "when that
 *   type grows, the migration that adds columns/tables for it is the
 *   correct place to revisit this"). Existing rows backfill
 *   `blob_pointer_scheme = 'local-filesystem'` (every row written before
 *   this migration was, by construction, a `local-filesystem` pointer —
 *   `bucket` did not exist yet); `blob_pointer_bucket_ref` stays `NULL` for
 *   all of them (only meaningful for the `bucket` scheme, which has no real
 *   resolver in this phase — see `BlobPointer`'s doc comment).
 *
 * `CURRENT_SCHEMA_VERSION` is always the highest `version` in
 * `MIGRATIONS`; a database at that version is up to date and
 * `runMigrations` is a no-op.
 *
 * ## Downgrade path — documented, not automated
 *
 * Issue #27 explicitly allows "a documented manual procedure" in place of
 * automated down-migrations; that is the choice made here; SQLite's
 * `ALTER TABLE ... DROP COLUMN` (supported by the SQLite version bundled
 * with Node's `node:sqlite`) makes each step mechanical enough that a
 * script is not worth the added surface for a Phase 1a adapter with a
 * three-version history:
 *
 * ```sql
 * -- Downgrade v4 -> v3: drop the columns v4 added.
 * ALTER TABLE metadata_tokens DROP COLUMN blob_pointer_scheme;
 * ALTER TABLE metadata_tokens DROP COLUMN blob_pointer_bucket_ref;
 * PRAGMA user_version = 3;
 *
 * -- Downgrade v3 -> v2: no schema change to undo (v3 only rewrote data,
 * -- it added no column). '' and NULL are equivalent under the "absent
 * -- signer" convention, so simply set the version back:
 * PRAGMA user_version = 2;
 *
 * -- Downgrade v2 -> v1: drop the column v2 added.
 * ALTER TABLE metadata_tokens DROP COLUMN signer_public_key;
 * PRAGMA user_version = 1;
 * ```
 *
 * Run the relevant step(s) with the database closed by any
 * `SqliteMetadataRepository` instance (SQLite forbids concurrent schema
 * changes from another connection), in descending version order down to
 * the target. There is no v1 -> v0 step: v0 is "no `metadata_tokens` table
 * at all," and downgrading that far means discarding the data outright
 * (`DROP TABLE metadata_tokens; PRAGMA user_version = 0;`), which is
 * destructive by nature rather than a migration.
 */
// `./node-sqlite.js` re-exports `node:sqlite`'s `DatabaseSync` — see that
// file's header comment for why this isn't a direct `node:sqlite` import.
import type { DatabaseSync } from "./node-sqlite.js";

interface Migration {
  /** The schema version this migration produces once applied. */
  readonly version: number;
  readonly description: string;
  readonly up: (db: DatabaseSync) => void;
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    description: "create metadata_tokens table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS metadata_tokens (
          content_hash TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          creator TEXT NOT NULL,
          description TEXT NOT NULL,
          content_type TEXT NOT NULL,
          blob_pointer_hash TEXT NOT NULL,
          hop_count INTEGER NOT NULL,
          signature TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 2,
    description: "add signer_public_key column (issue #58 signing support)",
    up: (db) => {
      db.exec(`ALTER TABLE metadata_tokens ADD COLUMN signer_public_key TEXT`);
    },
  },
  {
    version: 3,
    description: "backfill signer_public_key: NULL -> '' (absent-signer convention)",
    up: (db) => {
      db.exec(`UPDATE metadata_tokens SET signer_public_key = '' WHERE signer_public_key IS NULL`);
    },
  },
  {
    version: 4,
    description:
      "add blob_pointer_scheme and blob_pointer_bucket_ref columns (issue #39 resolvable-anywhere BlobPointer)",
    up: (db) => {
      db.exec(`ALTER TABLE metadata_tokens ADD COLUMN blob_pointer_scheme TEXT`);
      db.exec(`ALTER TABLE metadata_tokens ADD COLUMN blob_pointer_bucket_ref TEXT`);
      db.exec(
        `UPDATE metadata_tokens SET blob_pointer_scheme = 'local-filesystem' WHERE blob_pointer_scheme IS NULL`,
      );
    },
  },
];

/** The current schema version this adapter's code targets — always the highest version in {@link MIGRATIONS}. */
export const CURRENT_SCHEMA_VERSION: number = MIGRATIONS.reduce(
  (max, m) => Math.max(max, m.version),
  0,
);

function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

function setSchemaVersion(db: DatabaseSync, version: number): void {
  // PRAGMA does not accept bound parameters; `version` always originates
  // from this module's own MIGRATIONS array, never external input.
  db.exec(`PRAGMA user_version = ${String(version)}`);
}

/**
 * Apply every pending migration to `db`, in ascending version order,
 * starting from whatever `PRAGMA user_version` currently reads (0 for a
 * brand-new database). Idempotent: calling this on an already-current
 * database is a no-op.
 */
export function runMigrations(db: DatabaseSync): void {
  const startingVersion = getSchemaVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= startingVersion) {
      continue;
    }
    migration.up(db);
    setSchemaVersion(db, migration.version);
  }
}
