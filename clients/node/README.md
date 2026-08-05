# `@art-pollinator/node`

The stationary-node composition root (SPEC.md §4, issue #45): a long-lived
Node process holding a larger, still-bounded collection (issue #46) and
swapping with devices as they join a local network.

## Running it

```
npm run start --workspace=clients/node
```

Runs `src/index.ts` via `tsx` (a devDependency of this package only — see
`src/index.ts`'s own doc comment for why plain `node` cannot run this
codebase's TypeScript source directly, and why `tsx` is the pragmatic fix
rather than a repo-wide build pipeline). Listens on `0.0.0.0` by default;
configure via environment variables (all optional, all defaulted):

| Variable                                     | Default                                  | Meaning                                               |
| -------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `ARTPOLLINATOR_NODE_HOST`                    | `0.0.0.0`                                | Interface both listeners bind to                      |
| `ARTPOLLINATOR_NODE_TRANSPORT_PORT`          | `47822`                                  | `HttpTransportServer`'s port (swap traffic)           |
| `ARTPOLLINATOR_NODE_DISCOVERY_PORT`          | `47821`                                  | `LanDiscoveryResponder`'s port ("who are you")        |
| `ARTPOLLINATOR_NODE_DB_PATH`                 | `~/.art-pollinator/node/library.sqlite3` | SQLite database file                                  |
| `ARTPOLLINATOR_NODE_IDENTITY_DIR`            | `~/.art-pollinator/node/identity`        | Reserved for a future authoring/signing flow          |
| `ARTPOLLINATOR_NODE_CAPACITY_TOTAL_SLOTS`    | `200`                                    | Total `Library` slots (issue #46) — capped at `2,000` |
| `ARTPOLLINATOR_NODE_CAPACITY_LOCKABLE_SLOTS` | `10`                                     | Never-evicted slots within the total                  |

## Architecture

Follows the same composition-root shape `clients/mobile`'s
`composition-root-shared.ts` established: construct the real driven-port
adapters, then hand them to `app`'s real `SwapService`/`LibraryService` —
no domain logic is reimplemented here (AGENTS.md §2 rule 4). See
`src/composition/composition-root.ts`'s own doc comment for exactly what
differs from the mobile composition root and why (listening vs. dialling
transport/discovery, real SQLite persistence, the larger configurable
capacity, a real `SignatureVerifierPort`, and the reactive
swap-on-connect glue).

- `src/config.ts` — environment-variable configuration (issue #45/#46).
- `src/composition/node-capacity.ts` — the node's capacity default and hard
  upper bound (issue #46; see
  `docs/adr/0012-node-library-capacity-generalization.md` for why `core`'s
  `Library` needed to become configurable at all to support this).
- `src/composition/composition-root.ts` — wires `HttpTransportServer` +
  `LanDiscoveryResponder` + `SqliteMetadataRepository` +
  `NodeSignatureVerifier` to `app`'s `SwapService`/`LibraryService`.
- `src/index.ts` — the runnable entry point.
- `src/interrupted-swap.test.ts` — issue #47: a real forced mid-negotiation
  disconnect over real `HttpTransportServer`/`HttpTransportClient`,
  asserting a defined aborted `SwapState` and zero partial repository
  writes.
- `src/e2e-client-node-swap.test.ts` — issue #48: a real, separate spawned
  OS process running this package's own entry point, discovered over real
  LAN discovery and swapped with over real HTTP by an inline "client"
  composition built from the same adapter classes
  `composition-root.web.ts` uses.

## What's verified, and what isn't

This sandbox is Linux-only. Everything this package depends on
(`node:http`, `node:sqlite`, `node:crypto`, `node:fs`) is part of Node's
standard cross-platform API surface with no native addons and no
platform-conditional code path, which is the closest available substitute
for an actual macOS run — see `src/index.ts`'s doc comment for the full
reasoning. Real macOS verification is a disclosed gap, the same category
already established for BLE hardware elsewhere in this codebase
(`@art-pollinator/transport-ble`/`@art-pollinator/discovery-ble`'s own
READMEs).

## Disclosed gaps (decided, not stalled on — AGENTS.md §3)

- **No SQLite-backed `EncounterLogPort` yet.** Uses `core`'s in-memory fake,
  same as `clients/mobile`; encounter memory does not survive a restart.
- **Inbound peers are always treated as `PeerKind: "person"`.** Nothing in
  the wire protocol or `x-peer-id` carries the connecting peer's own kind —
  see `composition-root.ts`'s doc comment.
- **No blob storage wired in this batch.** Issues #45-#48 are about the
  metadata-token swap path; `@art-pollinator/blob-store-filesystem` wiring
  is separate future work.
- **Security model is explicitly out of scope** (issue #49 — a separate
  task). `NodeSignatureVerifier` (already-shipped issue #58 work) is wired
  in because it's a direct reuse with no new policy logic, not a
  substitute for authentication, pairing, or rate limiting.
