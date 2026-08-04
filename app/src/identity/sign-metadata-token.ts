/**
 * signMetadataToken — issue #58, the async half of token signing.
 *
 * `core`'s `verifyMetadataTokenSignature` (`@art-pollinator/core`) is pure:
 * it only ever calls a `SignatureVerifierPort`, which is itself synchronous
 * and I/O-free. *Producing* a signature is different — `IdentityPort.sign`
 * (issue #57) is `Promise`-returning because a real adapter may need to
 * read a private key from disk or a platform keychain
 * (`adapters/identity-node`). That I/O is exactly why this function lives
 * in `app`, not `core` (AGENTS.md §2 rule 1): it's the orchestration layer
 * that's allowed to await a port.
 *
 * Signs over `core`'s `canonicalizeTokenForSigning(token)` — the same
 * canonical bytes `verifyMetadataTokenSignature` recomputes and checks
 * against — so a token signed here always verifies successfully against an
 * unmodified copy of itself, and never verifies after any signed field
 * (title, creator, description, contentType, blobPointer, contentHash) is
 * tampered with. `provenance` (hop count) is deliberately excluded — see
 * `core`'s `incrementHopCount` doc comment — so re-signing is never needed
 * as a token's hop count advances in transit.
 */
import {
  canonicalizeTokenForSigning,
  hexEncode,
  type IdentityPort,
  type MetadataToken,
} from "@art-pollinator/core";

/**
 * Sign `token` with `identity`'s current key, returning a new token with
 * `signature` and `signerPublicKey` populated. Does not mutate `token`.
 */
export async function signMetadataToken(
  token: MetadataToken,
  identity: IdentityPort,
): Promise<MetadataToken> {
  const current = await identity.getCurrentIdentity();
  const message = canonicalizeTokenForSigning(token);
  const signatureBytes = await identity.sign(message);

  return {
    ...token,
    signature: hexEncode(signatureBytes),
    signerPublicKey: hexEncode(current.publicKey),
  };
}
