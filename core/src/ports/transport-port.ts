/**
 * TransportPort — send and receive swap-protocol messages with a peer.
 *
 * SPEC.md §6.2: "The message schema is transport-agnostic — identical over
 * BLE and HTTP." `core` only needs to move opaque bytes to and from an
 * addressed peer; the actual swap protocol message schema (versioning,
 * framing, negotiation) is a later, separate design (issue #22) layered on
 * top of this port, not part of it. Deliberately has **no** BLE- or
 * HTTP-specific concept anywhere (no characteristic UUIDs, no HTTP
 * status codes) — those belong entirely to the adapters that implement
 * this (`BleTransportAdapter`, `HttpTransportAdapter`, per AGENTS.md §5
 * naming), never to the interface itself (AGENTS.md §2 rule 3).
 */

/**
 * Opaque, transport-specific peer identifier (a BLE device id, a
 * `host:port` pair, etc). `core` never inspects or parses this — it is only
 * ever handed back to the same `TransportPort` that produced it.
 */
export interface PeerAddress {
  readonly id: string;
}

export interface TransportPort {
  /**
   * Send a message to a specific peer. Resolves once the transport has
   * accepted the message for delivery — this is not a delivery guarantee,
   * and callers that need one (e.g. the swap state machine) handle
   * acknowledgement at a higher layer.
   */
  send(peer: PeerAddress, message: Uint8Array): Promise<void>;

  /** Await the next inbound message from any connected peer. */
  receive(): Promise<{ readonly from: PeerAddress; readonly message: Uint8Array }>;

  /** Release any transport-level connection state held for a peer (e.g. at the end of a swap). */
  disconnect(peer: PeerAddress): Promise<void>;
}
