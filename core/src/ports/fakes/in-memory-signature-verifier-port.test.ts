import { describe, expect, it } from "vitest";
import { InMemoryIdentityPort } from "./in-memory-identity-port.js";
import { InMemorySignatureVerifierPort } from "./in-memory-signature-verifier-port.js";

describe("InMemorySignatureVerifierPort", () => {
  it("verifies a signature produced by InMemoryIdentityPort for the same identity and data", async () => {
    const identity = new InMemoryIdentityPort("device-1");
    const verifier = new InMemorySignatureVerifierPort();
    const current = await identity.getCurrentIdentity();
    const data = new Uint8Array([1, 2, 3]);
    const signature = await identity.sign(data);

    expect(verifier.verify(current.publicKey, data, signature)).toBe(true);
  });

  it("rejects a tampered message (one byte changed)", async () => {
    const identity = new InMemoryIdentityPort("device-1");
    const verifier = new InMemorySignatureVerifierPort();
    const current = await identity.getCurrentIdentity();
    const data = new Uint8Array([1, 2, 3]);
    const signature = await identity.sign(data);

    const tamperedData = new Uint8Array([1, 2, 4]); // last byte changed
    expect(verifier.verify(current.publicKey, tamperedData, signature)).toBe(false);
  });

  it("rejects a tampered signature (one byte changed)", async () => {
    const identity = new InMemoryIdentityPort("device-1");
    const verifier = new InMemorySignatureVerifierPort();
    const current = await identity.getCurrentIdentity();
    const data = new Uint8Array([1, 2, 3]);
    const signature = await identity.sign(data);

    const tampered = new Uint8Array(signature);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(verifier.verify(current.publicKey, data, tampered)).toBe(false);
  });

  it("rejects a signature verified against a different identity's public key", async () => {
    const identityA = new InMemoryIdentityPort("device-a");
    const identityB = new InMemoryIdentityPort("device-b");
    const verifier = new InMemorySignatureVerifierPort();
    const data = new Uint8Array([9, 9, 9]);
    const signatureFromA = await identityA.sign(data);
    const publicKeyB = (await identityB.getCurrentIdentity()).publicKey;

    expect(verifier.verify(publicKeyB, data, signatureFromA)).toBe(false);
  });

  it("rejects an empty signature", async () => {
    const identity = new InMemoryIdentityPort("device-1");
    const verifier = new InMemorySignatureVerifierPort();
    const current = await identity.getCurrentIdentity();
    expect(verifier.verify(current.publicKey, new Uint8Array([1]), new Uint8Array())).toBe(false);
  });
});
