import { describe, expect, it } from "vitest";
import {
  canonicalizeTokenForSigning,
  incrementHopCount,
  isTokenSigned,
  isWithinSizeBudget,
  metadataTokenByteSize,
  serializeMetadataToken,
  validateMetadataTokenSize,
  verifyMetadataTokenSignature,
  type MetadataToken,
} from "./metadata-token.js";
import { METADATA_TOKEN_MAX_BYTES } from "../constants.js";
import { hexEncode } from "../crypto/bytes.js";
import { InMemoryIdentityPort } from "../ports/fakes/in-memory-identity-port.js";
import { InMemorySignatureVerifierPort } from "../ports/fakes/in-memory-signature-verifier-port.js";

/** Deterministic filler text of a given length — no randomness needed in `core` tests. */
function fillerText(length: number): string {
  const base =
    "Study for a coastline at dusk, oil and pigment on reclaimed canvas, exploring erosion as a slow form of drawing. ";
  let out = "";
  while (out.length < length) {
    out += base;
  }
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

describe("MetadataToken shape", () => {
  it("has no field for an embedded preview image", () => {
    const token = makeToken();
    const keys = Object.keys(serializeJson(token));
    for (const forbidden of ["previewImage", "thumbnail", "image", "imageData", "preview"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("carries the fields specified in SPEC.md §3.1", () => {
    const token = makeToken();
    expect(token).toMatchObject({
      title: expect.any(String),
      creator: expect.any(String),
      description: expect.any(String),
      provenance: { hopCount: expect.any(Number) },
      contentType: expect.any(String),
      blobPointer: { contentHash: expect.any(String) },
      contentHash: expect.any(String),
      signature: expect.any(String),
    });
  });
});

function serializeJson(token: MetadataToken): Record<string, unknown> {
  return JSON.parse(serializeMetadataToken(token)) as Record<string, unknown>;
}

describe("size budget — realistic tokens", () => {
  const realisticShapes: Array<[string, Partial<MetadataToken>]> = [
    ["short title/description", { title: "Untitled", description: fillerText(50) }],
    ["typical wall-text length description", { description: fillerText(400) }],
    ["long creator name and title", { creator: fillerText(80), title: fillerText(120) }],
    ["generous description, still plausible", { description: fillerText(1500) }],
  ];

  it.each(realisticShapes)("%s stays under the ~5 KB budget", (_label, overrides) => {
    const token = makeToken(overrides);
    const size = metadataTokenByteSize(token);
    expect(size).toBeLessThanOrEqual(METADATA_TOKEN_MAX_BYTES);
    expect(isWithinSizeBudget(token)).toBe(true);
    expect(() => validateMetadataTokenSize(token)).not.toThrow();
  });

  it("byte size matches the serialisation's length for pure-ASCII content", () => {
    // For ASCII-only text, UTF-8 byte length equals character length —
    // an independent sanity check on the byte-counting logic.
    const token = makeToken();
    const serialized = serializeMetadataToken(token);
    expect(/^[\x00-\x7f]*$/.test(serialized)).toBe(true);
    expect(metadataTokenByteSize(token)).toBe(serialized.length);
  });

  it("accounts for multi-byte UTF-8 characters, not just character count", () => {
    const asciiToken = makeToken({ description: fillerText(100) });
    const unicodeToken = makeToken({ description: "🎨".repeat(100) }); // each emoji is 4 bytes in UTF-8
    expect(metadataTokenByteSize(unicodeToken)).toBeGreaterThan(metadataTokenByteSize(asciiToken));
  });
});

describe("size budget — maximally-stuffed token", () => {
  it("a token stuffed with maximally-long realistic field values is clearly flagged over budget", () => {
    const stuffedToken = makeToken({
      title: fillerText(300),
      creator: fillerText(150),
      description: fillerText(8000), // far beyond a plausible wall-text blurb, well past 5 KB alone
    });

    const size = metadataTokenByteSize(stuffedToken);
    expect(size).toBeGreaterThan(METADATA_TOKEN_MAX_BYTES);
    expect(isWithinSizeBudget(stuffedToken)).toBe(false);
    expect(() => validateMetadataTokenSize(stuffedToken)).toThrow(/exceeds size budget/);
  });

  it("a token at the edge of a plausible description length stays under budget", () => {
    // ~2 KB description plus the other fields comfortably clears the ~5 KB budget
    // without needing every field maxed out simultaneously.
    const edgeToken = makeToken({ description: fillerText(2000) });
    expect(isWithinSizeBudget(edgeToken)).toBe(true);
  });
});

describe("token signing and verification — issue #58", () => {
  async function signToken(token: MetadataToken, identity: InMemoryIdentityPort) {
    const current = await identity.getCurrentIdentity();
    const message = canonicalizeTokenForSigning(token);
    const signatureBytes = await identity.sign(message);
    return {
      ...token,
      signature: hexEncode(signatureBytes),
      signerPublicKey: hexEncode(current.publicKey),
    };
  }

  it("an unsigned token (empty signature, no signerPublicKey) is never treated as signed", () => {
    const token = makeToken();
    expect(isTokenSigned(token)).toBe(false);
  });

  it("a token with a signerPublicKey but an empty signature is still unsigned", () => {
    const token = makeToken({ signerPublicKey: "aa".repeat(32) });
    expect(isTokenSigned(token)).toBe(false);
  });

  it("verification rejects an unsigned token outright, without calling the verifier", () => {
    const token = makeToken();
    const verifier = new InMemorySignatureVerifierPort();
    expect(verifyMetadataTokenSignature(token, verifier)).toBe(false);
  });

  it("a properly signed token verifies successfully", async () => {
    const identity = new InMemoryIdentityPort("artist-1");
    const verifier = new InMemorySignatureVerifierPort();
    const signed = await signToken(makeToken(), identity);

    expect(isTokenSigned(signed)).toBe(true);
    expect(verifyMetadataTokenSignature(signed, verifier)).toBe(true);
  });

  it("rejects a tampered token — mutating one signed field invalidates the signature", async () => {
    const identity = new InMemoryIdentityPort("artist-1");
    const verifier = new InMemorySignatureVerifierPort();
    const signed = await signToken(makeToken(), identity);

    const tampered: MetadataToken = { ...signed, title: `${signed.title} (tampered)` };
    expect(verifyMetadataTokenSignature(tampered, verifier)).toBe(false);
  });

  it("rejects a tampered contentHash even though the rest of the token is untouched", async () => {
    const identity = new InMemoryIdentityPort("artist-1");
    const verifier = new InMemorySignatureVerifierPort();
    const signed = await signToken(makeToken(), identity);

    const tampered: MetadataToken = { ...signed, contentHash: "b".repeat(64) };
    expect(verifyMetadataTokenSignature(tampered, verifier)).toBe(false);
  });

  it("rejects a signature produced by a different identity's key", async () => {
    const signer = new InMemoryIdentityPort("artist-1");
    const impostor = new InMemoryIdentityPort("artist-2");
    const verifier = new InMemorySignatureVerifierPort();

    const signed = await signToken(makeToken(), signer);
    const impostorKey = hexEncode((await impostor.getCurrentIdentity()).publicKey);
    const relabelled: MetadataToken = { ...signed, signerPublicKey: impostorKey };

    expect(verifyMetadataTokenSignature(relabelled, verifier)).toBe(false);
  });

  it("changing the hop count (provenance) does NOT invalidate the signature", async () => {
    // Provenance is deliberately excluded from the signed payload (see
    // canonicalizeTokenForSigning's doc comment) so that incrementing hop
    // count on receipt, at every intermediate holder, never requires
    // re-signing.
    const identity = new InMemoryIdentityPort("artist-1");
    const verifier = new InMemorySignatureVerifierPort();
    const signed = await signToken(makeToken({ provenance: { hopCount: 0 } }), identity);

    const afterOneHop = incrementHopCount(signed);
    const afterTwoHops = incrementHopCount(afterOneHop);

    expect(afterTwoHops.provenance.hopCount).toBe(2);
    expect(verifyMetadataTokenSignature(afterTwoHops, verifier)).toBe(true);
  });

  it("canonicalizeTokenForSigning excludes signature/signerPublicKey/provenance from what it covers", () => {
    const base = makeToken({ provenance: { hopCount: 0 } });
    const withDifferentProvenance: MetadataToken = { ...base, provenance: { hopCount: 5 } };
    const withDifferentSignature: MetadataToken = { ...base, signature: "ff".repeat(64) };

    expect(canonicalizeTokenForSigning(base)).toEqual(
      canonicalizeTokenForSigning(withDifferentProvenance),
    );
    expect(canonicalizeTokenForSigning(base)).toEqual(
      canonicalizeTokenForSigning(withDifferentSignature),
    );
  });
});

describe("incrementHopCount — issue #21 provenance lineage", () => {
  it("increments the hop count by exactly one, leaving every other field untouched", () => {
    const token = makeToken({ provenance: { hopCount: 3 } });
    const next = incrementHopCount(token);
    expect(next.provenance.hopCount).toBe(4);
    expect({ ...next, provenance: token.provenance }).toEqual(token);
  });

  it("hop count keeps advancing across repeated hops", () => {
    let token = makeToken({ provenance: { hopCount: 0 } });
    for (let i = 0; i < 5; i++) {
      token = incrementHopCount(token);
    }
    expect(token.provenance.hopCount).toBe(5);
  });

  it("never carries an identified peer/node path — only a count (SPEC.md §7)", () => {
    const token = incrementHopCount(makeToken({ provenance: { hopCount: 0 } }));
    // Provenance is structurally incapable of carrying anything but a
    // number: this is a compile-time guarantee (the `Provenance` interface
    // has exactly one field), asserted here at the value level too.
    expect(Object.keys(token.provenance)).toEqual(["hopCount"]);
  });
});
