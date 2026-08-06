import { describe, expect, it } from "vitest";
import { verifyChallengeResponse } from "./peer-auth.js";
import { hexEncode, utf8Encode } from "../crypto/bytes.js";
import { InMemorySignatureVerifierPort } from "../ports/fakes/in-memory-signature-verifier-port.js";

const verifier = new InMemorySignatureVerifierPort();

/**
 * Build a fake keypair matching `InMemorySignatureVerifierPort`'s documented
 * deterministic scheme (`fake-public-key:<id>` / `fake-signature:<id>:` +
 * message) — the same "no real cryptography, but exercises the exact same
 * verification logic" convention `core`'s other signature-adjacent tests
 * already use (see `metadata-token.test.ts`), so this stays a pure,
 * `core`-only test with no dependency on `adapters/identity-node`'s real
 * Ed25519 implementation.
 */
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

describe("verifyChallengeResponse (issue #49 — connection-level authentication)", () => {
  it("accepts a valid signature over the exact challenge bytes, by the claimed key", () => {
    const challenge = new Uint8Array([1, 2, 3, 4, 5]);
    const peer = fakeKeypair("peer-a");
    const signatureHex = peer.sign(challenge);

    const result = verifyChallengeResponse(challenge, peer.publicKeyHex, signatureHex, verifier);
    expect(result.ok).toBe(true);
    expect(result.publicKey).toBeDefined();
  });

  it("accepts a signature from a brand-new, never-before-seen keypair — SPEC.md §7 anonymous rotating identities are legitimate", () => {
    // The whole point: this handshake proves "you hold *a* key," not "you
    // are a key we already know about." A fresh keypair generated for this
    // one test must authenticate exactly as well as any other.
    const challenge = new Uint8Array([9, 9, 9]);
    const freshPeer = fakeKeypair(`ephemeral-${String(Date.now())}-${String(Math.random())}`);
    const signatureHex = freshPeer.sign(challenge);
    expect(
      verifyChallengeResponse(challenge, freshPeer.publicKeyHex, signatureHex, verifier).ok,
    ).toBe(true);
  });

  it("rejects a signature over the wrong challenge (replay of an old response against a new nonce)", () => {
    const originalChallenge = new Uint8Array([1, 1, 1]);
    const newChallenge = new Uint8Array([2, 2, 2]);
    const peer = fakeKeypair("peer-b");
    const staleSignature = peer.sign(originalChallenge);

    const result = verifyChallengeResponse(
      newChallenge,
      peer.publicKeyHex,
      staleSignature,
      verifier,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not verify/);
  });

  it("rejects a signature produced by a different keypair than the one claimed", () => {
    const challenge = new Uint8Array([7, 7, 7]);
    const realPeer = fakeKeypair("real-peer");
    const impostor = fakeKeypair("impostor");
    const signatureFromImpostor = impostor.sign(challenge);

    // Claims to be `realPeer` but the signature was made by `impostor`'s key.
    const result = verifyChallengeResponse(
      challenge,
      realPeer.publicKeyHex,
      signatureFromImpostor,
      verifier,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects malformed hex without throwing", () => {
    const challenge = new Uint8Array([1]);
    expect(() =>
      verifyChallengeResponse(challenge, "not-hex!!", "also-not-hex", verifier),
    ).not.toThrow();
    const result = verifyChallengeResponse(challenge, "not-hex!!", "also-not-hex", verifier);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty public key or signature", () => {
    const challenge = new Uint8Array([1]);
    expect(verifyChallengeResponse(challenge, "", "aa", verifier).ok).toBe(false);
    expect(verifyChallengeResponse(challenge, "aa", "", verifier).ok).toBe(false);
  });
});
