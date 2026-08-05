/**
 * HttpTransportClient — the dial-out side of the HTTP `TransportPort`
 * (issue #43). Uses only `fetch` — no listening socket of its own — so it
 * runs unchanged in `clients/mobile`'s native builds and its web build
 * alike (SPEC.md §8: HTTP transport / LAN discovery are this platform's
 * acquisition path once #43/#44 land).
 *
 * ## Design: one instance, any number of peers — not bound to a single server
 *
 * An earlier version of this class took a single `serverAddress` at
 * construction and rejected `send()` calls to any other peer. That doesn't
 * match `TransportPort`'s actual contract — `send(peer, ...)` takes the
 * peer per call, and `receive()` "await[s] the next inbound message from
 * *any* connected peer" — and it doesn't match how a composition root
 * wants to use this class: **one** long-lived `HttpTransportClient`
 * instance, registered once, that can talk to *whichever* peer
 * `@art-pollinator/discovery-lan` happens to find, exactly like
 * `@art-pollinator/transport-ble`'s `BleTransportAdapter` already does.
 * This class now matches that shape: `send()` starts polling a peer's
 * inbox the first time it's addressed, and `receive()` resolves with the
 * next message from *any* peer currently being polled — a single shared
 * inbox + waiter queue, the same pattern `BleTransportAdapter` and `core`'s
 * `InMemoryTransportPort` both already use.
 *
 * ## How `receive()` gets data with no listening socket
 *
 * Every message this client wants *from* a given peer arrives as the body
 * of a `GET {peer.id}/messages?peer=<selfId>` long-poll request this
 * client itself initiates and keeps re-issuing in the background for as
 * long as that peer is "connected" (i.e., since the last `send()` or
 * `receive()` activity for it, until `disconnect()`) — see
 * `./http-transport-server.ts`'s doc comment for the server-side half of
 * this rendezvous.
 */
import type { PeerAddress, TransportPort } from "@art-pollinator/core";

export interface HttpTransportClientOptions {
  /** This client's own opaque peer id, sent as `x-peer-id` / `?peer=`. */
  readonly selfAddress: PeerAddress;
}

interface InboundMessage {
  readonly from: PeerAddress;
  readonly message: Uint8Array;
}

export class HttpTransportClient implements TransportPort {
  private readonly selfAddress: PeerAddress;
  private readonly inbox: InboundMessage[] = [];
  private readonly waiters: ((message: InboundMessage) => void)[] = [];
  private readonly pollersByPeerId = new Map<string, AbortController>();

  constructor(options: HttpTransportClientOptions) {
    this.selfAddress = options.selfAddress;
  }

  /**
   * Proactively start long-polling `peer` for inbound messages, ahead of
   * the first `send()` — otherwise identical in spirit to
   * `@art-pollinator/transport-ble`'s `BleTransportAdapter.connect()` (not
   * part of `TransportPort` itself, an adapter-specific extra). Needed
   * because `receive()` only aggregates messages from peers this client is
   * *already* polling; without ever calling `send()` or `connect()` for a
   * peer, a message that peer's `send()` queued would have no active
   * poller to deliver it. A no-op if already polling this peer.
   */
  connect(peer: PeerAddress): void {
    this.ensurePolling(peer);
  }

  async send(peer: PeerAddress, message: Uint8Array): Promise<void> {
    this.ensurePolling(peer);
    const response = await fetch(`${peer.id}/messages`, {
      method: "POST",
      headers: {
        "x-peer-id": this.selfAddress.id,
        "content-type": "application/octet-stream",
      },
      body: toArrayBuffer(message),
    });
    if (!response.ok) {
      throw new Error(
        `HttpTransportClient("${this.selfAddress.id}"): send to "${peer.id}" failed with HTTP ${String(response.status)}`,
      );
    }
  }

  receive(): Promise<{ readonly from: PeerAddress; readonly message: Uint8Array }> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  disconnect(peer: PeerAddress): Promise<void> {
    const controller = this.pollersByPeerId.get(peer.id);
    if (controller) {
      controller.abort();
      this.pollersByPeerId.delete(peer.id);
    }
    return Promise.resolve();
  }

  /** Start (if not already running) a background long-poll loop delivering `peer`'s messages into the shared inbox. Idempotent per peer. */
  private ensurePolling(peer: PeerAddress): void {
    if (this.pollersByPeerId.has(peer.id)) return;
    const controller = new AbortController();
    this.pollersByPeerId.set(peer.id, controller);
    void this.pollLoop(peer, controller);
  }

  private async pollLoop(peer: PeerAddress, controller: AbortController): Promise<void> {
    const url = `${peer.id}/messages?peer=${encodeURIComponent(this.selfAddress.id)}`;
    while (!controller.signal.aborted) {
      let response: Response;
      try {
        response = await fetch(url, { method: "GET", signal: controller.signal });
      } catch {
        return; // aborted (disconnect()) or a real network failure — either way, stop this peer's loop rather than spin
      }
      if (controller.signal.aborted) return;
      if (response.status === 204) {
        continue; // long-poll timed out server-side with nothing queued — retry
      }
      if (!response.ok) {
        continue; // transient server error — retry rather than kill the whole loop over one bad response
      }
      const buffer = await response.arrayBuffer();
      this.deliver({ from: peer, message: new Uint8Array(buffer) });
    }
  }

  private deliver(inbound: InboundMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(inbound);
    } else {
      this.inbox.push(inbound);
    }
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}
