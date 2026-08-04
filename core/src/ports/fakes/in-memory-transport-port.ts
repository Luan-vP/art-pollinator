/**
 * InMemoryTransportPort — a `TransportPort` fake with no real network
 * underneath. Two instances are wired together with
 * {@link createInMemoryTransportPair} to simulate a two-device swap in a
 * single process (issue #18, IMPLEMENTATION.md Phase 1a item 18).
 *
 * `receive()` never polls or uses a timer: a message that arrives before
 * `receive()` is called is queued in an inbox; a `receive()` call with an
 * empty inbox registers a waiting resolver that `send()` (on the *other*
 * end of the pair) fulfils directly. This keeps the fake fully
 * synchronous-under-the-hood and deterministic under test, with no ambient
 * timing dependency (AGENTS.md §5).
 */
import type { PeerAddress, TransportPort } from "../transport-port.js";

interface InboundMessage {
  readonly from: PeerAddress;
  readonly message: Uint8Array;
}

export class InMemoryTransportPort implements TransportPort {
  private readonly inbox: InboundMessage[] = [];
  private readonly waiters: ((message: InboundMessage) => void)[] = [];
  private peer: { address: PeerAddress; port: InMemoryTransportPort } | undefined;

  constructor(private readonly selfAddress: PeerAddress) {}

  /**
   * Wire this transport to another in-memory transport so each can `send`
   * to the other. Call symmetrically on both sides (see
   * {@link createInMemoryTransportPair}) before using either.
   */
  connectTo(peerAddress: PeerAddress, peerPort: InMemoryTransportPort): void {
    this.peer = { address: peerAddress, port: peerPort };
  }

  send(peer: PeerAddress, message: Uint8Array): Promise<void> {
    if (!this.peer || this.peer.address.id !== peer.id) {
      return Promise.reject(
        new Error(
          `InMemoryTransportPort("${this.selfAddress.id}"): not connected to peer "${peer.id}" — call connectTo() first`,
        ),
      );
    }
    this.peer.port.deliver(this.selfAddress, message);
    return Promise.resolve();
  }

  receive(): Promise<InboundMessage> {
    const queued = this.inbox.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  disconnect(_peer: PeerAddress): Promise<void> {
    this.peer = undefined;
    return Promise.resolve();
  }

  private deliver(from: PeerAddress, message: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ from, message });
    } else {
      this.inbox.push({ from, message });
    }
  }
}

/**
 * Create two `InMemoryTransportPort`s already wired to deliver to one
 * another — the natural shape of an in-memory fake for a port whose whole
 * job is "move bytes to and from an addressed peer": a single instance in
 * isolation has no peer to talk to.
 */
export function createInMemoryTransportPair(
  addressA: PeerAddress,
  addressB: PeerAddress,
): { readonly a: InMemoryTransportPort; readonly b: InMemoryTransportPort } {
  const a = new InMemoryTransportPort(addressA);
  const b = new InMemoryTransportPort(addressB);
  a.connectTo(addressB, b);
  b.connectTo(addressA, a);
  return { a, b };
}
