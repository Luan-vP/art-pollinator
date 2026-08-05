import { describe, expect, it } from "vitest";
import {
  InMemoryIdentityPort,
  InMemorySignatureVerifierPort,
  isTokenSigned,
  verifyMetadataTokenSignature,
  type MetadataToken,
} from "@art-pollinator/core";
import { signMetadataToken } from "./sign-metadata-token.js";

function token(overrides: Partial<MetadataToken> = {}): MetadataToken {
  return {
    title: "Piece",
    creator: "Someone",
    description: "A piece worth passing on.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash: "a".repeat(64) },
    contentHash: "a".repeat(64),
    signature: "",
    ...overrides,
  };
}

describe("signMetadataToken", () => {
  it("produces a token that verifies successfully against the signing identity", async () => {
    const identity = new InMemoryIdentityPort("artist-1");
    const verifier = new InMemorySignatureVerifierPort();

    const signed = await signMetadataToken(token(), identity);

    expect(isTokenSigned(signed)).toBe(true);
    expect(verifyMetadataTokenSignature(signed, verifier)).toBe(true);
  });

  it("does not mutate the input token", async () => {
    const identity = new InMemoryIdentityPort("artist-1");
    const original = token();
    await signMetadataToken(original, identity);
    expect(original.signature).toBe("");
    expect(original.signerPublicKey).toBeUndefined();
  });

  it("a signature produced after identity rotation no longer matches the old public key's holder", async () => {
    const identity = new InMemoryIdentityPort("person-1");
    const verifier = new InMemorySignatureVerifierPort();

    const signedBeforeRotation = await signMetadataToken(token(), identity);
    await identity.rotateIdentity();
    const signedAfterRotation = await signMetadataToken(token(), identity);

    // Swap the signatures between the two tokens: each should fail to
    // verify against the *other* signing round's declared public key.
    const mismatched: MetadataToken = {
      ...signedAfterRotation,
      signerPublicKey: signedBeforeRotation.signerPublicKey as string,
    };
    expect(verifyMetadataTokenSignature(mismatched, verifier)).toBe(false);

    // Each token verifies fine against its own declared signer.
    expect(verifyMetadataTokenSignature(signedBeforeRotation, verifier)).toBe(true);
    expect(verifyMetadataTokenSignature(signedAfterRotation, verifier)).toBe(true);
  });

  it("tampering with a signed token after signing invalidates it", async () => {
    const identity = new InMemoryIdentityPort("artist-1");
    const verifier = new InMemorySignatureVerifierPort();

    const signed = await signMetadataToken(token(), identity);
    const tampered: MetadataToken = { ...signed, description: "Not what was signed." };

    expect(verifyMetadataTokenSignature(tampered, verifier)).toBe(false);
  });
});
