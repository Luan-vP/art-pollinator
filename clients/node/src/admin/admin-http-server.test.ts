/**
 * AdminHttpServer (issue #50) — real `node:http` requests against a real
 * `AdminService` wired to real `app`/`core` collaborators, proving the
 * localhost-only admin surface actually drives library/security/moderation
 * operations, and exposes the health endpoint issue #52 asks for.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  InMemoryClockPort,
  InMemoryIdentityPort,
  InMemoryMetadataRepositoryPort,
  InMemoryRevocationLogPort,
  InMemorySecurityStatusPort,
} from "@art-pollinator/core";
import { AdminService, LibraryService } from "@art-pollinator/app";
import { AdminHttpServer } from "./admin-http-server.js";

let server: AdminHttpServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
});

async function startAdminServer(overrides: { admin?: AdminService } = {}): Promise<{
  baseUrl: string;
  admin: AdminService;
}> {
  const libraryService = LibraryService.createEmpty(new InMemoryMetadataRepositoryPort());
  const admin =
    overrides.admin ??
    new AdminService({
      libraryService,
      revocationLog: new InMemoryRevocationLogPort(),
      identity: new InMemoryIdentityPort("node-1"),
      clock: new InMemoryClockPort(1_000),
      maxTotalSlots: 2_000,
      securityStatus: new InMemorySecurityStatusPort({
        activeConnections: 1,
        authenticatedPeerCount: 1,
        rateLimitRejectionCount: 0,
        authFailureCount: 0,
        tlsEnabled: false,
      }),
    });
  const s = new AdminHttpServer({
    admin,
    processStartedAtEpochMs: Date.now() - 5_000,
    isTransportListening: () => true,
  });
  server = s;
  const { baseUrl } = await s.listen(0);
  return { baseUrl, admin };
}

describe("AdminHttpServer (issue #50/#52)", () => {
  it("binds to 127.0.0.1 regardless of what a public listener might bind to", async () => {
    const { baseUrl } = await startAdminServer();
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("GET /health reports uptime, library size, and listener status (issue #52)", async () => {
    const { baseUrl } = await startAdminServer();
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      uptimeSeconds: number;
      librarySize: number;
      listening: boolean;
    };
    expect(body.status).toBe("ok");
    expect(body.uptimeSeconds).toBeGreaterThan(0);
    expect(body.librarySize).toBe(0);
    expect(body.listening).toBe(true);
  });

  it("GET /library reports a snapshot and entries", async () => {
    const { baseUrl } = await startAdminServer();
    const response = await fetch(`${baseUrl}/library`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      snapshot: { totalItems: number };
      entries: unknown[];
    };
    expect(body.snapshot.totalItems).toBe(0);
    expect(body.entries).toEqual([]);
  });

  it("GET /security surfaces the wired SecurityStatusPort", async () => {
    const { baseUrl } = await startAdminServer();
    const response = await fetch(`${baseUrl}/security`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { activeConnections: number };
    expect(body.activeConnections).toBe(1);
  });

  it("POST /capacity applies a valid change", async () => {
    const { baseUrl, admin } = await startAdminServer();
    const response = await fetch(`${baseUrl}/capacity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxLockableSlots: 20, swappableSlots: 180 }),
    });
    expect(response.status).toBe(200);
    expect(admin.getLibrarySnapshot().capacity).toEqual({
      maxLockableSlots: 20,
      swappableSlots: 180,
    });
  });

  it("POST /capacity rejects an out-of-bounds request with 422", async () => {
    const { baseUrl } = await startAdminServer();
    const response = await fetch(`${baseUrl}/capacity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxLockableSlots: 5_000, swappableSlots: 5_000 }),
    });
    expect(response.status).toBe(422);
  });

  it("POST /revoke issues a real revocation and GET /revocations lists it", async () => {
    const { baseUrl } = await startAdminServer();
    const response = await fetch(`${baseUrl}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentHash: "hash-1" }),
    });
    expect(response.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/revocations`);
    const body = (await listResponse.json()) as { revocations: { contentHash: string }[] };
    expect(body.revocations.map((r) => r.contentHash)).toEqual(["hash-1"]);
  });

  it("returns 404 for an unknown route", async () => {
    const { baseUrl } = await startAdminServer();
    const response = await fetch(`${baseUrl}/nonexistent`);
    expect(response.status).toBe(404);
  });
});
