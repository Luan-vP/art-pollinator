# `@art-pollinator/blob-store-filesystem`

Two Node-only filesystem adapters:

- **`FilesystemBlobStorePort`** — a `BlobStorePort` implementation (issue #40,
  IMPLEMENTATION.md Phase 1b item 40). SPEC.md §3.2: "Phase 1 stores blobs on
  the local filesystem only."
- **`FileBlobFetchQueueStorePort`** — a `BlobFetchQueueStorePort`
  implementation (issue #41's "survives restart" DoD, for a real restart on
  a Node-capable target — see `app/src/blob/deferred-blob-queue.ts`).

Both follow the same structural pattern as `adapters/identity-node` and
`adapters/metadata-repository-sqlite` (own `package.json`/`tsconfig.json`/
`vitest.config.ts`, discovered automatically by `scripts/run-adapter-tests.mjs`).

## Content-addressed layout

A blob with content hash `h` is stored at `<baseDir>/<h[0:2]>/<h>` — sharded
by hash prefix so a single directory never accumulates one entry per blob
ever stored. See `filesystem-blob-store.ts`'s header comment for the full
reasoning.

## Integrity verification on fetch

`FilesystemBlobStorePort.get()` recomputes the SHA-256 of the bytes actually
read off disk (reusing `@art-pollinator/core`'s `sha256Hex` — the same
primitive `contentHash` is defined in terms of, not a second hashing
implementation) and rejects with `BlobIntegrityError` if it does not match
the requested content hash. This is a real, exercised failure mode in this
package's own test suite: `filesystem-blob-store.test.ts` writes a blob,
then manually corrupts the file on disk (flips a byte; separately,
truncates it) entirely outside the adapter, and asserts the next `get()`
actually rejects rather than silently returning corrupted bytes.

`get()` returning `undefined` still means "not held locally" (an ordinary
cache miss); throwing means "held locally, but the bytes on disk no longer
match what they're supposed to be" — a different, non-benign condition this
adapter deliberately does not conflate with the miss case. See
`filesystem-blob-store.ts`'s header comment for the full reasoning, including
why this doesn't require widening `BlobStorePort`'s own type signature.

## `BlobStorePort` contract suite (issue #40 DoD, AGENTS.md §2 rule 5)

`FilesystemBlobStorePort` passes `@art-pollinator/core`'s
`blobStoreContractCases` identically to the in-memory fake
(`filesystem-blob-store.test.ts`'s first `describe` block). That suite's
fixtures use _real_ content hashes (`sha256Hex(data)`), not arbitrary labels
— see the suite's own doc comment for why an adapter that verifies integrity
on fetch requires that.

## Queue persistence: a dedicated port, not piggybacked on SQLite

`adapters/metadata-repository-sqlite` is explicitly scoped to the Node
server target. The mobile client has no real `MetadataRepositoryPort`
adapter of its own yet either (its composition root currently uses the
in-memory fake for that port — a disclosed, pre-existing gap, not new to
this batch). Tying `BlobFetchQueueStorePort`'s persistence to SQLite
specifically would not help the client this queue actually ships on first,
so `BlobFetchQueueStorePort` (`@art-pollinator/core`) is its own small port,
and `FileBlobFetchQueueStorePort` here is a plain one-JSON-file
implementation: `load()`/`saveAll()` only, matching the port's own
"snapshot, not incremental CRUD" design.

Writes go through a temp file plus atomic rename so a crash mid-write can
never leave a half-written, unparseable queue file behind.

## Not yet wired into the mobile composition root

Neither adapter here is currently constructed by
`clients/mobile/src/composition/composition-root.native.ts` /
`composition-root.web.ts`. Both use plain `node:fs`, which the React Native
JS runtime (Hermes) does not provide — the same category of gap
`adapters/metadata-repository-sqlite`'s README already discloses for
`node:sqlite` ("it does not help React Native directly — that target would
need its own storage adapter regardless of this choice"). A real mobile
target needs an RN-specific adapter (e.g. built on `expo-file-system` or
`react-native-fs`) implementing the same two ports — out of scope for this
batch; this package is directly usable as-is by the Node server composition
root once that lands (Phase 2, IMPLEMENTATION.md item 45), and by any
Node-based dev/test harness in the meantime.
