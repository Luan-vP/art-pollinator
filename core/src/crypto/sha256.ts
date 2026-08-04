/**
 * SHA-256 — the content hashing primitive behind issue #23.
 *
 * ## Design: hand-rolled in `core`, not `node:crypto` or an npm package
 *
 * See `docs/adr/0008-crypto-primitives-in-a-zero-dependency-core.md` for the
 * full reasoning. Short version: `core` has zero external dependencies and
 * zero I/O (AGENTS.md §2), enforced mechanically by
 * `scripts/check-core-boundaries.mjs` — a bare (non-relative) import of the
 * Node crypto built-in is a lint failure, not a style preference,
 * regardless of how "I/O-adjacent" the module actually is at runtime.
 * SHA-256 itself is a pure, deterministic
 * function of its input bytes (no randomness, no filesystem, no network),
 * and the codebase already has precedent for hand-rolling exactly this kind
 * of self-contained, host-independent primitive rather than reaching for a
 * platform API (`../metadata/metadata-token.ts`'s `utf8ByteLength`,
 * `./bytes.ts`'s `utf8Encode`/`utf8Decode`). A straight port of FIPS 180-4
 * is a few dozen lines and lets `contentHash` (and, later, blob hashing) work
 * identically in a browser, React Native, and Node without a platform check
 * anywhere in `core`.
 *
 * This is *not* the same call as issue #58's signature verification, which
 * stays behind a port (`../ports/signature-verifier-port.ts`) with the real
 * Ed25519 implementation in an adapter — elliptic-curve point arithmetic is
 * meaningfully riskier to hand-roll correctly than a single well-specified
 * hash function, and getting *that* wrong is a security bug, not just a
 * wrong hash. SHA-256 is verified here against the official FIPS 180-4 test
 * vectors (see `./sha256.test.ts`) precisely because "hand-rolled" must not
 * mean "unverified."
 */
import { hexEncode, utf8Encode } from "./bytes.js";

// FIPS 180-4 §4.2.2: the first 32 bits of the fractional parts of the cube
// roots of the first 64 primes.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// FIPS 180-4 §5.3.3: the first 32 bits of the fractional parts of the square
// roots of the first 8 primes.
const INITIAL_HASH = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Pad the message per FIPS 180-4 §5.1.1 and return the 512-bit-block-aligned buffer. */
function padMessage(message: Uint8Array): Uint8Array {
  const bitLength = message.length * 8;
  // 1 byte for 0x80, then zero-pad so length ≡ 56 mod 64, then 8 bytes for
  // the 64-bit big-endian bit length.
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;

  // Bit length as a 64-bit big-endian integer. `bitLength` safely fits in a
  // JS number for any realistic input (tokens/blobs are nowhere near
  // 2^53 bits), so only the low 32 bits are ever non-zero in practice; the
  // high 32 bits are written for correctness regardless.
  const highBits = Math.floor(bitLength / 0x1_0000_0000);
  const lowBits = bitLength >>> 0;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, highBits, false);
  view.setUint32(paddedLength - 4, lowBits, false);
  return padded;
}

/**
 * SHA-256 digest of `message`, per FIPS 180-4. Returns the raw 32-byte
 * digest; use {@link sha256Hex} for the hex string most call sites want.
 */
export function sha256(message: Uint8Array): Uint8Array {
  const padded = padMessage(message);
  const h = INITIAL_HASH.slice();
  const w = new Uint32Array(64);

  for (let blockStart = 0; blockStart < padded.length; blockStart += 64) {
    const view = new DataView(padded.buffer, blockStart, 64);
    for (let t = 0; t < 16; t++) {
      w[t] = view.getUint32(t * 4, false);
    }
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15] ?? 0;
      const w2 = w[t - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = ((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) >>> 0;
    }

    let a = h[0] ?? 0;
    let b = h[1] ?? 0;
    let c = h[2] ?? 0;
    let d = h[3] ?? 0;
    let e = h[4] ?? 0;
    let f = h[5] ?? 0;
    let g = h[6] ?? 0;
    let hh = h[7] ?? 0;

    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + (K[t] ?? 0) + (w[t] ?? 0)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = ((h[0] ?? 0) + a) >>> 0;
    h[1] = ((h[1] ?? 0) + b) >>> 0;
    h[2] = ((h[2] ?? 0) + c) >>> 0;
    h[3] = ((h[3] ?? 0) + d) >>> 0;
    h[4] = ((h[4] ?? 0) + e) >>> 0;
    h[5] = ((h[5] ?? 0) + f) >>> 0;
    h[6] = ((h[6] ?? 0) + g) >>> 0;
    h[7] = ((h[7] ?? 0) + hh) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 8; i++) {
    digestView.setUint32(i * 4, h[i] ?? 0, false);
  }
  return digest;
}

/** SHA-256 digest of `message`, as lowercase hex — the shape `MetadataToken.contentHash` and blob content hashes use. */
export function sha256Hex(message: Uint8Array): string {
  return hexEncode(sha256(message));
}

/** Convenience: SHA-256 digest of UTF-8 text, as lowercase hex. */
export function sha256HexOfText(text: string): string {
  return sha256Hex(utf8Encode(text));
}

/**
 * The content hashing function behind issue #23 — "used for both tokens
 * and blobs." Both are just bytes by the time they reach this function: a
 * blob's raw file bytes, or a token/piece's canonical byte representation.
 * Kept as a named alias (rather than requiring every call site to know it's
 * "just SHA-256 hex") so the algorithm can be swapped in one place later
 * without hunting down every `sha256Hex` call site that means "content
 * hash" specifically.
 */
export const hashContent = sha256Hex;
