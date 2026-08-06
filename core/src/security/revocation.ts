/**
 * Revocation — moderation and takedown (issue #51, SPEC.md §11 open
 * question 7: "revocation propagating opportunistically; behaviour for
 * offline devices holding revoked content").
 *
 * ## Design: revocation piggybacks on the existing swap protocol, gossip-style
 *
 * There is no always-on central authority in this system (SPEC.md's whole
 * premise is offline-first, opportunistic contact) — so a takedown cannot be
 * "pushed" to every device the moment it happens. Instead, `RevocationEntry`
 * is a small signed record ("this content hash is revoked, as of this
 * time, by this key") that rides along inside a swap, exactly like an
 * `offer`/`accept` round: two devices that happen to meet exchange
 * everything they *each* currently know about revocations, merge the
 * union, and carry it forward to whoever they meet next. A device that was
 * offline when the original revocation happened receives it — and applies
 * it, evicting the now-revoked item from its own library — the next time it
 * swaps with *any* peer that has already learned of it, not only the
 * original revoker (see `app/src/swap/swap-service.ts`'s revocation round,
 * and `app/src/swap/revocation-propagation.test.ts` for the offline-device
 * scenario this is built to satisfy). See
 * `docs/adr/0015-opportunistic-revocation-protocol.md` for the full design
 * discussion, including why this needed a new protocol message kind (a
 * `SWAP_PROTOCOL_VERSION` bump) rather than reusing an existing one.
 *
 * ## Authorization model: a revocation is honoured only where it can be checked
 *
 * `RevocationEntry.signerPublicKey` must match the *original* content's own
 * `MetadataToken.signerPublicKey` for a device to actually remove that item
 * from its library — the same identity that signed a piece is the only one
 * whose revocation of it this system currently treats as binding. A device
 * that does not (or no longer) hold the original token has no way to check
 * that match, and — a documented, honest trust-model limitation, not a
 * silent gap — still relays the entry onward on the strength of its own
 * signature verifying correctly, trusting that *some* future recipient
 * holding the real token will make the authoritative call. `docs/security/
 * threat-model.md` names the residual risk this leaves open: a valid
 * keyholder can construct a cryptographically well-formed revocation for a
 * content hash it never actually authored, and that entry can circulate to
 * devices that never get a chance to reject it for lacking authorization.
 * This is judged an acceptable interim trade-off for a decentralized system
 * with no central registrar of "who is allowed to revoke what" — see that
 * ADR for the alternatives considered.
 */
import { canonicalStringify } from "../crypto/canonical-json.js";
import { hexDecode, utf8Encode } from "../crypto/bytes.js";
import type { MetadataToken } from "../metadata/metadata-token.js";
import type { SignatureVerifierPort } from "../ports/signature-verifier-port.js";

/** A single signed takedown record for one content hash. */
export interface RevocationEntry {
  readonly contentHash: string;
  /** When the revocation was made, per the revoking device's own clock. */
  readonly revokedAtEpochMs: number;
  /** Hex-encoded public key of the identity that produced `signature` — see this file's doc comment on the authorization model. */
  readonly signerPublicKey: string;
  /** Hex-encoded signature over {@link canonicalizeRevocationForSigning}'s output. */
  readonly signature: string;
}

interface SignedRevocationFields {
  readonly contentHash: string;
  readonly revokedAtEpochMs: number;
}

function signedFields(
  entry: Pick<RevocationEntry, "contentHash" | "revokedAtEpochMs">,
): SignedRevocationFields {
  return { contentHash: entry.contentHash, revokedAtEpochMs: entry.revokedAtEpochMs };
}

/** The canonical bytes a `RevocationEntry`'s signature covers — the same canonical-JSON-then-UTF-8 shape `../metadata/metadata-token.js`'s `canonicalizeTokenForSigning` uses. */
export function canonicalizeRevocationForSigning(
  entry: Pick<RevocationEntry, "contentHash" | "revokedAtEpochMs">,
): Uint8Array {
  return utf8Encode(canonicalStringify(signedFields(entry)));
}

/**
 * Verify a `RevocationEntry`'s own signature is cryptographically valid —
 * i.e. that whoever created it really does control the private key matching
 * `signerPublicKey`. This does **not** check *authorization* (whether that
 * key is actually the one that signed the original content) — see
 * {@link isRevocationAuthorizedForToken} for that half, and this file's doc
 * comment for why they're deliberately separate checks.
 */
export function verifyRevocationEntrySignature(
  entry: RevocationEntry,
  verifier: SignatureVerifierPort,
): boolean {
  try {
    const publicKey = hexDecode(entry.signerPublicKey);
    const signature = hexDecode(entry.signature);
    const message = canonicalizeRevocationForSigning(entry);
    return verifier.verify(publicKey, message, signature);
  } catch {
    return false;
  }
}

/**
 * `true` if `entry` is authorized to revoke `token` — i.e. the same
 * identity that signed the content is the one revoking it. A token with no
 * `signerPublicKey` (unsigned) can never be authorized-revoked by this
 * check; see this file's doc comment for what happens when a device cannot
 * make this check at all (it doesn't hold the token).
 */
export function isRevocationAuthorizedForToken(
  entry: RevocationEntry,
  token: MetadataToken,
): boolean {
  return !!token.signerPublicKey && token.signerPublicKey === entry.signerPublicKey;
}
