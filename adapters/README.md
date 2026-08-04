# adapters/

One npm package per port implementation. Landed so far:

- `identity-node` — `IdentityPort` / `SignatureVerifierPort` for a Node
  environment (issues #57/#58).
- `metadata-repository-sqlite` — `MetadataRepositoryPort` backed by SQLite,
  with versioned startup migrations (issues #25/#26/#27).

More will land per port as Phase 1a/1b continues (IMPLEMENTATION.md items
33-34, 40) — e.g. `adapters/ble-transport`, `adapters/local-fs-blob-store`.

Rules each adapter package must follow (AGENTS.md §2, §4):

- May depend on `core`.
- Must never be depended on by `core`.
- Must ship an in-memory fake alongside the real implementation, and both
  must pass the same port contract test suite.

The root workspace glob `adapters/*` already picks up any package added here
automatically — no root `package.json` change is needed when the first
adapter lands.
