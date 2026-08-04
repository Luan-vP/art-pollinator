/**
 * InMemoryIdentityPort — an `IdentityPort` fake holding a device identity
 * entirely in memory. No real key generation or cryptography (that is
 * issue #57/#58, cross-cutting, later batches) — `sign` deterministically
 * derives bytes from the current identity and the input so tests can assert
 * on it, and `rotateIdentity` deterministically produces a new identity
 * (no ambient randomness) rather than calling out to any real keystore
 * (issue #18, IMPLEMENTATION.md Phase 1a item 18).
 */
import type { DeviceIdentity, IdentityPort } from "../identity-port.js";

function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) i++;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function fakePublicKeyFor(id: string): Uint8Array {
  return utf8Bytes(`fake-public-key:${id}`);
}

export class InMemoryIdentityPort implements IdentityPort {
  private currentIdentity: DeviceIdentity;
  private rotationCount = 0;

  constructor(initialId: string) {
    this.currentIdentity = { id: initialId, publicKey: fakePublicKeyFor(initialId) };
  }

  getCurrentIdentity(): Promise<DeviceIdentity> {
    return Promise.resolve(this.currentIdentity);
  }

  /**
   * Deterministic fake "signature": the current identity's id, a fixed
   * separator, then the input bytes. Not cryptographically meaningful — it
   * exists so a test can assert a signature changed when the identity
   * rotated, or that two different inputs produce different "signatures,"
   * without `core` depending on a real signing library.
   */
  sign(data: Uint8Array): Promise<Uint8Array> {
    const prefix = utf8Bytes(`fake-signature:${this.currentIdentity.id}:`);
    const result = new Uint8Array(prefix.length + data.length);
    result.set(prefix, 0);
    result.set(data, prefix.length);
    return Promise.resolve(result);
  }

  rotateIdentity(): Promise<DeviceIdentity> {
    this.rotationCount += 1;
    const newId = `${this.currentIdentity.id}#rotated-${String(this.rotationCount)}`;
    this.currentIdentity = { id: newId, publicKey: fakePublicKeyFor(newId) };
    return Promise.resolve(this.currentIdentity);
  }
}
