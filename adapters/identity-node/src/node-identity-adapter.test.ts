import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PERSON_ROTATION_INTERVAL_MS,
  NodeIdentityAdapter,
} from "./node-identity-adapter.js";
import { NodeSignatureVerifier } from "./node-signature-verifier.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "art-pollinator-identity-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("NodeIdentityAdapter — node mode (persistent)", () => {
  it("generates a real identity with a 32-byte Ed25519 public key on first use", async () => {
    const adapter = new NodeIdentityAdapter({ mode: "node", storageDir: dir });
    const identity = await adapter.getCurrentIdentity();

    expect(identity.publicKey).toBeInstanceOf(Uint8Array);
    expect(identity.publicKey.length).toBe(32); // raw Ed25519 public key length
    expect(identity.id).toMatch(/^ed25519:[0-9a-f]{64}$/);
  });

  it("persists the identity to disk with restrictive file permissions", async () => {
    const adapter = new NodeIdentityAdapter({ mode: "node", storageDir: dir });
    await adapter.getCurrentIdentity();

    const filePath = join(dir, "node-identity.json");
    const stat = statSync(filePath);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
    const contents = JSON.parse(readFileSync(filePath, "utf8")) as { privateKeyJwk: unknown };
    expect(contents.privateKeyJwk).toBeDefined();
  });

  it("is persistent across restarts: a new adapter instance pointed at the same directory loads the same identity", async () => {
    const first = new NodeIdentityAdapter({ mode: "node", storageDir: dir });
    const identityBeforeRestart = await first.getCurrentIdentity();

    const second = new NodeIdentityAdapter({ mode: "node", storageDir: dir });
    const identityAfterRestart = await second.getCurrentIdentity();

    expect(identityAfterRestart.id).toBe(identityBeforeRestart.id);
    expect(identityAfterRestart.publicKey).toEqual(identityBeforeRestart.publicKey);
  });

  it("rotateIdentity is a documented no-op for node mode: it returns the same identity, unchanged", async () => {
    const adapter = new NodeIdentityAdapter({ mode: "node", storageDir: dir });
    const before = await adapter.getCurrentIdentity();
    const afterRotateAttempt = await adapter.rotateIdentity();
    const stillCurrent = await adapter.getCurrentIdentity();

    expect(afterRotateAttempt.id).toBe(before.id);
    expect(stillCurrent.id).toBe(before.id);
  });

  it("does not auto-rotate over time, even with a very short rotation interval configured", async () => {
    const adapter = new NodeIdentityAdapter({
      mode: "node",
      storageDir: dir,
      rotationIntervalMs: 1,
    });
    const before = await adapter.getCurrentIdentity();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = await adapter.getCurrentIdentity();
    expect(after.id).toBe(before.id);
  });
});

describe("NodeIdentityAdapter — person mode (rotating/ephemeral)", () => {
  it("generates a real identity on first use, same shape as node mode", async () => {
    const adapter = new NodeIdentityAdapter({ mode: "person", storageDir: dir });
    const identity = await adapter.getCurrentIdentity();
    expect(identity.publicKey.length).toBe(32);
    expect(identity.id).toMatch(/^ed25519:[0-9a-f]{64}$/);
  });

  it("uses a distinct storage file from node mode (both can coexist in the same directory)", async () => {
    const nodeAdapter = new NodeIdentityAdapter({ mode: "node", storageDir: dir });
    const personAdapter = new NodeIdentityAdapter({ mode: "person", storageDir: dir });
    const nodeIdentity = await nodeAdapter.getCurrentIdentity();
    const personIdentity = await personAdapter.getCurrentIdentity();
    expect(nodeIdentity.id).not.toBe(personIdentity.id);
  });

  it("explicit rotateIdentity always produces a new identity, regardless of elapsed time", async () => {
    const adapter = new NodeIdentityAdapter({ mode: "person", storageDir: dir });
    const before = await adapter.getCurrentIdentity();
    const after = await adapter.rotateIdentity();
    expect(after.id).not.toBe(before.id);
    await expect(adapter.getCurrentIdentity()).resolves.toEqual(after);
  });

  it("auto-rotates once the configured rotation interval has elapsed", async () => {
    const adapter = new NodeIdentityAdapter({
      mode: "person",
      storageDir: dir,
      rotationIntervalMs: 10,
    });
    const before = await adapter.getCurrentIdentity();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = await adapter.getCurrentIdentity();
    expect(after.id).not.toBe(before.id);
  });

  it("does not rotate before the interval has elapsed", async () => {
    const adapter = new NodeIdentityAdapter({
      mode: "person",
      storageDir: dir,
      rotationIntervalMs: 10_000,
    });
    const before = await adapter.getCurrentIdentity();
    const stillBefore = await adapter.getCurrentIdentity();
    expect(stillBefore.id).toBe(before.id);
  });

  it("persists the rotation timestamp across restarts, so a fresh process does not immediately re-rotate", async () => {
    const first = new NodeIdentityAdapter({
      mode: "person",
      storageDir: dir,
      rotationIntervalMs: 10_000,
    });
    const identity = await first.getCurrentIdentity();

    // A brand-new adapter instance (simulating a process restart) pointed
    // at the same directory, with the same generous interval, must not
    // treat the restart itself as a reason to rotate.
    const second = new NodeIdentityAdapter({
      mode: "person",
      storageDir: dir,
      rotationIntervalMs: 10_000,
    });
    const afterRestart = await second.getCurrentIdentity();
    expect(afterRestart.id).toBe(identity.id);
  });

  it("defaults to a 1-hour rotation interval when none is configured", () => {
    expect(DEFAULT_PERSON_ROTATION_INTERVAL_MS).toBe(60 * 60 * 1000);
  });
});

describe("NodeIdentityAdapter + NodeSignatureVerifier — real Ed25519 crypto end to end (issue #58)", () => {
  it("a signature produced by sign() verifies successfully against the matching public key", async () => {
    const adapter = new NodeIdentityAdapter({ mode: "node", storageDir: dir });
    const verifier = new NodeSignatureVerifier();
    const identity = await adapter.getCurrentIdentity();
    const message = new TextEncoder().encode("a piece worth passing on");

    const signature = await adapter.sign(message);

    expect(signature).toBeInstanceOf(Uint8Array);
    expect(signature.length).toBe(64); // raw Ed25519 signature length
    expect(verifier.verify(identity.publicKey, message, signature)).toBe(true);
  });

  it("rejects a tampered message (real crypto, not the core fake)", async () => {
    const adapter = new NodeIdentityAdapter({ mode: "node", storageDir: dir });
    const verifier = new NodeSignatureVerifier();
    const identity = await adapter.getCurrentIdentity();
    const message = new TextEncoder().encode("original content");
    const signature = await adapter.sign(message);

    const tamperedMessage = new TextEncoder().encode("original CONTENT");
    expect(verifier.verify(identity.publicKey, tamperedMessage, signature)).toBe(false);
  });

  it("rejects a tampered signature (real crypto, single flipped byte)", async () => {
    const adapter = new NodeIdentityAdapter({ mode: "node", storageDir: dir });
    const verifier = new NodeSignatureVerifier();
    const identity = await adapter.getCurrentIdentity();
    const message = new TextEncoder().encode("original content");
    const signature = await adapter.sign(message);

    const tampered = new Uint8Array(signature);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(verifier.verify(identity.publicKey, message, tampered)).toBe(false);
  });

  it("rejects a signature verified against a different identity's public key", async () => {
    const adapterA = new NodeIdentityAdapter({ mode: "node", storageDir: join(dir, "a") });
    const adapterB = new NodeIdentityAdapter({ mode: "node", storageDir: join(dir, "b") });
    const verifier = new NodeSignatureVerifier();
    const message = new TextEncoder().encode("shared message");

    const signatureFromA = await adapterA.sign(message);
    const identityB = await adapterB.getCurrentIdentity();

    expect(verifier.verify(identityB.publicKey, message, signatureFromA)).toBe(false);
  });

  it("verifies successfully across a fresh adapter instance loading the persisted key (real restart scenario)", async () => {
    const first = new NodeIdentityAdapter({ mode: "node", storageDir: dir });
    const identity = await first.getCurrentIdentity();
    const message = new TextEncoder().encode("persisted across restart");
    const signature = await first.sign(message);

    // Simulate a process restart: a brand-new adapter instance, same directory.
    const second = new NodeIdentityAdapter({ mode: "node", storageDir: dir });
    const verifier = new NodeSignatureVerifier();
    expect(verifier.verify(identity.publicKey, message, signature)).toBe(true);
    const identityAfterRestart = await second.getCurrentIdentity();
    const signatureAfterRestart = await second.sign(message);
    expect(verifier.verify(identityAfterRestart.publicKey, message, signatureAfterRestart)).toBe(
      true,
    );
  });
});
