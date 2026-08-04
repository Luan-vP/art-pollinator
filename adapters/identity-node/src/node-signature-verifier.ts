/**
 * NodeSignatureVerifier — the real `SignatureVerifierPort` implementation
 * for a Node environment (issue #58), using `node:crypto`'s audited Ed25519
 * support. This is the adapter half of the "hand-roll hashing, delegate
 * signature verification" split — see
 * `core/src/ports/signature-verifier-port.ts`'s doc comment and
 * `docs/adr/0008-crypto-primitives-in-a-zero-dependency-core.md`.
 *
 * Reconstructs a public key `KeyObject` from the raw 32 bytes
 * `IdentityPort.getCurrentIdentity().publicKey` carries, via the same JWK
 * (`kty: "OKP", crv: "Ed25519"`) encoding `NodeIdentityAdapter` uses
 * internally — so a public key produced by that adapter round-trips
 * through this verifier without any format translation at the call site.
 */
import * as nodeCrypto from "node:crypto";
import type { SignatureVerifierPort } from "@art-pollinator/core";

export class NodeSignatureVerifier implements SignatureVerifierPort {
  verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
    try {
      const jwk: nodeCrypto.JsonWebKey = {
        kty: "OKP",
        crv: "Ed25519",
        x: Buffer.from(publicKey).toString("base64url"),
      };
      const keyObject = nodeCrypto.createPublicKey({ key: jwk, format: "jwk" });
      return nodeCrypto.verify(null, Buffer.from(message), keyObject, Buffer.from(signature));
    } catch {
      return false; // malformed key/signature bytes — not a valid signature, not a crash
    }
  }
}
