/**
 * SignatureVerifierPort — verify that `signature` over `message` was
 * produced by the private key matching `publicKey`.
 *
 * Issue #58 (token signing and verification). A 9th driven port, added
 * alongside the original eight from issue #17 — AGENTS.md §2 rule 3 ("ports
 * are owned by the domain, shaped by what the domain needs") does not cap
 * the port count at eight; it just says the interface lives in `core` and is
 * shaped by domain need. `MetadataToken` verification is exactly such a
 * need that didn't exist until #58.
 *
 * ## Design: a port, not a hand-rolled pure function, despite being pure math
 *
 * Ed25519 verification (the algorithm `../../adapters/identity-node` uses,
 * matching `IdentityPort`'s signing side, issue #57) is a deterministic
 * function of its three inputs — no filesystem, no network, no randomness —
 * so in principle it *could* be hand-rolled directly in `core`, the way
 * `../crypto/sha256.ts` hand-rolls SHA-256 for issue #23. It deliberately is
 * not. Elliptic-curve point arithmetic (point decompression, scalar
 * multiplication, modular inverse) is meaningfully harder to get right than
 * a hash function, and a subtle bug here is not "the wrong hash" — it is
 * "tampered or forged signatures verify as valid," a real security failure
 * silently shipped. See `docs/adr/0008-crypto-primitives-in-a-zero-dependency-core.md`
 * for the full reasoning behind hashing and signing landing on opposite
 * sides of the same "hand-roll vs. delegate" question.
 *
 * `verify` is synchronous — unlike `IdentityPort.sign` (which may need to
 * read a stored private key from disk/keychain, hence `Promise`), verifying
 * needs nothing but its three arguments, so an adapter implementing this
 * port does no I/O to satisfy it. That keeps `core`'s own orchestration of
 * verification (`../metadata/metadata-token.ts`'s `verifyMetadataTokenSignature`)
 * a plain, pure function that merely *calls* this port — the port is the
 * only piece that isn't hand-rolled, not the surrounding logic.
 */
export interface SignatureVerifierPort {
  /** `true` if `signature` is a valid signature over `message` by the key that `publicKey` names. Never throws on malformed input — returns `false`. */
  verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
}
