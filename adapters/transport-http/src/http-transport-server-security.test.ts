/**
 * Security tests for `HttpTransportServer` (issue #49) — real `node:http`/
 * `node:https` sockets throughout, nothing mocked. Covers:
 *
 * - the challenge-response authentication handshake (accept a valid
 *   signature from any keypair — even brand-new — reject an invalid one);
 * - `/messages` and the long-poll `GET /messages` both requiring an
 *   authenticated session once `security` is configured;
 * - rate limiting (handshake attempts per IP, messages per identity);
 * - request-body size enforcement at the transport layer;
 * - a real TLS handshake against a self-signed certificate.
 */
import { afterEach, describe, expect, it } from "vitest";
import * as nodeCrypto from "node:crypto";
import * as https from "node:https";
import { InMemoryLoggerPort, hexEncode, type SignatureVerifierPort } from "@art-pollinator/core";
import { HttpTransportServer } from "./http-transport-server.js";

/** A real Ed25519 `SignatureVerifierPort` via `node:crypto` — this package is Node-only by design (unlike `core`), so real crypto in a test here is normal, matching `adapters/identity-node`'s own approach. */
const realVerifier: SignatureVerifierPort = {
  verify(publicKey, message, signature) {
    try {
      const jwk: nodeCrypto.JsonWebKey = {
        kty: "OKP",
        crv: "Ed25519",
        x: Buffer.from(publicKey).toString("base64url"),
      };
      const keyObject = nodeCrypto.createPublicKey({ key: jwk, format: "jwk" });
      return nodeCrypto.verify(null, Buffer.from(message), keyObject, Buffer.from(signature));
    } catch {
      return false;
    }
  },
};

function generateKeypair(): { publicKeyHex: string; sign: (data: Uint8Array) => string } {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync("ed25519");
  const publicKeyJwk = publicKey.export({ format: "jwk" });
  const publicKeyBytes = new Uint8Array(Buffer.from(publicKeyJwk.x as string, "base64url"));
  return {
    publicKeyHex: hexEncode(publicKeyBytes),
    sign: (data) => hexEncode(new Uint8Array(nodeCrypto.sign(null, Buffer.from(data), privateKey))),
  };
}

/** Perform a real handshake against `baseUrl` for `peerId`, returning nothing — throws if the handshake is rejected. */
async function authenticate(
  baseUrl: string,
  peerId: string,
  keypair: ReturnType<typeof generateKeypair>,
): Promise<Response> {
  const challengeRes = await fetch(`${baseUrl}/handshake/challenge`, {
    method: "POST",
    headers: { "x-peer-id": peerId },
  });
  if (!challengeRes.ok) return challengeRes;
  const { nonce } = (await challengeRes.json()) as { nonce: string };
  const nonceBytes = Buffer.from(nonce, "hex");
  const signature = keypair.sign(new Uint8Array(nonceBytes));

  return fetch(`${baseUrl}/handshake/response`, {
    method: "POST",
    headers: { "x-peer-id": peerId, "content-type": "application/json" },
    body: JSON.stringify({ publicKey: keypair.publicKeyHex, signature }),
  });
}

let server: HttpTransportServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close().catch(() => undefined);
    server = undefined;
  }
});

describe("HttpTransportServer authentication handshake (issue #49)", () => {
  it("accepts a valid handshake from a brand-new keypair (SPEC.md §7 anonymous rotating identities)", async () => {
    const s = new HttpTransportServer({ security: { signatureVerifier: realVerifier } });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const keypair = generateKeypair();
    const response = await authenticate(baseUrl, "fresh-peer", keypair);
    expect(response.status).toBe(200);
    expect(s.getSecurityStats().authenticatedPeerCount).toBe(1);
  });

  it("rejects a handshake response with an invalid signature", async () => {
    const s = new HttpTransportServer({ security: { signatureVerifier: realVerifier } });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const challengeRes = await fetch(`${baseUrl}/handshake/challenge`, {
      method: "POST",
      headers: { "x-peer-id": "bad-actor" },
    });
    expect(challengeRes.status).toBe(200);

    const response = await fetch(`${baseUrl}/handshake/response`, {
      method: "POST",
      headers: { "x-peer-id": "bad-actor", "content-type": "application/json" },
      body: JSON.stringify({ publicKey: "aa".repeat(32), signature: "bb".repeat(64) }),
    });
    expect(response.status).toBe(401);
    expect(s.getSecurityStats().authFailureCount).toBe(1);
    expect(s.getSecurityStats().authenticatedPeerCount).toBe(0);
  });

  it("rejects a handshake response with no prior challenge (never even attempted a valid signature)", async () => {
    const s = new HttpTransportServer({ security: { signatureVerifier: realVerifier } });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const keypair = generateKeypair();
    const response = await fetch(`${baseUrl}/handshake/response`, {
      method: "POST",
      headers: { "x-peer-id": "never-challenged", "content-type": "application/json" },
      body: JSON.stringify({
        publicKey: keypair.publicKeyHex,
        signature: keypair.sign(new Uint8Array([1])),
      }),
    });
    expect(response.status).toBe(401);
  });

  it("a nonce is single-use — replaying the exact same handshake response twice fails the second time", async () => {
    const s = new HttpTransportServer({ security: { signatureVerifier: realVerifier } });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");
    const keypair = generateKeypair();

    const challengeRes = await fetch(`${baseUrl}/handshake/challenge`, {
      method: "POST",
      headers: { "x-peer-id": "replay-peer" },
    });
    const { nonce } = (await challengeRes.json()) as { nonce: string };
    const signature = keypair.sign(new Uint8Array(Buffer.from(nonce, "hex")));
    const body = JSON.stringify({ publicKey: keypair.publicKeyHex, signature });

    const first = await fetch(`${baseUrl}/handshake/response`, {
      method: "POST",
      headers: { "x-peer-id": "replay-peer", "content-type": "application/json" },
      body,
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/handshake/response`, {
      method: "POST",
      headers: { "x-peer-id": "replay-peer", "content-type": "application/json" },
      body,
    });
    expect(second.status).toBe(401);
  });

  it("POST /messages is rejected with 401 for an unauthenticated peer once security is configured", async () => {
    const s = new HttpTransportServer({ security: { signatureVerifier: realVerifier } });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: { "x-peer-id": "stranger" },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(response.status).toBe(401);
  });

  it("POST /messages succeeds once the same peer id has authenticated", async () => {
    const s = new HttpTransportServer({ security: { signatureVerifier: realVerifier } });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");
    const keypair = generateKeypair();
    const authResult = await authenticate(baseUrl, "device-x", keypair);
    expect(authResult.status).toBe(200);

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: { "x-peer-id": "device-x" },
      body: new Uint8Array([9, 9]),
    });
    expect(response.status).toBe(204);
    const received = await s.receive();
    expect(Array.from(received.message)).toEqual([9, 9]);
  });

  it("GET /messages long-poll is rejected for an unauthenticated peer — closing the 'steal another peer's inbox' hole", async () => {
    const s = new HttpTransportServer({
      security: { signatureVerifier: realVerifier },
      longPollTimeoutMs: 500,
    });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const response = await fetch(`${baseUrl}/messages?peer=victim`, { method: "GET" });
    expect(response.status).toBe(401);
  });

  it("unauthenticated behavior is completely unchanged when security is omitted (default, backward compatible)", async () => {
    const s = new HttpTransportServer(); // no `security` option at all
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: { "x-peer-id": "anyone" },
      body: new Uint8Array([1]),
    });
    expect(response.status).toBe(204); // no auth required — matches pre-#49 behavior exactly
  });
});

describe("HttpTransportServer rate limiting (issue #49)", () => {
  it("throttles handshake-challenge requests past the configured per-IP limit", async () => {
    const logger = new InMemoryLoggerPort();
    const s = new HttpTransportServer({
      security: {
        signatureVerifier: realVerifier,
        maxHandshakeAttemptsPerWindow: 2,
        rateLimitWindowMs: 60_000,
        logger,
      },
    });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const first = await fetch(`${baseUrl}/handshake/challenge`, {
      method: "POST",
      headers: { "x-peer-id": "p1" },
    });
    const second = await fetch(`${baseUrl}/handshake/challenge`, {
      method: "POST",
      headers: { "x-peer-id": "p2" },
    });
    const third = await fetch(`${baseUrl}/handshake/challenge`, {
      method: "POST",
      headers: { "x-peer-id": "p3" },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429); // same source IP (loopback) — third request in the window is throttled
    expect(logger.history().some((e) => e.event === "security.rate_limited")).toBe(true);
  });

  it("throttles a flooding authenticated identity's /messages past the configured per-identity limit", async () => {
    const s = new HttpTransportServer({
      security: {
        signatureVerifier: realVerifier,
        maxMessagesPerIdentityPerWindow: 3,
        rateLimitWindowMs: 60_000,
      },
    });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");
    const keypair = generateKeypair();
    await authenticate(baseUrl, "flooder", keypair);

    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const response = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: { "x-peer-id": "flooder" },
        body: new Uint8Array([i]),
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 3)).toEqual([204, 204, 204]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    expect(s.getSecurityStats().rateLimitRejectionCount).toBe(2);
  });
});

describe("HttpTransportServer resource-exhaustion defenses (issue #49)", () => {
  it("rejects an oversized request body at the transport layer, not just the codec layer", async () => {
    const s = new HttpTransportServer({ maxBodyBytes: 1_000 });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const oversized = new Uint8Array(5_000);
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: { "x-peer-id": "big-sender" },
      body: oversized,
    });
    expect(response.status).toBe(413);
  });

  it("accepts a body within the configured limit", async () => {
    const s = new HttpTransportServer({ maxBodyBytes: 1_000 });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: { "x-peer-id": "normal-sender" },
      body: new Uint8Array(500),
    });
    expect(response.status).toBe(204);
  });

  it("caps concurrent connections via the server's own maxConnections", async () => {
    const s = new HttpTransportServer({ maxConcurrentConnections: 1, longPollTimeoutMs: 1_000 });
    server = s;
    await s.listen(0, "127.0.0.1");
    // Node enforces this natively (destroys any connection beyond the cap) —
    // this test only asserts the option is actually threaded through to the
    // underlying server, since exercising the exact destroy-on-overflow
    // timing reliably over `fetch`'s own connection pooling is flaky and
    // not this codebase's mechanism to re-test.
    expect((s as unknown as { server: { maxConnections: number } }).server.maxConnections).toBe(1);
  });
});

describe("HttpTransportServer TLS (issue #49)", () => {
  it("performs a real TLS handshake against a self-signed certificate", async () => {
    // A minimal self-signed cert generated inline via node:crypto + a raw
    // ASN.1-free approach isn't available from node:crypto alone (Node has
    // no built-in X.509 *issuance* API — see docs/adr/0014-transport-tls-scope.md)
    // so this test generates one the same way `clients/node`'s real
    // `tls-cert.ts` does: shelling out to the system `openssl` binary,
    // proving the exact mechanism a real node uses, not a synthetic stand-in.
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const dir = mkdtempSync(join(tmpdir(), "art-pollinator-tls-test-"));
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    try {
      execFileSync("openssl", [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        "/CN=art-pollinator-test-node",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ]);
      const cert = readFileSync(certPath, "utf8");
      const key = readFileSync(keyPath, "utf8");

      const s = new HttpTransportServer({ tls: { cert, key } });
      server = s;
      const { baseUrl, port } = await s.listen(0, "127.0.0.1");
      expect(baseUrl).toMatch(/^https:\/\//);

      // A real TLS client, trusting this specific self-signed cert
      // explicitly (`ca`) rather than disabling verification — the
      // pinned-trust model this transport is designed around (see the ADR).
      const response = await new Promise<{ statusCode: number | undefined }>((resolve, reject) => {
        const req = https.request(
          { host: "127.0.0.1", port, path: "/messages", method: "GET", ca: cert },
          (res) => {
            res.resume();
            res.on("end", () => resolve({ statusCode: res.statusCode }));
          },
        );
        req.on("error", reject);
        req.end();
      });
      // No `?peer=` — expect a 400, but critically the TLS handshake itself
      // succeeded (an untrusted/failed handshake would have rejected before
      // any HTTP response was ever received, surfacing as a socket error).
      expect(response.statusCode).toBe(400);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
