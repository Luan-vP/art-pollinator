/**
 * InMemorySignatureVerifierPort — a `SignatureVerifierPort` fake with no
 * real cryptography underneath, matching `InMemoryIdentityPort`'s
 * deterministic "fake signature" scheme exactly: `sign(data)` there produces
 * `utf8("fake-signature:" + id + ":") + data`, and the fake public key for
 * an identity is `utf8("fake-public-key:" + id)`. This fake recovers `id`
 * from `publicKey`, reconstructs the expected fake signature for `message`,
 * and compares bytes — so a `core`-only test can sign with
 * `InMemoryIdentityPort` and verify with this fake and exercise the full
 * "tampered message/signature fails, correct one passes" logic without any
 * real Ed25519 implementation (that lives in `adapters/identity-node`,
 * issue #57/#58's real crypto).
 */
import type { SignatureVerifierPort } from "../signature-verifier-port.js";

const PUBLIC_KEY_PREFIX = "fake-public-key:";
const SIGNATURE_PREFIX = "fake-signature:";

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

function bytesToUtf8(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  while (i < bytes.length) {
    const byte0 = bytes[i];
    if (byte0 === undefined) break;
    if (byte0 <= 0x7f) {
      result += String.fromCodePoint(byte0);
      i += 1;
    } else if ((byte0 & 0xe0) === 0xc0) {
      const byte1 = bytes[i + 1] ?? 0;
      result += String.fromCodePoint(((byte0 & 0x1f) << 6) | (byte1 & 0x3f));
      i += 2;
    } else if ((byte0 & 0xf0) === 0xe0) {
      const byte1 = bytes[i + 1] ?? 0;
      const byte2 = bytes[i + 2] ?? 0;
      result += String.fromCodePoint(
        ((byte0 & 0x0f) << 12) | ((byte1 & 0x3f) << 6) | (byte2 & 0x3f),
      );
      i += 3;
    } else {
      const byte1 = bytes[i + 1] ?? 0;
      const byte2 = bytes[i + 2] ?? 0;
      const byte3 = bytes[i + 3] ?? 0;
      result += String.fromCodePoint(
        ((byte0 & 0x07) << 18) | ((byte1 & 0x3f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f),
      );
      i += 4;
    }
  }
  return result;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class InMemorySignatureVerifierPort implements SignatureVerifierPort {
  verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
    const publicKeyText = bytesToUtf8(publicKey);
    if (!publicKeyText.startsWith(PUBLIC_KEY_PREFIX)) {
      return false; // not a fake public key this verifier understands
    }
    const id = publicKeyText.slice(PUBLIC_KEY_PREFIX.length);
    const expectedPrefix = utf8Bytes(`${SIGNATURE_PREFIX}${id}:`);
    if (signature.length < expectedPrefix.length) {
      return false;
    }
    const actualPrefix = signature.slice(0, expectedPrefix.length);
    const actualMessage = signature.slice(expectedPrefix.length);
    return bytesEqual(actualPrefix, expectedPrefix) && bytesEqual(actualMessage, message);
  }
}
