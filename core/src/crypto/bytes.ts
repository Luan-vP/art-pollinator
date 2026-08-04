/**
 * Byte/text/hex conversion helpers shared by `core`'s hashing (issue #23),
 * signing/verification (issue #58) and wire codec (issue #24) modules.
 *
 * Hand-rolled rather than `TextEncoder`/`TextDecoder`/`Buffer`: `core`'s
 * `tsconfig.json` sets `types: []` and a `lib` with no DOM/Node globals
 * (see `../metadata/metadata-token.ts`'s `utf8ByteLength` doc comment, and
 * ADR-0006, which hit the same constraint for the placeholder swap codec) —
 * `core` must run identically inside a browser, React Native, and plain
 * Node without depending on which host globals happen to be present. These
 * are the same well-known encode/decode algorithms already duplicated in
 * `app/src/swap/swap-message-codec.ts`; they live here, once, as the shared
 * building block for everything in `core` that needs raw bytes.
 */

/** UTF-8 encode a string to bytes, without relying on `TextEncoder`. */
export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) i++; // consume the low surrogate half of this code point
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

/** UTF-8 decode bytes back to a string, without relying on `TextDecoder`. */
export function utf8Decode(bytes: Uint8Array): string {
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
      const codePoint =
        ((byte0 & 0x07) << 18) | ((byte1 & 0x3f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
      result += String.fromCodePoint(codePoint);
      i += 4;
    }
  }
  return result;
}

const HEX_CHARS = "0123456789abcdef";

/** Lowercase-hex encode bytes — used for `contentHash`, `signature`, and `signerPublicKey` string fields. */
export function hexEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    out += HEX_CHARS[(byte >> 4) & 0xf];
    out += HEX_CHARS[byte & 0xf];
  }
  return out;
}

/** Decode a lowercase- or uppercase-hex string back to bytes. Throws on odd length or non-hex characters. */
export function hexDecode(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hexDecode: hex string must have an even length, got ${String(hex.length)}`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const byteText = hex.slice(i * 2, i * 2 + 2);
    const value = Number.parseInt(byteText, 16);
    if (Number.isNaN(value)) {
      throw new Error(`hexDecode: invalid hex byte "${byteText}" at offset ${String(i * 2)}`);
    }
    bytes[i] = value;
  }
  return bytes;
}
