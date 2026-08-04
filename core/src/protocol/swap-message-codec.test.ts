import { describe, expect, it } from "vitest";
import { decodeSwapProtocolMessage, encodeSwapProtocolMessage } from "./swap-message-codec.js";
import { utf8Encode } from "../crypto/bytes.js";
import {
  createAcceptMessage,
  createDiscoverAckMessage,
  createOfferMessage,
  createReconcileAckMessage,
  createTransferMessage,
  negotiateVersion,
  SWAP_PROTOCOL_VERSION,
  type SwapProtocolMessage,
} from "./swap-message.js";
import type { MetadataToken } from "../metadata/metadata-token.js";

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
    blobPointer: { contentHash: "a".repeat(64) },
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
      version: 1,
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
