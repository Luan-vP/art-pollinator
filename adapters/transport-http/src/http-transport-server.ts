/**
 * HttpTransportServer — the listening side of the HTTP `TransportPort`
 * (issue #43). Realistically this is the stationary Wi-Fi node's role
 * (Phase 2) — the side of a swap that can be dialled into. Backed by a real
 * `node:http` server; nothing here is mocked.
 *
 * ## Protocol: two real HTTP routes carry `TransportPort`'s bidirectional
 * send/receive shape over a fundamentally request/response transport
 *
 * - `POST /messages` (header `x-peer-id: <senderId>`, body = raw wire
 *   bytes): a peer delivering a message *to* this server. The body is
 *   queued for this server's own `receive()` and the response is `204` —
 *   this route never itself carries a reply; that's `GET`'s job.
 * - `GET /messages?peer=<peerId>`: a peer's long-poll for the next message
 *   this server wants to send *to* it (queued by this server's own
 *   `send(peer, message)`). Responds `200` with the message bytes as soon
 *   as one is queued (immediately, if already queued when the request
 *   arrives), or `204` after a bounded wait if none arrives in time — the
 *   client-side counterpart (`HttpTransportClient.receive()`) simply
 *   retries on `204`.
 *
 * This rendezvous — whichever of "a message was queued by `send()`" or "a
 * long-poll request arrived" happens second is what completes the
 * response — is the same shape `core`'s own
 * `InMemoryTransportPort.receive()` uses for its queued-message-or-waiter
 * pattern, just carried over a real socket instead of an in-process queue.
 *
 * `PeerAddress.id` for a client peer is an opaque string (the value the
 * client sends as `x-peer-id`/`?peer=`) — this server never dials a client
 * back on its own initiative; the client's outstanding long-poll is the
 * only path a server-initiated message can travel down, which reflects
 * (isn't a workaround for) HTTP's real
 * client-initiates-every-connection shape.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { PeerAddress, TransportPort } from "@art-pollinator/core";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 25_000;

interface InboundMessage {
  readonly from: PeerAddress;
  readonly message: Uint8Array;
}

interface PendingLongPoll {
  readonly res: ServerResponse;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface HttpTransportServerOptions {
  /** How long a peer's `GET /messages` long-poll waits before a `204` if nothing is queued. Defaults to {@link DEFAULT_LONG_POLL_TIMEOUT_MS}. */
  readonly longPollTimeoutMs?: number;
}

export class HttpTransportServer implements TransportPort {
  private readonly server: Server;
  private readonly longPollTimeoutMs: number;

  private readonly inbox: InboundMessage[] = [];
  private readonly receiveWaiters: ((message: InboundMessage) => void)[] = [];
  private readonly outboundQueueByPeer = new Map<string, Uint8Array[]>();
  private readonly pendingLongPollByPeer = new Map<string, PendingLongPoll>();

  constructor(options: HttpTransportServerOptions = {}) {
    this.longPollTimeoutMs = options.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });
  }

  /** Start listening. Pass `0` (or omit) for an ephemeral port — the resolved value reports which one the OS picked. */
  listen(
    port = 0,
    host = "127.0.0.1",
  ): Promise<{ readonly port: number; readonly baseUrl: string }> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.removeListener("error", reject);
        const address = this.server.address() as AddressInfo;
        resolve({ port: address.port, baseUrl: `http://${host}:${String(address.port)}` });
      });
    });
  }

  /**
   * Stop listening and release the underlying socket. Safe to call once;
   * not part of `TransportPort` itself (that's `disconnect`, which is
   * per-peer).
   *
   * Calls `closeAllConnections()` alongside `close()`: `fetch`'s
   * keep-alive behavior leaves the underlying TCP socket open after a
   * response completes, and plain `server.close()` waits for every such
   * socket to close on its own (Node's default keep-alive timeout) before
   * its callback fires — several seconds of dead time per test otherwise.
   * Force-closing is safe here because `close()` already means "this
   * server is done," not "gracefully wind down while still serving."
   */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      this.server.closeAllConnections();
    });
  }

  send(peer: PeerAddress, message: Uint8Array): Promise<void> {
    const pending = this.pendingLongPollByPeer.get(peer.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingLongPollByPeer.delete(peer.id);
      writeBytes(pending.res, 200, message);
      return Promise.resolve();
    }
    const queue = this.outboundQueueByPeer.get(peer.id) ?? [];
    queue.push(message);
    this.outboundQueueByPeer.set(peer.id, queue);
    return Promise.resolve();
  }

  receive(): Promise<{ readonly from: PeerAddress; readonly message: Uint8Array }> {
    const queued = this.inbox.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      this.receiveWaiters.push(resolve);
    });
  }

  disconnect(peer: PeerAddress): Promise<void> {
    this.outboundQueueByPeer.delete(peer.id);
    const pending = this.pendingLongPollByPeer.get(peer.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingLongPollByPeer.delete(peer.id);
      writeBytes(pending.res, 204, new Uint8Array(0));
    }
    return Promise.resolve();
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "POST" && url.pathname === "/messages") {
      this.handlePost(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/messages") {
      this.handleLongPoll(url, res);
      return;
    }
    res.writeHead(404).end();
  }

  private handlePost(req: IncomingMessage, res: ServerResponse): void {
    const fromId = req.headers["x-peer-id"];
    if (typeof fromId !== "string" || fromId.length === 0) {
      res.writeHead(400).end("missing x-peer-id header");
      return;
    }
    readBody(req)
      .then((message) => {
        const inbound: InboundMessage = { from: { id: fromId }, message };
        const waiter = this.receiveWaiters.shift();
        if (waiter) {
          waiter(inbound);
        } else {
          this.inbox.push(inbound);
        }
        res.writeHead(204).end();
      })
      .catch((error: unknown) => {
        res.writeHead(500).end(String(error));
      });
  }

  private handleLongPoll(url: URL, res: ServerResponse): void {
    const peerId = url.searchParams.get("peer");
    if (!peerId) {
      res.writeHead(400).end("missing ?peer=");
      return;
    }
    const queue = this.outboundQueueByPeer.get(peerId);
    const next = queue?.shift();
    if (next) {
      writeBytes(res, 200, next);
      return;
    }
    const timer = setTimeout(() => {
      this.pendingLongPollByPeer.delete(peerId);
      res.writeHead(204).end();
    }, this.longPollTimeoutMs);
    this.pendingLongPollByPeer.set(peerId, { res, timer });
  }
}

function writeBytes(res: ServerResponse, status: number, bytes: Uint8Array): void {
  res.writeHead(status, { "content-type": "application/octet-stream" });
  res.end(Buffer.from(bytes));
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}
