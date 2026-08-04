import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, runMigrations } from "./migrations.js";
// See node-sqlite.ts's header comment for why this isn't a direct
// `node:sqlite` import.
import { DatabaseSync } from "./node-sqlite.js";

function readUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

interface RawRow {
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

describe("runMigrations (issue #27)", () => {
  it("a brand-new database (user_version 0) is migrated fully to CURRENT_SCHEMA_VERSION", () => {
    const db = new DatabaseSync(":memory:");
    expect(readUserVersion(db)).toBe(0);

    runMigrations(db);

    expect(readUserVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(3); // at least two migration steps exist beyond v1

    // The table exists and is queryable with the current (v3) column set.
    db.prepare(
      `INSERT INTO metadata_tokens
         (content_hash, title, creator, description, content_type, blob_pointer_hash, hop_count, signature, signer_public_key)
       VALUES ('h', 't', 'c', 'd', 'text/plain', 'h', 0, '', '')`,
    ).run();
    const row = db.prepare(`SELECT * FROM metadata_tokens WHERE content_hash = 'h'`).get();
    expect(row).toMatchObject({ content_hash: "h" });

    db.close();
  });

  it("re-running migrations on an already-current database is a no-op", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db);
    db.prepare(
      `INSERT INTO metadata_tokens
         (content_hash, title, creator, description, content_type, blob_pointer_hash, hop_count, signature, signer_public_key)
       VALUES ('h', 't', 'c', 'd', 'text/plain', 'h', 0, '', '')`,
    ).run();

    runMigrations(db); // second call: nothing should change

    expect(readUserVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    const all = db.prepare(`SELECT * FROM metadata_tokens`).all();
    expect(all).toHaveLength(1);

    db.close();
  });

  it(
    "upgrades a database starting at schema version 1 (a raw SQL fixture, pre-signing) across at " +
      "least two migration steps to CURRENT_SCHEMA_VERSION, preserving and transforming existing data",
    () => {
      const db = new DatabaseSync(":memory:");

      // Hand-build the exact v1 shape via raw SQL: no signer_public_key
      // column at all (that arrives in v2), and mark this database as
      // already having migration 1 applied — as a real pre-existing
      // database from before v2/v3 existed would be found on disk.
      db.exec(`
        CREATE TABLE metadata_tokens (
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
      db.prepare(
        `INSERT INTO metadata_tokens
           (content_hash, title, creator, description, content_type, blob_pointer_hash, hop_count, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "legacy-a",
        "Legacy title A",
        "Legacy creator",
        "A legacy piece.",
        "image/jpeg",
        "legacy-a",
        4,
        "",
      );
      db.prepare(
        `INSERT INTO metadata_tokens
           (content_hash, title, creator, description, content_type, blob_pointer_hash, hop_count, signature)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "legacy-b",
        "Legacy title B",
        "Legacy creator 2",
        "Another legacy piece.",
        "text/plain",
        "legacy-b",
        0,
        "",
      );
      db.exec("PRAGMA user_version = 1");

      expect(readUserVersion(db)).toBe(1);

      runMigrations(db);

      // Landed on the current version, having crossed at least migrations
      // 2 and 3 (two schema versions beyond the v1 starting point).
      expect(readUserVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
      expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(3);

      const rows = db
        .prepare(`SELECT * FROM metadata_tokens ORDER BY content_hash`)
        .all() as unknown as RawRow[];

      expect(rows).toHaveLength(2);

      // Pre-existing data (v1 columns) is untouched...
      expect(rows[0]).toMatchObject({
        content_hash: "legacy-a",
        title: "Legacy title A",
        creator: "Legacy creator",
        description: "A legacy piece.",
        content_type: "image/jpeg",
        blob_pointer_hash: "legacy-a",
        hop_count: 4,
        signature: "",
      });
      expect(rows[1]).toMatchObject({
        content_hash: "legacy-b",
        title: "Legacy title B",
      });

      // ...and the v2 column added later is backfilled by v3's transform
      // to '' (never left NULL) for every pre-existing row.
      expect(rows[0]?.signer_public_key).toBe("");
      expect(rows[1]?.signer_public_key).toBe("");

      db.close();
    },
  );

  it("upgrades a database starting at schema version 2 (signer_public_key column exists, some rows NULL)", () => {
    const db = new DatabaseSync(":memory:");

    db.exec(`
      CREATE TABLE metadata_tokens (
        content_hash TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        creator TEXT NOT NULL,
        description TEXT NOT NULL,
        content_type TEXT NOT NULL,
        blob_pointer_hash TEXT NOT NULL,
        hop_count INTEGER NOT NULL,
        signature TEXT NOT NULL,
        signer_public_key TEXT
      )
    `);
    db.prepare(
      `INSERT INTO metadata_tokens
         (content_hash, title, creator, description, content_type, blob_pointer_hash, hop_count, signature, signer_public_key)
       VALUES ('unsigned', 't', 'c', 'd', 'image/jpeg', 'unsigned', 0, '', NULL)`,
    ).run();
    db.prepare(
      `INSERT INTO metadata_tokens
         (content_hash, title, creator, description, content_type, blob_pointer_hash, hop_count, signature, signer_public_key)
       VALUES ('signed', 't2', 'c2', 'd2', 'image/jpeg', 'signed', 1, 'aa', 'bb')`,
    ).run();
    db.exec("PRAGMA user_version = 2");

    runMigrations(db);

    expect(readUserVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    const unsigned = db
      .prepare(`SELECT signer_public_key FROM metadata_tokens WHERE content_hash = 'unsigned'`)
      .get() as { signer_public_key: string };
    const signed = db
      .prepare(`SELECT signer_public_key FROM metadata_tokens WHERE content_hash = 'signed'`)
      .get() as { signer_public_key: string };

    // NULL backfilled to '', but an already-present real value is untouched.
    expect(unsigned.signer_public_key).toBe("");
    expect(signed.signer_public_key).toBe("bb");

    db.close();
  });
});
