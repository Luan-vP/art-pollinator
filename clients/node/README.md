# `@art-pollinator/node`

The stationary-node composition root (SPEC.md §4, issue #45): a long-lived
Node process holding a larger, still-bounded collection (issue #46) and
swapping with devices as they join a local network. Now with a real
security model (issue #49), a node operator surface (issue #50), moderation
(issue #51), and structured observability (issue #52).

## Operator workflow: install → run → seed → administer

### 1. Install

```
git clone <this repo> && cd art-pollinator
npm ci
```

`clients/node` needs `openssl` on `PATH` only if you turn on TLS (see
below) — everything else is pure Node (`>=22.5.0`, for `node:sqlite`).

### 2. Run

```
npm run start --workspace=clients/node
```

Runs `src/index.ts` via `tsx` (a devDependency of this package only — see
`src/index.ts`'s own doc comment for why plain `node` cannot run this
codebase's TypeScript source directly). On startup it prints one structured
JSON line reporting where all three of its listeners ended up:

```json
{"event":"art-pollinator-node-listening","baseUrl":"http://0.0.0.0:47822","transportPort":47822,"discoveryPort":47821,"adminBaseUrl":"http://127.0.0.1:47824","host":"0.0.0.0","capacity":{...},"dbPath":"...","tlsEnabled":false}
```

Configure via environment variables (all optional, all defaulted):

| Variable                                     | Default                                  | Meaning                                                                                                           |
| -------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ARTPOLLINATOR_NODE_HOST`                    | `0.0.0.0`                                | Interface the swap/discovery listeners bind to (the admin server always binds `127.0.0.1` regardless — see below) |
| `ARTPOLLINATOR_NODE_TRANSPORT_PORT`          | `47822`                                  | `HttpTransportServer`'s port (swap traffic — public, authenticated)                                               |
| `ARTPOLLINATOR_NODE_DISCOVERY_PORT`          | `47821`                                  | `LanDiscoveryResponder`'s port ("who are you")                                                                    |
| `ARTPOLLINATOR_NODE_ADMIN_PORT`              | `47824`                                  | `AdminHttpServer`'s port (issue #50 — always localhost-only)                                                      |
| `ARTPOLLINATOR_NODE_DB_PATH`                 | `~/.art-pollinator/node/library.sqlite3` | SQLite database file                                                                                              |
| `ARTPOLLINATOR_NODE_IDENTITY_DIR`            | `~/.art-pollinator/node/identity`        | This node's persistent identity, and (if TLS is enabled) its certificate                                          |
| `ARTPOLLINATOR_NODE_CAPACITY_TOTAL_SLOTS`    | `200`                                    | Total `Library` slots (issue #46) — capped at `2,000`                                                             |
| `ARTPOLLINATOR_NODE_CAPACITY_LOCKABLE_SLOTS` | `10`                                     | Never-evicted slots within the total                                                                              |
| `ARTPOLLINATOR_NODE_TLS_ENABLED`             | `false`                                  | Enable HTTPS on the swap port (issue #49) — see `docs/adr/0014-transport-tls-scope.md` before turning this on     |

**Connection-level authentication is always on** (issue #49, not
configurable) — every swap peer must complete a challenge-response
handshake before `/messages` will talk to it. See
`docs/adr/0013-peer-connection-authentication.md`.

### 3. Seed

There is no dedicated seeding CLI in this batch — a node starts with an
empty library and accumulates content the same way any device does: through
swaps. An operator who wants to pre-populate a node's collection can do so
directly against the SQLite database (`ARTPOLLINATOR_NODE_DB_PATH`) using
`@art-pollinator/metadata-repository-sqlite`'s `SqliteMetadataRepository`,
or by having the node itself swap with a seeded phone/other node. A
dedicated authoring/seeding flow is issue #53's `IngestionService`
(Phase 3), out of scope here.

### 4. Administer

The admin surface (`AdminHttpServer`, always bound to `127.0.0.1` —
reachable from the node's own machine, or via an SSH tunnel, never from the
public LAN) exposes:

| Method & path      | What it does                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`      | Process uptime, current library size, listener status (issue #52)                                                                              |
| `GET /library`     | Current library snapshot (counts, capacity) and a flat list of every item                                                                      |
| `GET /security`    | Connection/authentication/rate-limit state from the swap transport (issue #49)                                                                 |
| `POST /capacity`   | Change capacity at runtime, body `{ "maxLockableSlots": N, "swappableSlots": N }` — validated against issue #46's bound, `422` if out of range |
| `GET /revocations` | Every moderation takedown this node currently knows about (issue #51)                                                                          |
| `POST /revoke`     | Issue a takedown, body `{ "contentHash": "..." }` — removes it from this node's library immediately and records/propagates a signed revocation |

Example session:

```
curl http://127.0.0.1:47824/health
curl http://127.0.0.1:47824/library
curl -X POST http://127.0.0.1:47824/capacity \
  -H 'content-type: application/json' \
  -d '{"maxLockableSlots": 20, "swappableSlots": 480}'
curl -X POST http://127.0.0.1:47824/revoke \
  -H 'content-type: application/json' \
  -d '{"contentHash": "<hex content hash>"}'
```

## Architecture

Follows the same composition-root shape `clients/mobile`'s
`composition-root-shared.ts` established: construct the real driven-port
adapters, then hand them to `app`'s real `SwapService`/`LibraryService`/
`AdminService` — no domain logic is reimplemented here (AGENTS.md §2 rule
4). See `src/composition/composition-root.ts`'s own doc comment for
exactly what differs from the mobile composition root and why (listening
vs. dialling transport/discovery, real SQLite persistence, the larger
configurable — and now runtime-changeable — capacity, a real
`SignatureVerifierPort` doing double duty for both content and connection
authentication, opportunistic revocation, structured logging, and the
reactive swap-on-connect glue).

- `src/config.ts` — environment-variable configuration.
- `src/composition/node-capacity.ts` — the node's capacity default and hard
  upper bound (issue #46; see
  `docs/adr/0012-node-library-capacity-generalization.md`).
- `src/composition/tls-cert.ts` — self-signed certificate generation and
  persistence (issue #49; see `docs/adr/0014-transport-tls-scope.md`).
- `src/composition/composition-root.ts` — wires `HttpTransportServer` +
  `LanDiscoveryResponder` + `SqliteMetadataRepository` +
  `NodeSignatureVerifier` + `NodeIdentityAdapter` to `app`'s
  `SwapService`/`LibraryService`/`AdminService`.
- `src/observability/json-lines-logger.ts` — the real `LoggerPort`
  (issue #52).
- `src/admin/admin-http-server.ts` — the localhost-only operator surface
  (issue #50).
- `src/index.ts` — the runnable entry point.
- `src/interrupted-swap.test.ts` — issue #47: a real forced mid-negotiation
  disconnect over real `HttpTransportServer`/`HttpTransportClient`,
  asserting a defined aborted `SwapState` and zero partial repository
  writes.
- `src/e2e-client-node-swap.test.ts` — issue #48: a real, separate spawned
  OS process running this package's own entry point, discovered over real
  LAN discovery, **authenticated** (issue #49), and swapped with over real
  HTTP by an inline "client" composition built from the same adapter
  classes `composition-root.web.ts` uses.

## Security model (issue #49) — see `docs/security/threat-model.md` for the full picture

- **Authentication:** every swap peer completes a real challenge-response
  handshake before `/messages` will talk to it (`docs/adr/0013-...md`).
  Unconditional — not configurable off in this composition root.
- **Transport encryption:** real, working, self-signed TLS is available
  (`ARTPOLLINATOR_NODE_TLS_ENABLED=true`) but defaults off pending a
  cross-platform client-trust story (`docs/adr/0014-...md`).
- **Rate limiting:** a swap-attempt limiter in `SwapService` (per peer),
  plus independent handshake (per IP) and message (per identity) limiters
  in `HttpTransportServer` — defense in depth against SPEC.md §5's named
  flooding threat.
- **Content validation on ingest:** oversized/excessive-count offers are
  rejected before `AcceptPolicy` or the repository ever see them.
- **Resource exhaustion:** request-body size and concurrent-connection caps
  at the transport layer.

## What's verified, and what isn't

This sandbox is Linux-only. Everything this package depends on
(`node:http`/`node:https`, `node:sqlite`, `node:crypto`, `node:fs`,
`openssl` for TLS) is part of Node's standard cross-platform API surface
(or, for `openssl`, present by default on both target platforms), which is
the closest available substitute for an actual macOS run — see
`src/index.ts`'s doc comment for the full reasoning. Real macOS
verification is a disclosed gap, the same category already established for
BLE hardware elsewhere in this codebase.

## Disclosed gaps (decided, not stalled on — AGENTS.md §3)

- **No SQLite-backed `EncounterLogPort`/`RevocationLogPort` yet.** Both use
  `core`'s in-memory fakes; encounter memory and revocation knowledge do
  not survive a restart.
- **Inbound peers are always treated as `PeerKind: "person"`.** Nothing in
  the wire protocol or `x-peer-id` carries the connecting peer's own kind —
  see `composition-root.ts`'s doc comment.
- **No blob storage wired in this batch.** `@art-pollinator/blob-store-filesystem`
  wiring is separate future work.
- **TLS client-side trust for the browser/mobile targets is unsolved** —
  see `docs/adr/0014-transport-tls-scope.md`.
- **No seeding CLI** — see "3. Seed" above; issue #53's `IngestionService`
  is the real answer, gated on the Phase 3 rights/licensing model
  (SPEC.md §10).
