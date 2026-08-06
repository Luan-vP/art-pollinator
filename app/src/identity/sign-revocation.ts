/**
 * signRevocationEntry — issue #51's async counterpart to `signMetadataToken`
 * (`./sign-metadata-token.ts`), for exactly the same reason: producing a
 * signature requires awaiting `IdentityPort.sign`, which may need real I/O
 * (a stored private key on disk), so it lives in `app`, not `core`
 * (AGENTS.md §2 rule 1). `core`'s `verifyRevocationEntrySignature`
 * (`@art-pollinator/core`) is the pure counterpart that checks what this
 * produces.
 */
import {
  canonicalizeRevocationForSigning,
  hexEncode,
  type IdentityPort,
  type RevocationEntry,
} from "@art-pollinator/core";

/** Sign a revocation of `contentHash`, as of `revokedAtEpochMs`, with `identity`'s current key. */
export async function signRevocationEntry(
  contentHash: string,
  revokedAtEpochMs: number,
  identity: IdentityPort,
): Promise<RevocationEntry> {
  const current = await identity.getCurrentIdentity();
  const unsigned = { contentHash, revokedAtEpochMs };
  const signatureBytes = await identity.sign(canonicalizeRevocationForSigning(unsigned));
  return {
    ...unsigned,
    signerPublicKey: hexEncode(current.publicKey),
    signature: hexEncode(signatureBytes),
  };
}
