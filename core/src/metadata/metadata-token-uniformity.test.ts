/**
 * Metadata uniformity review (issue #60) — the actual measurement, kept as
 * a runnable test so its conclusions stay checked against the real code,
 * not just asserted once in an ADR and left to rot.
 *
 * SPEC.md §3.1: "Resist filling the budget. Tokens uniform in size and
 * shape are harder to fingerprint as they circulate." This file builds a
 * representative sample of realistic `MetadataToken`s and measures their
 * real serialised sizes (`metadataTokenByteSize`) and real wire sizes
 * (`encodeSwapProtocolMessage`), then asserts the specific numeric
 * conclusions `docs/adr/0016-metadata-uniformity-vs-provenance.md` is
 * built on: provenance (issue #21's hop count) is not a meaningful
 * contributor to size variance, free-text content is, and the wire
 * codec's default bucket-padding collapses the resulting spread into a
 * small number of observable sizes.
 */
import { describe, expect, it } from "vitest";
import { metadataTokenByteSize, type MetadataToken } from "./metadata-token.js";
import {
  DEFAULT_WIRE_PADDING_BLOCK_BYTES,
  encodeSwapProtocolMessage,
} from "../protocol/swap-message-codec.js";
import { createOfferMessage } from "../protocol/swap-message.js";
import { METADATA_TOKEN_MAX_BYTES } from "../constants.js";

function filler(length: number): string {
  const base = "Study for a coastline at dusk, oil and pigment on reclaimed canvas. ";
  let out = "";
  while (out.length < length) out += base;
  return out.slice(0, length);
}

const HASH = "a".repeat(64);
const PUBKEY = "b".repeat(64);
const SIGNATURE = "c".repeat(128);

function baseToken(overrides: Partial<MetadataToken> = {}): MetadataToken {
  return {
    title: "Coastline Study No. 4",
    creator: "R. Alaba",
    description: filler(150),
    provenance: { hopCount: 1 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash: HASH },
    contentHash: HASH,
    signature: "",
    ...overrides,
  };
}

const samples: Array<[string, MetadataToken]> = [
  [
    "minimal: short title, empty description, unsigned",
    baseToken({ title: "Study", description: "" }),
  ],
  ["typical: unsigned", baseToken()],
  ["typical, signed", baseToken({ signature: SIGNATURE, signerPublicKey: PUBKEY })],
  [
    "long title/creator, moderate description, signed",
    baseToken({
      title: filler(120),
      creator: filler(80),
      description: filler(600),
      signature: SIGNATURE,
      signerPublicKey: PUBKEY,
    }),
  ],
  [
    "maximal plausible: long everything, high hop count, bucket pointer, signed",
    baseToken({
      title: filler(150),
      creator: filler(100),
      description: filler(3_500),
      provenance: { hopCount: 47 },
      blobPointer: { scheme: "bucket", contentHash: HASH, bucketRef: `artifacts/${HASH}` },
      signature: SIGNATURE,
      signerPublicKey: PUBKEY,
    }),
  ],
];

describe("metadata uniformity review — realistic sample size variance (issue #60)", () => {
  it("realistic tokens span a wide byte range, dominated by free-text content", () => {
    const sizes = samples.map(([, token]) => metadataTokenByteSize(token));
    const min = Math.min(...sizes);
    const max = Math.max(...sizes);

    // The measured range this review actually found (see the ADR for the
    // full table) — a wide, real spread, not a hypothetical one.
    expect(min).toBeLessThan(400);
    expect(max).toBeGreaterThan(4_000);
    expect(max / min).toBeGreaterThan(10); // at least an order of magnitude

    // Every sample still respects the token's own field-content budget —
    // wire-level padding (below) is a separate, additional concern layered
    // on top, never a substitute for this check.
    for (const size of sizes) {
      expect(size).toBeLessThanOrEqual(METADATA_TOKEN_MAX_BYTES);
    }
  });

  it("provenance (hop count) contributes negligible size variance across any realistic range", () => {
    const sizesByHopCount = [0, 1, 9, 47, 999].map((hopCount) =>
      metadataTokenByteSize(baseToken({ provenance: { hopCount } })),
    );
    const min = Math.min(...sizesByHopCount);
    const max = Math.max(...sizesByHopCount);

    // A handful of bytes at most — the JSON integer growing an extra
    // digit — never a meaningful fraction of the token's overall size.
    expect(max - min).toBeLessThanOrEqual(4);
  });

  it("signed vs. unsigned is a fixed, deterministic step, not per-content variance", () => {
    const unsigned = metadataTokenByteSize(baseToken({ signature: "" }));
    const signed = metadataTokenByteSize(
      baseToken({ signature: SIGNATURE, signerPublicKey: PUBKEY }),
    );
    // A 128-hex-char signature + 64-hex-char public key, plus their JSON
    // quoting/keys — always the same delta regardless of content.
    expect(signed - unsigned).toBe(213);
  });
});

describe("metadata uniformity review — wire-level mitigation (issue #60 / ADR-0016)", () => {
  it("bucket-padding collapses close-in-size tokens into the same wire size, while still separating genuinely different ones", () => {
    // Three descriptions close enough together (within one 256-byte block
    // of each other) that they should collapse into the same wire bucket,
    // plus one much larger one that should not.
    const closeGroup = [150, 180, 210].map((len) => baseToken({ description: filler(len) }));
    const farApart = baseToken({ description: filler(3_500) });

    const rawSizes = new Set(
      [...closeGroup, farApart].map((token) => metadataTokenByteSize(token)),
    );
    const paddedWireSizes = [...closeGroup, farApart].map(
      (token) => encodeSwapProtocolMessage(createOfferMessage([token])).length,
    );

    expect(rawSizes.size).toBe(4); // every raw size is distinct
    expect(new Set(paddedWireSizes).size).toBeLessThan(rawSizes.size); // padding merges the close group
    expect(paddedWireSizes[0]).toBe(paddedWireSizes[1]); // the two closest land in the same bucket
    expect(paddedWireSizes[paddedWireSizes.length - 1]).not.toBe(paddedWireSizes[0]); // the far-apart one does not
    for (const size of paddedWireSizes) {
      expect(size % DEFAULT_WIRE_PADDING_BLOCK_BYTES).toBe(0);
    }
  });

  it("padding overhead is capped at roughly one block width regardless of the message's real size", () => {
    // The `__pad` field itself costs a small, fixed number of bytes (its
    // JSON key/quotes/colon/comma) even when empty, on top of whatever
    // padding characters round the message up to the next block boundary
    // — so the true worst case is "one block width" plus that fixed
    // per-message overhead, not one block width exactly.
    const FIXED_FIELD_OVERHEAD_BYTES = 20;
    for (const [, token] of samples) {
      const message = createOfferMessage([token]);
      const unpadded = encodeSwapProtocolMessage(message, { padToBlockBytes: 0 }).length;
      const padded = encodeSwapProtocolMessage(message).length;
      expect(padded - unpadded).toBeLessThan(
        DEFAULT_WIRE_PADDING_BLOCK_BYTES + FIXED_FIELD_OVERHEAD_BYTES,
      );
      expect(padded).toBeGreaterThanOrEqual(unpadded);
    }
  });
});
