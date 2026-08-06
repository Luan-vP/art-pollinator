import { describe, expect, it } from "vitest";
import {
  decodeSwapProtocolMessage,
  DEFAULT_WIRE_PADDING_BLOCK_BYTES,
  encodeSwapProtocolMessage,
} from "./swap-message-codec.js";
import { utf8Encode } from "../crypto/bytes.js";
import {
  createAcceptMessage,
  createDiscoverAckMessage,
  createOfferMessage,
  createReconcileAckMessage,
  createRevocationMessage,
  createTransferMessage,
  negotiateVersion,
  SWAP_PROTOCOL_VERSION,
  type SwapProtocolMessage,
} from "./swap-message.js";
import type { MetadataToken } from "../metadata/metadata-token.js";
import type { RevocationEntry } from "../security/revocation.js";

function fillerText(length: number): string {
  const base = "Study for a coastline at dusk, oil and pigment on reclaimed canvas. ";
  let out = "";
  while (out.length < length) out += base;
  return out.slice(0, length);
}

function makeToken(overrides: Partial<MetadataToken> = {}): MetadataToken {
  return {
    title: "Coastline Study No. 4",
    creator: "R. Alaba",
    description: fillerText(200),
    provenance: { hopCount: 2 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash: "a".repeat(64) },
    contentHash: "a".repeat(64),
    signature: "",
    ...overrides,
  };
}

/** Round-trip a message through encode -> decode and assert it comes back deep-equal. */
function roundTrip(message: SwapProtocolMessage): SwapProtocolMessage {
  const decoded = decodeSwapProtocolMessage(encodeSwapProtocolMessage(message));
  expect(decoded).toEqual(message);
  return decoded;
}

describe("swap protocol codec — round-trip, one per message kind (issue #22/#24)", () => {
  it("discover-ack round-trips", () => {
    roundTrip(createDiscoverAckMessage("person"));
    roundTrip(createDiscoverAckMessage("node"));
  });

  it("offer round-trips with a realistic set of tokens", () => {
    const items = [
      makeToken({ contentHash: "a".repeat(64) }),
      makeToken({ contentHash: "b".repeat(64) }),
    ];
    roundTrip(createOfferMessage(items));
  });

  it("offer round-trips with zero items (a one-way swap's receiving side offers nothing)", () => {
    roundTrip(createOfferMessage([]));
  });

  it("accept round-trips", () => {
    roundTrip(createAcceptMessage(["a".repeat(64), "b".repeat(64)]));
    roundTrip(createAcceptMessage([])); // nothing accepted
  });

  it("transfer round-trips", () => {
    roundTrip(createTransferMessage([makeToken()]));
  });

  it("reconcile-ack round-trips", () => {
    roundTrip(createReconcileAckMessage(["c".repeat(64)]));
  });

  it("revocation round-trips (issue #51)", () => {
    const entry: RevocationEntry = {
      contentHash: "a".repeat(64),
      revokedAtEpochMs: 12_345,
      signerPublicKey: "cd".repeat(32),
      signature: "ab".repeat(64),
    };
    roundTrip(createRevocationMessage([entry]));
    roundTrip(createRevocationMessage([])); // nothing known yet
  });
});

describe("swap protocol codec — edge cases (issue #24 explicit requirement)", () => {
  it("round-trips a token with an empty optional field (no signerPublicKey, unsigned)", () => {
    const token = makeToken({ signature: "" });
    const decoded = roundTrip(createOfferMessage([token]));
    if (decoded.kind === "offer") {
      expect(decoded.body.items[0]?.signerPublicKey).toBeUndefined();
    }
  });

  it("round-trips a token with signature and signerPublicKey both populated", () => {
    const token = makeToken({ signature: "ab".repeat(64), signerPublicKey: "cd".repeat(32) });
    const decoded = roundTrip(createOfferMessage([token]));
    if (decoded.kind === "offer") {
      expect(decoded.body.items[0]?.signerPublicKey).toBe("cd".repeat(32));
      expect(decoded.body.items[0]?.signature).toBe("ab".repeat(64));
    }
  });

  it("round-trips a token near the ~5 KB size budget", () => {
    const token = makeToken({ description: fillerText(4000) });
    const decoded = roundTrip(createOfferMessage([token]));
    if (decoded.kind === "offer") {
      expect(decoded.body.items[0]?.description).toBe(token.description);
    }
  });

  it("round-trips non-ASCII text (titles, descriptions, creator names) losslessly", () => {
    const token = makeToken({
      title: "日本語アート — 夕暮れの海岸線",
      creator: "Renée Ölafsdóttir 🎨",
      description: "café, naïve, exposé — and some emoji for good measure: 🖼️🌊✨",
    });
    const decoded = roundTrip(createOfferMessage([token]));
    if (decoded.kind === "offer") {
      expect(decoded.body.items[0]).toEqual(token);
    }
  });

  it("round-trips a message regardless of the field construction order used to build it", () => {
    const messageA = createAcceptMessage(["x".repeat(64)]);
    // Construct a structurally-identical message with a different key order.
    const messageB = {
      kind: "accept",
      body: { acceptedContentHashes: ["x".repeat(64)] },
      version: SWAP_PROTOCOL_VERSION,
    } as const;
    expect(encodeSwapProtocolMessage(messageA)).toEqual(encodeSwapProtocolMessage(messageB));
  });
});

describe("swap protocol codec — version handling", () => {
  it("encodes the current SWAP_PROTOCOL_VERSION into every message", () => {
    const message = createAcceptMessage([]);
    expect(message.version).toBe(SWAP_PROTOCOL_VERSION);
  });

  it("rejects decoding a message with an unsupported (future) version", () => {
    const futureVersionBytes = encodeSwapProtocolMessage({
      version: SWAP_PROTOCOL_VERSION + 1,
      kind: "accept",
      body: { acceptedContentHashes: [] },
    } as unknown as SwapProtocolMessage);

    expect(() => decodeSwapProtocolMessage(futureVersionBytes)).toThrow(
      /unsupported protocol version/,
    );
  });

  it("rejects decoding a message missing a version field entirely", () => {
    const noVersionBytes = utf8Encode(
      JSON.stringify({ kind: "accept", body: { acceptedContentHashes: [] } }),
    );
    expect(() => decodeSwapProtocolMessage(noVersionBytes)).toThrow(/unsupported protocol version/);
  });

  it("rejects decoding an unknown message kind", () => {
    const unknownKindBytes = utf8Encode(
      JSON.stringify({ version: SWAP_PROTOCOL_VERSION, kind: "self-destruct", body: {} }),
    );
    expect(() => decodeSwapProtocolMessage(unknownKindBytes)).toThrow(/unknown message kind/);
  });

  it("negotiateVersion accepts an exact match and rejects anything else", () => {
    expect(negotiateVersion(SWAP_PROTOCOL_VERSION)).toEqual({
      ok: true,
      version: SWAP_PROTOCOL_VERSION,
    });
    const mismatch = negotiateVersion(SWAP_PROTOCOL_VERSION + 1);
    expect(mismatch.ok).toBe(false);
  });
});

describe("swap protocol codec — wire-level padding (issue #60)", () => {
  it("pads the encoded message up to a multiple of the default block size", () => {
    const message = createAcceptMessage(["a".repeat(64)]);
    const encoded = encodeSwapProtocolMessage(message);
    expect(encoded.length % DEFAULT_WIRE_PADDING_BLOCK_BYTES).toBe(0);
  });

  it.each([1, 50, 300, 4_000])(
    "pads to a multiple of a custom block size (%i bytes) without corrupting content",
    (blockBytes) => {
      const token = makeToken({ description: fillerText(700) });
      const message = createOfferMessage([token]);
      const encoded = encodeSwapProtocolMessage(message, { padToBlockBytes: blockBytes });
      expect(encoded.length % blockBytes).toBe(0);
      const decoded = decodeSwapProtocolMessage(encoded);
      expect(decoded).toEqual(message);
    },
  );

  it("padToBlockBytes: 0 disables padding entirely — matches raw canonical bytes", () => {
    const message = createAcceptMessage(["b".repeat(64)]);
    const unpadded = encodeSwapProtocolMessage(message, { padToBlockBytes: 0 });
    expect(unpadded.length % DEFAULT_WIRE_PADDING_BLOCK_BYTES).not.toBe(0);
    expect(decodeSwapProtocolMessage(unpadded)).toEqual(message);
  });

  it("a message that already lands exactly on a block boundary gets zero extra padding", () => {
    const message = createAcceptMessage(["c".repeat(64)]);
    // `padToBlockBytes: 1` never needs any padding chars (every length is a
    // multiple of 1) — this is exactly the message's real encoded length
    // including the (empty) padding field's own fixed overhead.
    const baseLength = encodeSwapProtocolMessage(message, { padToBlockBytes: 1 }).length;
    // Using that exact length as the block size means the message is
    // already precisely one block long — no room for an "add a byte,
    // round up regardless" bug to hide.
    const padded = encodeSwapProtocolMessage(message, { padToBlockBytes: baseLength });
    expect(padded.length).toBe(baseLength);
  });

  it("two structurally different messages that happen to land in the same size bucket produce identically-sized wire output", () => {
    // The whole point of bucketing (docs/adr/0016): an observer sees the
    // bucket, not the exact byte count that would otherwise distinguish
    // "title A, no description" from "title B, short description".
    const short = createOfferMessage([makeToken({ title: "A" })]);
    const slightlyLonger = createOfferMessage([makeToken({ title: "A slightly longer title" })]);
    const blockBytes = 4_096; // large enough that both fall in the same bucket
    expect(encodeSwapProtocolMessage(short, { padToBlockBytes: blockBytes }).length).toBe(
      encodeSwapProtocolMessage(slightlyLonger, { padToBlockBytes: blockBytes }).length,
    );
  });

  it("round-trips every message kind, at realistic sizes, with default padding on — proving padding never corrupts real content", () => {
    const messages: SwapProtocolMessage[] = [
      createDiscoverAckMessage("node"),
      createOfferMessage([
        makeToken({ description: fillerText(50) }),
        makeToken({ description: fillerText(3_000) }),
      ]),
      createAcceptMessage(["a".repeat(64), "b".repeat(64)]),
      createTransferMessage([makeToken()]),
      createReconcileAckMessage(["c".repeat(64)]),
      createRevocationMessage([
        {
          contentHash: "a".repeat(64),
          revokedAtEpochMs: 12_345,
          signerPublicKey: "cd".repeat(32),
          signature: "ab".repeat(64),
        },
      ]),
    ];
    for (const message of messages) {
      const encoded = encodeSwapProtocolMessage(message);
      expect(encoded.length % DEFAULT_WIRE_PADDING_BLOCK_BYTES).toBe(0);
      expect(decodeSwapProtocolMessage(encoded)).toEqual(message);
    }
  });

  it("rejects a negative or non-integer padToBlockBytes", () => {
    const message = createAcceptMessage([]);
    expect(() => encodeSwapProtocolMessage(message, { padToBlockBytes: -1 })).toThrow();
    expect(() => encodeSwapProtocolMessage(message, { padToBlockBytes: 1.5 })).toThrow();
  });
});
