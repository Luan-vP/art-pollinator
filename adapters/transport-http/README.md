# `@art-pollinator/transport-http`

Issue #43 (`TransportPort` over HTTP, pulled forward from Phase 2 — without
it, the browser target has no acquisition path at Phase 1 exit).

## Two pieces: server and client

- **`HttpTransportServer`** — a real `node:http` server. Realistically the
  stationary Wi-Fi node's role (Phase 2).
- **`HttpTransportClient`** — dial-out only, `fetch`-based, no listening
  socket. Runs unchanged in `clients/mobile`'s native and web builds alike.

Both implement `TransportPort` and pass the exact same
`transportPortContractCases` suite (`@art-pollinator/core`) that the
in-memory fake and the (mocked) BLE adapter also pass.

## The protocol: two HTTP routes carrying a bidirectional port over a request/response transport

- `POST /messages` (header `x-peer-id`): a peer delivering a message to the
  server. Queued for the server's own `receive()`; responds `204`.
- `GET /messages?peer=<id>`: a peer's long-poll for the next message the
  server wants to send _it_ (queued by the server's own `send(peer, ...)`).
  Responds `200` with the bytes as soon as one is queued, or `204` after a
  bounded wait if none arrives — the client retries on `204`.

This rendezvous (whichever of "`send()` queued a message" or "a long-poll
arrived" happens second completes the response) mirrors `core`'s own
`InMemoryTransportPort.receive()` queued-message-or-waiter pattern, just
over a real socket.

## Design note: `HttpTransportClient` talks to any peer, not one fixed server

An earlier version of this class was bound to a single `serverAddress` at
construction and rejected `send()` to anyone else. That doesn't match
`TransportPort`'s actual contract (`send(peer, ...)` takes the peer per
call; `receive()` aggregates messages from _any_ connected peer) and
doesn't fit how a composition root wants to use it — one long-lived
instance, usable for whichever peer `@art-pollinator/discovery-lan` finds,
exactly like `@art-pollinator/transport-ble`'s `BleTransportAdapter`. This
surfaced directly while wiring `clients/mobile`'s composition root — see
that package's own composition-root files — and was fixed rather than
worked around. `HttpTransportClient` now starts polling a peer's inbox the
first time it's addressed (via `send()`, or proactively via `connect()`,
its own `BleTransportAdapter.connect()`-equivalent), and `receive()`
resolves with the next message from _any_ peer currently being polled — a
single shared inbox + waiter queue.

## A real performance finding, and its fix

Early versions of this suite took 5-6 seconds _per test_. Cause:
`fetch`'s keep-alive behavior leaves the underlying TCP socket open after a
response completes, and plain `http.Server.close()` waits for every such
socket to close on its own (Node's default keep-alive timeout) before its
callback fires. `HttpTransportServer.close()` now also calls
`closeAllConnections()` — safe, since `close()` already means "this server
is done," not "gracefully wind down while still serving" — which dropped
the full suite from ~33s to well under 1s. Documented here because it's a
real, generalizable lesson for anyone testing a real HTTP server with
long-poll/keep-alive semantics, not specific to this one adapter.

## Testing

Fully real: a real `node:http` server on an ephemeral loopback port, a
real `fetch`-based client, real `@art-pollinator/core` wire-protocol
messages round-tripped end to end. No mocking anywhere in this package —
contrast with the BLE adapters, which have no hardware in this environment
to test against for real.
