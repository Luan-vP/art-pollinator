/**
 * HttpTransportServer — the listening side of the HTTP `TransportPort`
 * (issue #43). Realistically this is the stationary Wi-Fi node's role
 * (Phase 2) — the side of a swap that can be dialled into. Backed by a real
 * `node:http`/`node:https` server; nothing here is mocked.
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
 *
 * ## `onNewPeer`: an optional hook for a passive listener that wants to react to arrivals
 *
 * A device dialling into this server already knows to call `TransportPort`'s
 * `send`/`receive` because *it* discovered this server (LAN probe, SPEC.md
 * §6.1) and is driving `SwapService.swap()` itself. This server's own side
 * has no symmetric discovery event to key off of — nothing here ever calls
 * `startDiscovery`, since it is the thing being discovered, not the thing
 * discovering — so a composition root that wants to *reciprocate* (run its
 * own `SwapService.swap()` back at whoever just connected, the way a
 * stationary node in SPEC.md §4 must) has no signal to react to without this
 * hook. `onNewPeer(peer)` fires synchronously the first time a `POST
 * /messages` arrives from a given `x-peer-id` this server has not seen
 * before — *before* the message is queued for `receive()`, not instead of
 * queuing it, so a caller that immediately starts its own
 * `swapService.swap({ address: peer, ... }, library)` in response still
 * finds that same message waiting the moment its internal `receive()`
 * call runs (see `clients/node`'s composition root for the real use of
 * this). Optional; omitted, this is a no-op and every existing caller's
 * behaviour is unchanged — this is a purely additive, backward-compatible
 * constructor option (issue #45).
 *
 * ## Security (issue #49) — all opt-in via the `security`/`tls`/
 * `maxBodyBytes`/`maxConcurrentConnections` options, so every pre-existing
 * caller/test that constructs this class without them is completely
 * unaffected
 *
 * - **`security`** turns on connection-level authentication: a challenge-
 *   response handshake (`POST /handshake/challenge`, `POST
 *   /handshake/response`) a peer must complete before `POST`/`GET
 *   /messages` will talk to it, plus two independent rate limiters (one
 *   per remote IP guarding the handshake itself, one per authenticated
 *   identity guarding message throughput) and structured security-event
 *   logging. See `docs/adr/0013-peer-connection-authentication.md` for the
 *   full design and trust-model reasoning — the short version: presenting
 *   *some* valid signature authenticates a connection (even a brand-new,
 *   never-seen identity — SPEC.md §7 permits anonymous rotating
 *   identities), but a connection that never authenticates at all, or
 *   whose handshake fails verification, is rejected outright with `401`.
 * - **`tls`** switches the underlying listener from `node:http` to
 *   `node:https` with the given self-signed certificate — see
 *   `clients/node/src/composition/tls-cert.ts` for how a node generates and
 *   persists one, and `docs/adr/0014-transport-tls-scope.md` for exactly
 *   what trust model this achieves today and what remains a documented gap
 *   (cross-platform client-side pinning).
 * - **`maxBodyBytes`** bounds a single request body, checked incrementally
 *   as bytes stream in — a request exceeding it is aborted (socket
 *   destroyed, `413`) before the rest of the body is even read, so an
 *   oversized payload cannot exhaust memory buffering it.
 * - **`maxConcurrentConnections`** is set directly on the underlying
 *   `node:http`/`node:https` server's own `maxConnections` — Node's
 *   built-in mechanism for refusing (destroying) any connection beyond the
 *   configured count, rather than a hand-rolled counter.
 */
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import * as nodeCrypto from "node:crypto";
import type { AddressInfo } from "node:net";

/** Either flavour of listener this class can wrap — `node:http`'s plain server, or `node:https`'s TLS-terminating one (issue #49's `tls` option). Both expose the same `listen`/`close`/`closeAllConnections`/`maxConnections`/`on("connection", ...)` surface this class actually uses. */
type HttpOrHttpsServer = ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;
import {
  verifyChallengeResponse,
  SlidingWindowRateLimiter,
  type LoggerPort,
  type PeerAddress,
  type SecurityStatusSnapshot,
  type SignatureVerifierPort,
  type TransportPort,
} from "@art-pollinator/core";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 25_000;
/** Generous relative to the ~5 KB token budget and `MAX_OFFER_ITEMS` (core's `ingest-validation.ts`) — bounds a single request body as defense in depth alongside the codec's own per-item size checks (issue #49). */
const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB
const DEFAULT_CHALLENGE_TTL_MS = 30_000;
const DEFAULT_SESSION_TTL_MS = 10 * 60_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_MAX_HANDSHAKE_ATTEMPTS_PER_WINDOW = 30;
const DEFAULT_MAX_MESSAGES_PER_IDENTITY_PER_WINDOW = 120;

interface InboundMessage {
  readonly from: PeerAddress;
  readonly message: Uint8Array;
}

interface PendingLongPoll {
  readonly res: ServerResponse;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PendingChallenge {
  readonly nonce: Uint8Array;
  readonly expiresAtEpochMs: number;
}

interface AuthenticatedSession {
  readonly publicKeyHex: string;
  readonly expiresAtEpochMs: number;
}

export interface HttpTransportServerTlsOptions {
  /** PEM-encoded certificate. */
  readonly cert: string;
  /** PEM-encoded private key. */
  readonly key: string;
}

export interface HttpTransportServerSecurityOptions {
  /** Verifies challenge-response handshake signatures — required to turn authentication on at all. */
  readonly signatureVerifier: SignatureVerifierPort;
  /** Structured security-event emission (issue #52). Omit to skip logging. */
  readonly logger?: LoggerPort;
  /** How long an issued challenge nonce remains valid before it must be re-requested. Defaults to {@link DEFAULT_CHALLENGE_TTL_MS}. */
  readonly challengeTtlMs?: number;
  /** How long a completed handshake's session remains authenticated before `/messages` requires a fresh one. Defaults to {@link DEFAULT_SESSION_TTL_MS}. */
  readonly sessionTtlMs?: number;
  /** Max `/handshake/challenge` requests per remote IP per {@link rateLimitWindowMs}. Defaults to {@link DEFAULT_MAX_HANDSHAKE_ATTEMPTS_PER_WINDOW}. */
  readonly maxHandshakeAttemptsPerWindow?: number;
  /** Max `/messages` POSTs per authenticated identity per {@link rateLimitWindowMs}. Defaults to {@link DEFAULT_MAX_MESSAGES_PER_IDENTITY_PER_WINDOW}. */
  readonly maxMessagesPerIdentityPerWindow?: number;
  /** The trailing window both rate limiters above use. Defaults to {@link DEFAULT_RATE_LIMIT_WINDOW_MS}. */
  readonly rateLimitWindowMs?: number;
  /** Injectable clock, for deterministic tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export interface HttpTransportServerOptions {
  /** How long a peer's `GET /messages` long-poll waits before a `204` if nothing is queued. Defaults to {@link DEFAULT_LONG_POLL_TIMEOUT_MS}. */
  readonly longPollTimeoutMs?: number;
  /** Fires once per never-before-seen `x-peer-id` — see this file's doc comment ("`onNewPeer`: an optional hook..."). Omit for no-op (default; existing behavior unchanged). */
  readonly onNewPeer?: (peer: PeerAddress) => void;
  /** Enables HTTPS with the given self-signed certificate (issue #49). Omit for plain HTTP (default; existing behavior unchanged) — see this file's doc comment on the TLS trust model. */
  readonly tls?: HttpTransportServerTlsOptions;
  /** Bounds a single request body, in bytes. Defaults to {@link DEFAULT_MAX_BODY_BYTES}. */
  readonly maxBodyBytes?: number;
  /** Caps simultaneous open connections via the underlying server's own `maxConnections`. Omit for no cap (default; existing behavior unchanged). */
  readonly maxConcurrentConnections?: number;
  /** Turns on connection-level authentication, rate limiting, and security logging (issue #49). Omit to leave the server unauthenticated (default; existing behavior unchanged — see this file's doc comment for why a production deployment should always set this). */
  readonly security?: HttpTransportServerSecurityOptions;
}

export class HttpTransportServer implements TransportPort {
  private readonly server: HttpOrHttpsServer;
  private readonly longPollTimeoutMs: number;
  private readonly onNewPeer: ((peer: PeerAddress) => void) | undefined;
  private readonly maxBodyBytes: number;
  private readonly tlsEnabled: boolean;
  private readonly security: HttpTransportServerSecurityOptions | undefined;
  private readonly now: () => number;

  private readonly inbox: InboundMessage[] = [];
  private readonly receiveWaiters: ((message: InboundMessage) => void)[] = [];
  private readonly outboundQueueByPeer = new Map<string, Uint8Array[]>();
  private readonly pendingLongPollByPeer = new Map<string, PendingLongPoll>();
  private readonly knownPeerIds = new Set<string>();

  // --- Security state (issue #49) — all unused/empty when `security` is omitted. ---
  private readonly pendingChallengesByPeer = new Map<string, PendingChallenge>();
  private readonly authenticatedSessionsByPeer = new Map<string, AuthenticatedSession>();
  private readonly handshakeRateLimiterByIp: SlidingWindowRateLimiter | undefined;
  private readonly messageRateLimiterByIdentity: SlidingWindowRateLimiter | undefined;
  private activeConnectionCount = 0;
  private rateLimitRejectionCount = 0;
  private authFailureCount = 0;

  constructor(options: HttpTransportServerOptions = {}) {
    this.longPollTimeoutMs = options.longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
    this.onNewPeer = options.onNewPeer;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.tlsEnabled = !!options.tls;
    this.security = options.security;
    this.now = options.security?.now ?? Date.now;

    if (this.security) {
      const windowMs = this.security.rateLimitWindowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS;
      this.handshakeRateLimiterByIp = new SlidingWindowRateLimiter({
        maxEvents:
          this.security.maxHandshakeAttemptsPerWindow ?? DEFAULT_MAX_HANDSHAKE_ATTEMPTS_PER_WINDOW,
        windowMs,
      });
      this.messageRateLimiterByIdentity = new SlidingWindowRateLimiter({
        maxEvents:
          this.security.maxMessagesPerIdentityPerWindow ??
          DEFAULT_MAX_MESSAGES_PER_IDENTITY_PER_WINDOW,
        windowMs,
      });
    }

    const requestHandler = (req: IncomingMessage, res: ServerResponse): void => {
      this.handleRequest(req, res);
    };
    this.server = options.tls
      ? createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, requestHandler)
      : createHttpServer(requestHandler);

    if (options.maxConcurrentConnections !== undefined) {
      this.server.maxConnections = options.maxConcurrentConnections;
    }
    this.server.on("connection", (socket) => {
      this.activeConnectionCount++;
      socket.on("close", () => {
        this.activeConnectionCount = Math.max(0, this.activeConnectionCount - 1);
      });
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
        const scheme = this.tlsEnabled ? "https" : "http";
        resolve({ port: address.port, baseUrl: `${scheme}://${host}:${String(address.port)}` });
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
    // Forget this peer so a later reconnection is treated as new again —
    // `onNewPeer` fires once per *episode* of contact, not once ever, so a
    // composition root's reactive swap-on-connect glue (`clients/node`) runs
    // again for a peer that comes back after actually disconnecting.
    this.knownPeerIds.delete(peer.id);
    this.authenticatedSessionsByPeer.delete(peer.id);
    return Promise.resolve();
  }

  /** A read-only snapshot of current connection/authentication/rate-limit state (issue #49/#50/#52) — the concrete data behind `core`'s `SecurityStatusPort`, wrapped by the node composition root. */
  getSecurityStats(): SecurityStatusSnapshot {
    return {
      activeConnections: this.activeConnectionCount,
      authenticatedPeerCount: this.authenticatedSessionsByPeer.size,
      rateLimitRejectionCount: this.rateLimitRejectionCount,
      authFailureCount: this.authFailureCount,
      tlsEnabled: this.tlsEnabled,
    };
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (this.security) {
      if (req.method === "POST" && url.pathname === "/handshake/challenge") {
        this.handleHandshakeChallenge(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/handshake/response") {
        this.handleHandshakeResponse(req, res);
        return;
      }
    }

    if (req.method === "POST" && url.pathname === "/messages") {
      this.handlePost(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/messages") {
      this.handleLongPoll(req, url, res);
      return;
    }
    res.writeHead(404).end();
  }

  // --- Authentication handshake (issue #49) ---

  private handleHandshakeChallenge(req: IncomingMessage, res: ServerResponse): void {
    const security = this.security;
    if (!security) return; // unreachable — only routed here when `security` is set
    const peerId = req.headers["x-peer-id"];
    if (typeof peerId !== "string" || peerId.length === 0) {
      res.writeHead(400).end("missing x-peer-id header");
      return;
    }

    const ip = remoteIp(req);
    const decision = this.handshakeRateLimiterByIp?.recordAndCheck(ip, this.now());
    if (decision && !decision.allowed) {
      this.rateLimitRejectionCount++;
      security.logger?.log({ event: "security.rate_limited", scope: "handshake", ip, peerId });
      res.writeHead(429).end("too many handshake attempts");
      return;
    }

    const nonce = nodeCrypto.randomBytes(32);
    const expiresAtEpochMs = this.now() + (security.challengeTtlMs ?? DEFAULT_CHALLENGE_TTL_MS);
    this.pendingChallengesByPeer.set(peerId, { nonce, expiresAtEpochMs });
    writeJson(res, 200, { nonce: Buffer.from(nonce).toString("hex") });
  }

  private handleHandshakeResponse(req: IncomingMessage, res: ServerResponse): void {
    const security = this.security;
    if (!security) return; // unreachable — only routed here when `security` is set
    const peerId = req.headers["x-peer-id"];
    if (typeof peerId !== "string" || peerId.length === 0) {
      res.writeHead(400).end("missing x-peer-id header");
      return;
    }

    readBody(req, this.maxBodyBytes)
      .then((bodyBytes) => {
        const pending = this.pendingChallengesByPeer.get(peerId);
        if (!pending || pending.expiresAtEpochMs < this.now()) {
          this.authFailureCount++;
          security.logger?.log({
            event: "security.auth_rejected",
            peerId,
            reason: "no valid challenge pending",
          });
          res.writeHead(401).end("no valid challenge pending — request one first");
          return;
        }
        // Single-use: consumed regardless of outcome, so a captured
        // response cannot be replayed against a future challenge for the
        // same peer id (issue #49's replay-attack concern).
        this.pendingChallengesByPeer.delete(peerId);

        let body: { publicKey?: unknown; signature?: unknown };
        try {
          body = JSON.parse(bodyToUtf8(bodyBytes)) as { publicKey?: unknown; signature?: unknown };
        } catch {
          this.authFailureCount++;
          res.writeHead(400).end("malformed handshake response body");
          return;
        }
        if (typeof body.publicKey !== "string" || typeof body.signature !== "string") {
          this.authFailureCount++;
          res
            .writeHead(400)
            .end("handshake response must carry { publicKey, signature } as hex strings");
          return;
        }

        const result = verifyChallengeResponse(
          pending.nonce,
          body.publicKey,
          body.signature,
          security.signatureVerifier,
        );
        if (!result.ok) {
          this.authFailureCount++;
          security.logger?.log({ event: "security.auth_rejected", peerId, reason: result.reason });
          res.writeHead(401).end(`handshake failed: ${result.reason ?? "unknown"}`);
          return;
        }

        const expiresAtEpochMs = this.now() + (security.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS);
        this.authenticatedSessionsByPeer.set(peerId, {
          publicKeyHex: body.publicKey,
          expiresAtEpochMs,
        });
        security.logger?.log({
          event: "security.auth_succeeded",
          peerId,
          publicKey: body.publicKey,
        });
        writeJson(res, 200, { ok: true });
      })
      .catch((error: BodyTooLargeError | unknown) => {
        if (error instanceof BodyTooLargeError) {
          res.writeHead(413).end("handshake response body too large");
          return;
        }
        res.writeHead(500).end(String(error));
      });
  }

  /** `true` if `peerId` currently holds a valid (unexpired) authenticated session. Always `true` when `security` is not configured — authentication is opt-in (see this file's doc comment). */
  private isAuthenticated(peerId: string): boolean {
    if (!this.security) return true;
    const session = this.authenticatedSessionsByPeer.get(peerId);
    if (!session) return false;
    if (session.expiresAtEpochMs < this.now()) {
      this.authenticatedSessionsByPeer.delete(peerId);
      return false;
    }
    return true;
  }

  // --- Message routes (existing behavior, now gated by authentication + rate limiting when `security` is configured) ---

  private handlePost(req: IncomingMessage, res: ServerResponse): void {
    const fromId = req.headers["x-peer-id"];
    if (typeof fromId !== "string" || fromId.length === 0) {
      res.writeHead(400).end("missing x-peer-id header");
      return;
    }

    if (!this.isAuthenticated(fromId)) {
      this.security?.logger?.log({
        event: "security.auth_rejected",
        peerId: fromId,
        reason: "unauthenticated /messages POST",
      });
      res
        .writeHead(401)
        .end(
          "authentication required — complete /handshake/challenge and /handshake/response first",
        );
      return;
    }

    if (this.security && this.messageRateLimiterByIdentity) {
      const session = this.authenticatedSessionsByPeer.get(fromId);
      const rateLimitKey = session?.publicKeyHex ?? fromId;
      const decision = this.messageRateLimiterByIdentity.recordAndCheck(rateLimitKey, this.now());
      if (!decision.allowed) {
        this.rateLimitRejectionCount++;
        this.security.logger?.log({
          event: "security.rate_limited",
          scope: "messages",
          peerId: fromId,
          countInWindow: decision.countInWindow,
          limit: decision.limit,
        });
        res.writeHead(429).end("message rate limit exceeded");
        return;
      }
    }

    readBody(req, this.maxBodyBytes)
      .then((message) => {
        if (!this.knownPeerIds.has(fromId)) {
          this.knownPeerIds.add(fromId);
          this.onNewPeer?.({ id: fromId });
        }
        const inbound: InboundMessage = { from: { id: fromId }, message };
        const waiter = this.receiveWaiters.shift();
        if (waiter) {
          waiter(inbound);
        } else {
          this.inbox.push(inbound);
        }
        res.writeHead(204).end();
      })
      .catch((error: BodyTooLargeError | unknown) => {
        if (error instanceof BodyTooLargeError) {
          this.security?.logger?.log({
            event: "security.body_too_large",
            peerId: fromId,
            scope: "messages",
          });
          res.writeHead(413).end("request body exceeds the configured maximum size");
          return;
        }
        res.writeHead(500).end(String(error));
      });
  }

  private handleLongPoll(req: IncomingMessage, url: URL, res: ServerResponse): void {
    const peerId = url.searchParams.get("peer");
    if (!peerId) {
      res.writeHead(400).end("missing ?peer=");
      return;
    }

    if (!this.isAuthenticated(peerId)) {
      // Closes a real hole in the pre-#49 design: without this check,
      // anyone could long-poll `?peer=<victim>` and receive messages meant
      // for a different identity, since `?peer=` was otherwise a bare,
      // self-asserted string with no proof of control over it.
      this.security?.logger?.log({
        event: "security.auth_rejected",
        peerId,
        reason: "unauthenticated /messages long-poll",
      });
      res
        .writeHead(401)
        .end(
          "authentication required — complete /handshake/challenge and /handshake/response first",
        );
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

class BodyTooLargeError extends Error {}

function writeBytes(res: ServerResponse, status: number, bytes: Uint8Array): void {
  res.writeHead(status, { "content-type": "application/octet-stream" });
  res.end(Buffer.from(bytes));
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function bodyToUtf8(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Read a request body into bytes, aborting (rejecting with
 * {@link BodyTooLargeError}) the moment accumulated size exceeds
 * `maxBytes` — checked incrementally as chunks arrive, not after the fact,
 * so an oversized payload never sits fully buffered in memory first (issue
 * #49's resource-exhaustion defense, at the transport layer, alongside the
 * codec's own per-item size checks).
 */
function readBody(req: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > maxBytes) {
        // Stop accumulating immediately (no further chunk is ever pushed to
        // `chunks`, bounding memory), but deliberately do NOT destroy the
        // socket here — doing so tears down the connection before this
        // side's own `413` response can be written, which surfaces to the
        // client as a raw socket error instead of a clean HTTP rejection.
        // Remaining bytes the client still sends are simply drained and
        // discarded by Node's own stream machinery once nothing consumes
        // `chunks` for them.
        aborted = true;
        reject(new BodyTooLargeError(`request body exceeds ${String(maxBytes)} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!aborted) resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    req.on("error", (error) => {
      if (!aborted) reject(error);
    });
  });
}

/** Best-effort remote IP extraction for the per-connection handshake rate limiter — falls back to a constant when unavailable (e.g. a mocked socket in a unit test), which degrades to "share one bucket," never to a crash. */
function remoteIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}
