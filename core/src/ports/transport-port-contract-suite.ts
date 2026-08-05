/**
 * Transport contract suite — one reusable set of behavioural cases every
 * `TransportPort` implementation must satisfy: the in-memory fake
 * (`./fakes/in-memory-transport-port.ts`), the HTTP adapter
 * (`adapters/transport-http/`, issue #43), and the BLE adapter
 * (`adapters/transport-ble/`, issue #33) all pass this identically.
 * Issues #33 and #43 each explicitly require "passes the identical
 * `TransportPort` contract suite" the other adapter passes — this file is
 * that suite, written once rather than duplicated per adapter.
 *
 * ## Placement and design: same rationale as `metadata-repository-contract-suite.ts`
 *
 * Lives beside `transport-port.ts`, not inside `fakes/` (a contract suite
 * exercises implementations, it isn't one). Not named `*.test.ts`, so
 * `scripts/check-core-boundaries.mjs` does not exempt it from `core`'s
 * "no bare imports" rule — it may not import `vitest`. Each case is a plain
 * `() => Promise<void>` that throws a plain `Error` on failure;
 * `transport-port-contract-suite.test.ts` wraps these in `it(name, run)`
 * against the in-memory fake, and each real adapter's own `*.test.ts` does
 * the same against itself.
 *
 * ## Design: the pair factory is the input, not a hardcoded transport
 *
 * `transportPortContractCases` takes `makeConnectedPair`, a factory
 * producing a fresh, already-connected pair of `TransportPort`s (plus their
 * own addresses) per call — mirroring
 * `fakes/in-memory-transport-port.ts`'s `createInMemoryTransportPair`
 * shape, which is the natural unit for a port whose whole job is "move
 * bytes to and from an addressed peer": a lone instance has no peer to
 * exchange anything with. An optional `teardown` lets a real adapter (e.g.
 * an HTTP server bound to a real socket) release resources after each case
 * — the in-memory fake and a mocked BLE surface need no teardown at all.
 */

import type { PeerAddress, TransportPort } from "./transport-port.js";

/** A single named, runnable contract case. `run` throws a plain `Error` on failure. */
export interface TransportPortContractCase {
  readonly name: string;
  readonly run: () => Promise<void>;
}

/** A connected pair of `TransportPort`s ready to exchange messages, plus each side's own address. */
export interface TransportPortPair {
  readonly a: TransportPort;
  readonly addressA: PeerAddress;
  readonly b: TransportPort;
  readonly addressB: PeerAddress;
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertBytesEqual(actual: Uint8Array, expected: Uint8Array, message: string): void {
  const actualArr = Array.from(actual);
  const expectedArr = Array.from(expected);
  assertTrue(
    actualArr.length === expectedArr.length && actualArr.every((v, i) => v === expectedArr[i]),
    `${message} (expected [${expectedArr.join(",")}], got [${actualArr.join(",")}])`,
  );
}

function assertAddressEqual(actual: PeerAddress, expected: PeerAddress, message: string): void {
  assertTrue(
    actual.id === expected.id,
    `${message} (expected "${expected.id}", got "${actual.id}")`,
  );
}

/**
 * Build the full list of contract cases for a given connected-pair factory.
 * Covers: send-then-receive round trip in both directions, receive()
 * called before send() still resolves once the message arrives, message
 * order is preserved within one direction, and disconnect() does not throw.
 *
 * Deliberately does **not** assert "send to an unconnected address rejects"
 * as a shared case (unlike the in-memory fake's own test) — a real network
 * transport's error shape for an unreachable peer legitimately varies (a
 * connection-refused error vs. a timeout vs. a protocol-level rejection),
 * and pinning that down here would make this suite adapter-specific rather
 * than adapter-agnostic. Each adapter's own tests are free to assert their
 * own error behaviour beyond this shared suite.
 */
export function transportPortContractCases(
  makeConnectedPair: () => TransportPortPair | Promise<TransportPortPair>,
  teardown: (pair: TransportPortPair) => Promise<void> | void = () => undefined,
): readonly TransportPortContractCase[] {
  const cases: TransportPortContractCase[] = [];

  cases.push({
    name: "round-trip: a message sent by one side arrives via the other's receive(), with the correct from-address",
    run: async () => {
      const pair = await makeConnectedPair();
      try {
        const payload = new Uint8Array([1, 2, 3]);
        await pair.a.send(pair.addressB, payload);
        const received = await pair.b.receive();
        assertAddressEqual(received.from, pair.addressA, "wrong from-address on receive");
        assertBytesEqual(received.message, payload, "received bytes do not match sent bytes");
      } finally {
        await teardown(pair);
      }
    },
  });

  cases.push({
    name: "receive() resolves once a message arrives, even when called before send()",
    run: async () => {
      const pair = await makeConnectedPair();
      try {
        const receivePromise = pair.b.receive();
        await pair.a.send(pair.addressB, new Uint8Array([5]));
        const received = await receivePromise;
        assertBytesEqual(received.message, new Uint8Array([5]), "message mismatch");
      } finally {
        await teardown(pair);
      }
    },
  });

  cases.push({
    name: "is bidirectional: both ends can send to and receive from each other",
    run: async () => {
      const pair = await makeConnectedPair();
      try {
        await pair.a.send(pair.addressB, new Uint8Array([1]));
        await pair.b.send(pair.addressA, new Uint8Array([2]));

        const bReceived = await pair.b.receive();
        const aReceived = await pair.a.receive();

        assertBytesEqual(bReceived.message, new Uint8Array([1]), "b did not receive a's message");
        assertBytesEqual(aReceived.message, new Uint8Array([2]), "a did not receive b's message");
      } finally {
        await teardown(pair);
      }
    },
  });

  cases.push({
    name: "preserves message order within a single direction",
    run: async () => {
      const pair = await makeConnectedPair();
      try {
        await pair.a.send(pair.addressB, new Uint8Array([1]));
        await pair.a.send(pair.addressB, new Uint8Array([2]));
        await pair.a.send(pair.addressB, new Uint8Array([3]));

        const first = await pair.b.receive();
        const second = await pair.b.receive();
        const third = await pair.b.receive();

        assertBytesEqual(first.message, new Uint8Array([1]), "message 1 out of order");
        assertBytesEqual(second.message, new Uint8Array([2]), "message 2 out of order");
        assertBytesEqual(third.message, new Uint8Array([3]), "message 3 out of order");
      } finally {
        await teardown(pair);
      }
    },
  });

  cases.push({
    name: "disconnect() does not throw, on either side",
    run: async () => {
      const pair = await makeConnectedPair();
      try {
        await pair.a.disconnect(pair.addressB);
        await pair.b.disconnect(pair.addressA);
      } finally {
        await teardown(pair);
      }
    },
  });

  cases.push({
    name: "carries a realistic-size payload (larger than a typical single BLE MTU) intact",
    run: async () => {
      const pair = await makeConnectedPair();
      try {
        // ~5KB, matching this codebase's documented MetadataToken size
        // budget (SPEC.md §3.1) — this suite runs over every transport,
        // BLE included, so it deliberately exercises a payload big enough
        // to require chunking/reassembly under a small MTU, without this
        // port-level suite knowing anything about MTUs itself.
        const payload = new Uint8Array(5_000).map((_, i) => i % 256);
        await pair.a.send(pair.addressB, payload);
        const received = await pair.b.receive();
        assertBytesEqual(received.message, payload, "large payload was not carried intact");
      } finally {
        await teardown(pair);
      }
    },
  });

  return cases;
}
