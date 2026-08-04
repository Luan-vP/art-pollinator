import { describe, expect, it } from "vitest";
import { InMemoryIdentityPort } from "./in-memory-identity-port.js";

describe("InMemoryIdentityPort", () => {
  it("getCurrentIdentity returns the identity it was constructed with", async () => {
    const identity = new InMemoryIdentityPort("device-1");
    const current = await identity.getCurrentIdentity();
    expect(current.id).toBe("device-1");
    expect(current.publicKey).toBeInstanceOf(Uint8Array);
    expect(current.publicKey.length).toBeGreaterThan(0);
  });

  it("sign is deterministic for the same identity and input", async () => {
    const identity = new InMemoryIdentityPort("device-1");
    const data = new Uint8Array([1, 2, 3]);
    const first = await identity.sign(data);
    const second = await identity.sign(data);
    expect(first).toEqual(second);
  });

  it("sign produces different output for different input bytes", async () => {
    const identity = new InMemoryIdentityPort("device-1");
    const a = await identity.sign(new Uint8Array([1]));
    const b = await identity.sign(new Uint8Array([2]));
    expect(a).not.toEqual(b);
  });

  it("rotateIdentity produces a new identity distinct from the previous one", async () => {
    const identity = new InMemoryIdentityPort("device-1");
    const before = await identity.getCurrentIdentity();
    const after = await identity.rotateIdentity();
    expect(after.id).not.toBe(before.id);
    await expect(identity.getCurrentIdentity()).resolves.toEqual(after);
  });

  it("sign reflects rotation: signing the same data before and after rotation differs", async () => {
    const identity = new InMemoryIdentityPort("device-1");
    const data = new Uint8Array([7, 7, 7]);
    const beforeRotation = await identity.sign(data);
    await identity.rotateIdentity();
    const afterRotation = await identity.sign(data);
    expect(beforeRotation).not.toEqual(afterRotation);
  });
});
