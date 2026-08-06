/**
 * `HttpTransportClient` <-> `HttpTransportServer` authentication (issue
 * #49) — proving the *client's* handshake implementation actually
 * interoperates with the *server's*, not just each tested in isolation
 * against raw `fetch` calls (see `http-transport-server-security.test.ts`
 * for that half).
 */
import { afterEach, describe, expect, it } from "vitest";
import * as nodeCrypto from "node:crypto";
import {
  hexEncode,
  type DeviceIdentity,
  type IdentityPort,
  type SignatureVerifierPort,
} from "@art-pollinator/core";
import { HttpTransportServer } from "./http-transport-server.js";
import { HttpTransportClient } from "./http-transport-client.js";

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

/** A minimal real-Ed25519-backed `IdentityPort`, standing in for `adapters/identity-node`'s `NodeIdentityAdapter` without that package's filesystem persistence — this package (`transport-http`) must not depend on `identity-node` (adapters never depend on sibling adapters). */
class TestIdentity implements IdentityPort {
  private readonly keyPair = nodeCrypto.generateKeyPairSync("ed25519");

  getCurrentIdentity(): Promise<DeviceIdentity> {
    const jwk = this.keyPair.publicKey.export({ format: "jwk" });
    const publicKey = new Uint8Array(Buffer.from(jwk.x as string, "base64url"));
    return Promise.resolve({ id: `test:${hexEncode(publicKey)}`, publicKey });
  }

  sign(data: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(
      new Uint8Array(nodeCrypto.sign(null, Buffer.from(data), this.keyPair.privateKey)),
    );
  }

  rotateIdentity(): Promise<DeviceIdentity> {
    return this.getCurrentIdentity();
  }
}

let server: HttpTransportServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close().catch(() => undefined);
    server = undefined;
  }
});

describe("HttpTransportClient authenticates against a security-configured HttpTransportServer (issue #49)", () => {
  it("a client with an identity authenticates automatically and its swap-protocol traffic succeeds", async () => {
    const s = new HttpTransportServer({ security: { signatureVerifier: realVerifier } });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const client = new HttpTransportClient({
      selfAddress: { id: "authenticated-client" },
      identity: new TestIdentity(),
    });

    await client.send({ id: baseUrl }, new Uint8Array([1, 2, 3]));
    const received = await s.receive();
    expect(Array.from(received.message)).toEqual([1, 2, 3]);
    expect(s.getSecurityStats().authenticatedPeerCount).toBe(1);
  });

  it("a client with NO identity is rejected by a security-configured server (401 surfaces as a thrown error)", async () => {
    const s = new HttpTransportServer({ security: { signatureVerifier: realVerifier } });
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const client = new HttpTransportClient({ selfAddress: { id: "unauthenticated-client" } }); // no identity
    await expect(client.send({ id: baseUrl }, new Uint8Array([1]))).rejects.toThrow(/HTTP 401/);
  });

  it("a client with an identity works unchanged against a server with no security configured (backward compatible)", async () => {
    const s = new HttpTransportServer(); // no `security` at all
    server = s;
    const { baseUrl } = await s.listen(0, "127.0.0.1");

    const client = new HttpTransportClient({
      selfAddress: { id: "device-a" },
      identity: new TestIdentity(),
    });
    // /handshake/challenge 404s on this server — performHandshake treats
    // that as "nothing to authenticate," not a failure.
    await client.send({ id: baseUrl }, new Uint8Array([9]));
    const received = await s.receive();
    expect(Array.from(received.message)).toEqual([9]);
  });
});
