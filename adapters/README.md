# adapters/

Placeholder directory. No adapter packages exist yet.

This directory will hold one npm package per port implementation — e.g.
`adapters/ble-transport`, `adapters/sqlite-metadata-repository`,
`adapters/local-fs-blob-store` — as Phase 1a/1b lands (IMPLEMENTATION.md
items 25, 33-34, 40).

Rules each adapter package must follow (AGENTS.md §2, §4):

- May depend on `core`.
- Must never be depended on by `core`.
- Must ship an in-memory fake alongside the real implementation, and both
  must pass the same port contract test suite.

The root workspace glob `adapters/*` already picks up any package added here
automatically — no root `package.json` change is needed when the first
adapter lands.
