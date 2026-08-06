import { describe, expect, it } from "vitest";
import {
  canonicalizeRevocationForSigning,
  isRevocationAuthorizedForToken,
  verifyRevocationEntrySignature,
  type RevocationEntry,
} from "./revocation.js";
import { hexEncode, utf8Encode } from "../crypto/bytes.js";
import { InMemorySignatureVerifierPort } from "../ports/fakes/in-memory-signature-verifier-port.js";
import type { MetadataToken } from "../metadata/metadata-token.js";

const verifier = new InMemorySignatureVerifierPort();

function fakeKeypair(id: string): { publicKeyHex: string; sign: (data: Uint8Array) => string } {
  return {
    publicKeyHex: hexEncode(utf8Encode(`fake-public-key:${id}`)),
    sign: (data: Uint8Array) => {
      const prefix = utf8Encode(`fake-signature:${id}:`);
      const combined = new Uint8Array(prefix.length + data.length);
      combined.set(prefix, 0);
      combined.set(data, prefix.length);
      return hexEncode(combined);
    },
  };
}

function signedRevocation(
  keypair: ReturnType<typeof fakeKeypair>,
  contentHash: string,
  revokedAtEpochMs = 0,
): RevocationEntry {
  const unsigned = { contentHash, revokedAtEpochMs };
  const signature = keypair.sign(canonicalizeRevocationForSigning(unsigned));
  return { ...unsigned, signerPublicKey: keypair.publicKeyHex, signature };
}

function token(overrides: Partial<MetadataToken> = {}): MetadataToken {
  return {
    title: "Piece",
    creator: "Someone",
    description: "d",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash: "hash-1" },
    contentHash: "hash-1",
    signature: "",
    ...overrides,
  };
}

describe("verifyRevocationEntrySignature (issue #51)", () => {
  it("accepts a validly signed revocation", () => {
    const artist = fakeKeypair("artist-1");
    const entry = signedRevocation(artist, "hash-1", 1_000);
    expect(verifyRevocationEntrySignature(entry, verifier)).toBe(true);
  });

  it("rejects a revocation whose contentHash was tampered with after signing", () => {
    const artist = fakeKeypair("artist-1");
    const entry = signedRevocation(artist, "hash-1", 1_000);
    const tampered: RevocationEntry = { ...entry, contentHash: "hash-2" };
    expect(verifyRevocationEntrySignature(tampered, verifier)).toBe(false);
  });

  it("rejects a forged revocation claiming a public key the signer doesn't hold", () => {
    const artist = fakeKeypair("artist-1");
    const impostor = fakeKeypair("impostor");
    const entry = signedRevocation(impostor, "hash-1", 1_000);
    const forged: RevocationEntry = { ...entry, signerPublicKey: artist.publicKeyHex };
    expect(verifyRevocationEntrySignature(forged, verifier)).toBe(false);
  });

  it("rejects malformed hex fields without throwing", () => {
    const malformed: RevocationEntry = {
      contentHash: "hash-1",
      revokedAtEpochMs: 0,
      signerPublicKey: "not-hex!",
      signature: "also-not-hex!",
    };
    expect(() => verifyRevocationEntrySignature(malformed, verifier)).not.toThrow();
    expect(verifyRevocationEntrySignature(malformed, verifier)).toBe(false);
  });
});

describe("isRevocationAuthorizedForToken (issue #51 — authorization model)", () => {
  it("authorizes when the revoker's key matches the token's original signer", () => {
    const artist = fakeKeypair("artist-1");
    const signedToken = token({
      signerPublicKey: artist.publicKeyHex,
      signature: "irrelevant-here",
    });
    const entry = signedRevocation(artist, signedToken.contentHash);
    expect(isRevocationAuthorizedForToken(entry, signedToken)).toBe(true);
  });

  it("rejects when the revoker's key does not match the token's original signer (someone else's content)", () => {
    const artist = fakeKeypair("artist-1");
    const impostor = fakeKeypair("impostor");
    const signedToken = token({
      signerPublicKey: artist.publicKeyHex,
      signature: "irrelevant-here",
    });
    const entry = signedRevocation(impostor, signedToken.contentHash);
    expect(isRevocationAuthorizedForToken(entry, signedToken)).toBe(false);
  });

  it("rejects for an unsigned token — nothing to authorize a revocation against", () => {
    const artist = fakeKeypair("artist-1");
    const unsignedToken = token(); // no signerPublicKey
    const entry = signedRevocation(artist, unsignedToken.contentHash);
    expect(isRevocationAuthorizedForToken(entry, unsignedToken)).toBe(false);
  });
});
