/**
 * Peer authentication (issue #49) — verifying *who is holding this
 * connection*, not just whether a given token is signed.
 *
 * ## Why a connection needs its own handshake, distinct from token signing
 *
 * Issue #58 already gives every `MetadataToken` a signature
 * (`../metadata/metadata-token.ts`'s `verifyMetadataTokenSignature`), but
 * that only proves *the content* was produced by some keyholder at some
 * point in the past — it says nothing about who is on the other end of
 * *this* socket right now. A hostile relay could replay someone else's
 * already-signed tokens verbatim without ever holding their private key,
 * and `HttpTransportServer` (before this batch) had no concept of "which
 * identity is this HTTP connection" at all — every `x-peer-id` was a bare,
 * self-asserted string, trusted for nothing beyond routing messages back to
 * whoever claimed it. This module is the missing piece: a real
 * challenge-response handshake that makes a peer *prove*, at connection
 * time, that it controls the private key matching whatever public key it
 * claims.
 *
 * ## Design: verify the mechanism here (pure), generate the challenge in the adapter (impure)
 *
 * Issuing a fresh, unpredictable challenge needs a CSPRNG
 * (`node:crypto.randomBytes` in the real adapter) — real randomness is I/O
 * in the sense that matters to AGENTS.md §2 rule 1 (it is not a
 * deterministic function of its inputs), so challenge *generation*, session
 * bookkeeping (which nonce belongs to which peer, with what expiry), and
 * single-use consumption all live in `adapters/transport-http`'s
 * `HttpTransportServer` — the actual I/O boundary. What stays here, pure,
 * is the one part that's genuinely just math: "does this signature, over
 * this challenge, verify against this claimed public key" — the identical
 * shape `verifyMetadataTokenSignature` already uses, just over a raw
 * challenge nonce instead of a canonicalized token.
 *
 * ## Trust model: presenting *a* valid signature authenticates the
 * connection, not a specific, previously-known identity
 *
 * SPEC.md §7 permits anonymous person-to-person swaps under rotating
 * ephemeral identities — a peer this device has never seen before, using a
 * keypair generated five seconds ago, is a completely legitimate swap
 * partner. So this handshake does **not** check a claimed public key
 * against an allow-list of known identities; it only checks that *some*
 * signature over *this* challenge, by *some* keypair, verifies against the
 * public key the peer itself claims to be presenting. That is the entire
 * authentication guarantee: "whoever is on this connection controls the
 * private key matching the public key they asserted." A connection that
 * cannot produce a valid signature at all — no key, or a signature that
 * doesn't verify — is rejected outright (see
 * `adapters/transport-http/src/http-transport-server.ts`'s handshake
 * routes). See `docs/adr/0013-peer-connection-authentication.md` for the
 * full reasoning, including why this deliberately does *not* attempt to
 * distinguish "trusted" from "untrusted" identities at the handshake layer
 * itself — that distinction is made afterwards, by rate-limiting new vs.
 * previously-successful identities differently (`./rate-limiter.js`), not
 * by the handshake rejecting anyone.
 */
import { hexDecode } from "../crypto/bytes.js";
import type { SignatureVerifierPort } from "../ports/signature-verifier-port.js";

export interface ChallengeVerificationResult {
  readonly ok: boolean;
  /** Present only when `ok` is `true` — the raw public key bytes the connection proved it controls. */
  readonly publicKey?: Uint8Array;
  /** Present only when `ok` is `false` — why verification failed. */
  readonly reason?: string;
}

/**
 * Verify that `signatureHex` is a valid signature over `challenge` by the
 * key `publicKeyHex` names. Never throws — malformed hex or a
 * verifier-level failure both produce `{ ok: false, reason }`, mirroring
 * `verifyMetadataTokenSignature`'s "never throws" contract so a caller
 * (the HTTP handshake route) can treat every outcome uniformly as
 * "reject the handshake with this reason," never as an unhandled exception
 * that could crash a long-lived node process over one malformed request.
 */
export function verifyChallengeResponse(
  challenge: Uint8Array,
  publicKeyHex: string,
  signatureHex: string,
  verifier: SignatureVerifierPort,
): ChallengeVerificationResult {
  let publicKey: Uint8Array;
  let signature: Uint8Array;
  try {
    publicKey = hexDecode(publicKeyHex);
    signature = hexDecode(signatureHex);
  } catch (error) {
    return {
      ok: false,
      reason: `malformed hex: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (publicKey.length === 0 || signature.length === 0) {
    return { ok: false, reason: "empty public key or signature" };
  }

  const valid = verifier.verify(publicKey, challenge, signature);
  if (!valid) {
    return { ok: false, reason: "signature does not verify against the claimed public key" };
  }
  return { ok: true, publicKey };
}
