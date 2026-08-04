/**
 * `@art-pollinator/metadata-repository-sqlite` — the SQLite adapter for
 * `MetadataRepositoryPort` (issue #25), with versioned startup migrations
 * (issue #27). See `sqlite-metadata-repository.ts` for the `node:sqlite`
 * vs `better-sqlite3` decision and the schema design, and `migrations.ts`
 * for the migration/downgrade story.
 *
 * Depends on `core`, never depended on by it (AGENTS.md §2). Real I/O
 * (SQLite file access) lives here, never in `core`.
 */
export * from "./sqlite-metadata-repository.js";
export * from "./migrations.js";
