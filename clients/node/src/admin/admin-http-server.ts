/**
 * AdminHttpServer — the driving HTTP surface for `AdminService` (issue #50).
 *
 * ## Why a separate, localhost-only HTTP server rather than a CLI subcommand
 *
 * `clients/node`'s entry point (`src/index.ts`) is a single long-lived
 * process with no interactive stdin loop — a CLI subcommand model would
 * mean either running a *second* short-lived process that has to reach the
 * long-lived one somehow (itself needing an IPC mechanism — right back to
 * "some kind of local server"), or accepting commands on the long-lived
 * process's own stdin, which doesn't compose with how this process is
 * actually run today (`npm run start`, or spawned as a detached service —
 * see `src/index.ts`'s doc comment on how the e2e test spawns it). A tiny
 * HTTP surface is the more natural fit for a headless server, is trivially
 * scriptable (`curl`), and is exactly how this same codebase already
 * exposes the *public* swap surface (`HttpTransportServer`) — same
 * technology, deliberately narrower trust boundary.
 *
 * ## Why bound to `127.0.0.1` unconditionally, ignoring the node's configured host
 *
 * `HttpTransportServer` (the public swap port) binds to whatever host the
 * operator configures (`0.0.0.0` by default — SPEC.md §4's node is meant to
 * be reachable on the LAN). Admin operations — viewing the whole library,
 * changing capacity, issuing takedowns — must never be reachable from
 * anywhere on that same LAN merely because the swap port is. This server
 * always binds `127.0.0.1` regardless of `NodeServerConfig.host`, so
 * reaching it at all requires a shell on the node's own machine (or an SSH
 * tunnel an operator sets up deliberately) — no authentication scheme was
 * layered on top of it for that reason: the bind address *is* the access
 * control, the same trust boundary an admin socket/Unix socket would give,
 * implemented as loopback-only HTTP for simplicity and testability.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AdminService } from "@art-pollinator/app";

export interface AdminHttpServerOptions {
  readonly admin: AdminService;
  /** When this process started (`Date.now()` at startup) — used to compute `/health`'s `uptimeSeconds`. */
  readonly processStartedAtEpochMs: number;
  /** `true` if the public swap listener (`HttpTransportServer`) is currently up — surfaced by `/health` (issue #52's "listener status"). */
  readonly isTransportListening: () => boolean;
}

export class AdminHttpServer {
  private readonly server: Server;
  private readonly admin: AdminService;
  private readonly processStartedAtEpochMs: number;
  private readonly isTransportListening: () => boolean;

  constructor(options: AdminHttpServerOptions) {
    this.admin = options.admin;
    this.processStartedAtEpochMs = options.processStartedAtEpochMs;
    this.isTransportListening = options.isTransportListening;
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((error: unknown) => {
        res.writeHead(500).end(String(error));
      });
    });
  }

  /** Always binds `127.0.0.1` — see this file's doc comment. `port` defaults to an ephemeral OS-assigned one (tests, and any deployment that doesn't need a fixed admin port). */
  listen(port = 0): Promise<{ readonly port: number; readonly baseUrl: string }> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, "127.0.0.1", () => {
        this.server.removeListener("error", reject);
        const address = this.server.address() as AddressInfo;
        resolve({ port: address.port, baseUrl: `http://127.0.0.1:${String(address.port)}` });
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
      this.server.closeAllConnections();
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      const snapshot = this.admin.getLibrarySnapshot();
      writeJson(res, 200, {
        status: "ok",
        uptimeSeconds: (Date.now() - this.processStartedAtEpochMs) / 1000,
        librarySize: snapshot.totalItems,
        listening: this.isTransportListening(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/library") {
      writeJson(res, 200, {
        snapshot: this.admin.getLibrarySnapshot(),
        entries: this.admin.listLibraryEntries(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/security") {
      const status = this.admin.getSecurityStatus();
      writeJson(res, status ? 200 : 404, status ?? { error: "no security status wired" });
      return;
    }

    if (req.method === "POST" && url.pathname === "/capacity") {
      const body = await readJsonBody(req);
      if (
        typeof body !== "object" ||
        body === null ||
        typeof (body as { maxLockableSlots?: unknown }).maxLockableSlots !== "number" ||
        typeof (body as { swappableSlots?: unknown }).swappableSlots !== "number"
      ) {
        writeJson(res, 400, {
          error: "body must be { maxLockableSlots: number, swappableSlots: number }",
        });
        return;
      }
      const { maxLockableSlots, swappableSlots } = body as {
        maxLockableSlots: number;
        swappableSlots: number;
      };
      const result = this.admin.setCapacity({ maxLockableSlots, swappableSlots });
      writeJson(res, result.ok ? 200 : 422, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/revocations") {
      writeJson(res, 200, { revocations: await this.admin.listRevocations() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/revoke") {
      const body = await readJsonBody(req);
      const contentHash = (body as { contentHash?: unknown } | null)?.contentHash;
      if (typeof contentHash !== "string" || contentHash.length === 0) {
        writeJson(res, 400, { error: "body must be { contentHash: string }" });
        return;
      }
      const entry = await this.admin.revokeContent(contentHash);
      writeJson(res, 200, { revoked: entry });
      return;
    }

    res.writeHead(404).end();
  }
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.length === 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    req.on("error", reject);
  });
}
