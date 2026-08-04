# `@art-pollinator/metadata-repository-sqlite`

A `MetadataRepositoryPort` implementation backed by SQLite (issue #25,
IMPLEMENTATION.md Phase 1a item 25). Follows the same structural pattern as
`adapters/identity-node` (own `package.json`/`tsconfig.json`/
`vitest.config.ts`, discovered automatically by `scripts/run-adapter-tests.mjs`).

## SQLite binding: `node:sqlite`, not `better-sqlite3`

Node's built-in `node:sqlite` module is used instead of taking on
`better-sqlite3` as an npm dependency. Verified against the Node version this
was built and tested against (`node --version`) before committing to it, per
this issue's own instruction — `node:sqlite` opened a database, created a
table, and round-tripped rows without issue; `PRAGMA user_version` (used for
schema versioning below) also worked as expected.

Reasoning, in full, lives in `src/sqlite-metadata-repository.ts`'s header
comment. Short version: zero added dependency (no native addon to compile or
fetch prebuilt), and this adapter is scoped to the plain-Node server target
(SPEC.md §8) where `node:sqlite` already lives. The trade-off: `node:sqlite`
is still marked experimental upstream (logs an `ExperimentalWarning` on first
use) and needs a reasonably recent Node — see `package.json`'s
`engines.node`. If a future target needs an older/different Node where
`node:sqlite` is unavailable, `better-sqlite3` is a near-drop-in replacement
for the small surface this file touches (`DatabaseSync`, `.exec`,
`.prepare().run/.get/.all`); neither the port nor the contract suite this
adapter passes would need to change.

## Schema and migrations (issue #27)

Versioned via `PRAGMA user_version` (SQLite's built-in per-file schema
version integer — no extra bookkeeping table needed). `SqliteMetadataRepository`'s
constructor calls `runMigrations` before the repository is usable, so
opening a database file always leaves it at the current schema version,
whether that file is brand new (`user_version` 0) or was last written by an
older version of this adapter.

Full schema history, the exact migrations, and why each one exists are
documented in `src/migrations.ts`'s header comment. Summary:

| Version | Change                                                                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Initial `metadata_tokens` table (pre-signing shape).                                                                                                     |
| 2       | Adds the nullable `signer_public_key` column (issue #58 signing support, added after the initial schema — mirroring `MetadataToken`'s own real history). |
| 3       | Backfills `signer_public_key IS NULL` rows to `''`, matching the "empty string means absent" convention `signature` already uses.                        |

`src/migrations.test.ts` simulates a database starting at the v1 shape (via
a raw SQL fixture, no `signer_public_key` column at all) and asserts
`runMigrations` carries it across both migration steps to the current
version with existing rows preserved and the new column correctly
backfilled — not just schema-deep but data-deep.

### Downgrade path (documented manually, not automated)

Issue #27 permits a documented manual procedure in place of automated
down-migrations; given the small version history here, that is the more
proportionate choice. With every `SqliteMetadataRepository` instance pointed
at the file closed (SQLite forbids concurrent schema changes from another
connection), run the relevant step(s) in descending order down to the
target version, using any SQLite client:

```sql
-- Downgrade v3 -> v2: v3 only rewrote data (NULL -> ''), it added no
-- column to undo. '' and NULL are equivalent under the "absent signer"
-- convention, so this step is just the version number:
PRAGMA user_version = 2;

-- Downgrade v2 -> v1: drop the column v2 added.
ALTER TABLE metadata_tokens DROP COLUMN signer_public_key;
PRAGMA user_version = 1;
```

There is no v1 -> v0 step: v0 means "no `metadata_tokens` table exists,"
and going that far back means discarding the data outright
(`DROP TABLE metadata_tokens; PRAGMA user_version = 0;`), which is
destructive by nature, not a migration.

## Interchangeability with the in-memory fake (issue #26)

`src/sqlite-metadata-repository.test.ts` runs
`metadataRepositoryContractCases` from `@art-pollinator/core` — the
identical suite `core/src/ports/metadata-repository-contract-suite.test.ts`
runs against `InMemoryMetadataRepositoryPort` — against this adapter. Both
pass every case. It also separately tests that data written by one
`SqliteMetadataRepository` instance survives closing it and opening a fresh
instance against the same file path (simulating a process restart).
