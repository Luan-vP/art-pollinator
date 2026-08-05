/**
 * MetadataToken — the tiny gossipable record that travels between devices.
 *
 * SPEC.md §3.1: "A tiny, gossipable record that can be hot-swapped with
 * someone passed in the street. It carries enough context to decide whether
 * you want the full piece." Deliberately **text plus a pointer, no embedded
 * preview image** — the thumbnail is a deferred blob, resolved later over a
 * high-bandwidth link (SPEC.md §3.1, AGENTS.md §6).
 */

import { METADATA_TOKEN_MAX_BYTES } from "../constants.js";
import { canonicalStringify } from "../crypto/canonical-json.js";
import { hexDecode, utf8Encode } from "../crypto/bytes.js";
import type { SignatureVerifierPort } from "../ports/signature-verifier-port.js";

/**
 * Provenance — issue #21. **Hop count only, never an identified path.**
 *
 * SPEC.md §7 / §11 open question 1: a token recording an *identified* hop
 * path, combined with nodes' persistent identities, becomes a readable
 * record of which venues its holder visited. `docs/adr/0007-provenance-hop-count-only.md`
 * formalizes this as the resolved decision — see that ADR for the rejected
 * alternative and the reasoning. This shape has carried only a hop
 * **count** since the original stub (see `PrioritySignals.hopCount` in
 * `../priority/priority.js`, which reads the same value); #21 confirms that
 * was the right call rather than changing it, and wires
 * {@link incrementHopCount} into `SwapService`'s transfer step so the count
 * actually advances as a token changes hands.
 */
export interface Provenance {
  /** Number of hops since the item's origin (0 = authored/added on this device). Not an identified path — see above. */
  readonly hopCount: number;
}

/**
 * Return a copy of `token` with its hop count incremented by one.
 *
 * Called once per hop, at the point a device *receives* a token from a peer
 * (not when it sends one — sending is not a hop for the sender). See
 * `app/src/swap/swap-service.ts`'s transfer step, and
 * `docs/adr/0007-provenance-hop-count-only.md` for why this is the entire
 * lineage `core` records.
 *
 * Deliberately does not touch `signature`/`signerPublicKey`: the signed
 * payload ({@link canonicalizeTokenForSigning}) excludes `provenance`
 * specifically so that a token's signature — the original signer's
 * assertion about the *piece itself* — stays valid across every hop, even
 * though the hop count changes at each one. If provenance were covered by
 * the signature, every intermediate holder would need to re-sign, which
 * would require them to hold a key the original signer never gave them.
 */
export function incrementHopCount(token: MetadataToken): MetadataToken {
  return { ...token, provenance: { hopCount: token.provenance.hopCount + 1 } };
}

/**
 * BlobPointer — resolvable-anywhere blob reference (issue #39,
 * IMPLEMENTATION.md Phase 1b item 39).
 *
 * AGENTS.md §7 ("Traps specific to this codebase"): "Blob pointers must be
 * resolvable-anywhere. Phase 1 resolves locally, but a pointer type that
 * assumes filesystem paths will need rewriting when buckets arrive. Design
 * for both now." A bare filesystem path (or URL) bakes in one storage
 * backend's addressing scheme; a discriminated union keyed on `scheme`
 * instead lets a `BlobStorePort` implementation (or a future
 * scheme-dispatching resolver) branch on *how* to resolve a blob without
 * `core` ever assuming which backend is in play.
 *
 * **`contentHash` is universal across every scheme** — SPEC.md §3.2: "Blobs
 * are always addressed by content hash, regardless of storage location,"
 * a resolved decision (SPEC.md §12) required for dedup. Every variant below
 * carries it, so any code that only needs the identity of a blob (not where
 * to fetch it from) can read `blobPointer.contentHash` without a
 * scheme-based branch. In practice this is the same value as
 * `MetadataToken.contentHash` (the whole piece, per SPEC.md's model, is one
 * hashed blob referenced by its own token) — kept as a separate field on
 * `BlobPointer` anyway, rather than collapsed into a single token-level
 * field, so `BlobPointer` stays independently meaningful if `core` ever
 * needs to hand a bare pointer to a `BlobStorePort` call without the rest of
 * the token alongside it (e.g. the deferred blob queue, issue #41).
 *
 * ## Schemes
 *
 * - **`"local-filesystem"`** — the only scheme with a real resolver in
 *   Phase 1 (`adapters/blob-store-filesystem`'s `FilesystemBlobStorePort`,
 *   issue #40). SPEC.md §3.2: "Phase 1 stores blobs on the local filesystem
 *   only."
 * - **`"bucket"`** — a documented **future** variant for a cloud bucket
 *   (central- or user-managed, SPEC.md §3.2). Carries `bucketRef` (an
 *   opaque, backend-defined locator — e.g. a bucket name + object key, or a
 *   signed-URL template; deliberately unopinionated about that shape here,
 *   since no bucket backend exists yet to constrain it) in addition to
 *   `contentHash`. **No resolver implements this scheme yet** — it exists
 *   purely so the type does not foreclose it; a `BlobStorePort` adapter
 *   backing this scheme is out of scope for Phase 1 (SPEC.md §3.2, §9).
 *
 * Adding a scheme is additive (a new union member), never a breaking change
 * to `"local-filesystem"` pointers already in circulation or persisted
 * (e.g. `adapters/metadata-repository-sqlite`'s flattened columns) — this
 * is exactly the "resolvable-anywhere" property the issue asks for.
 */
export interface LocalFilesystemBlobPointer {
  readonly scheme: "local-filesystem";
  readonly contentHash: string;
}

/**
 * A future cloud-bucket blob pointer. **Not implemented** — no
 * `BlobStorePort` adapter resolves this scheme in Phase 1 (see
 * {@link BlobPointer}'s doc comment). Included now purely so the type is
 * not foreclosed against it later.
 */
export interface BucketBlobPointer {
  readonly scheme: "bucket";
  readonly contentHash: string;
  /** Opaque, backend-defined locator within the bucket (e.g. bucket name + object key). Unimplemented — shape may still change once a real bucket adapter exists. */
  readonly bucketRef: string;
}

export type BlobPointer = LocalFilesystemBlobPointer | BucketBlobPointer;

/** Construct a `"local-filesystem"` {@link BlobPointer} — the only scheme with a real resolver in Phase 1. */
export function localFilesystemBlobPointer(contentHash: string): LocalFilesystemBlobPointer {
  return { scheme: "local-filesystem", contentHash };
}

/**
 * A `MetadataToken`, per SPEC.md §3.1.
 *
 * `signature` and `signerPublicKey` are issue #58 (token signing and
 * verification), building on the identity work in issue #57
 * (`../ports/identity-port.js`). An empty `signature` (or a missing
 * `signerPublicKey`) means "unsigned" — see {@link isTokenSigned}. Both
 * fields are excluded from what actually gets signed
 * ({@link canonicalizeTokenForSigning}) for the obvious reason (a signature
 * cannot cover itself); `signerPublicKey` specifically is hex-encoded
 * (rather than `Uint8Array`) so the token stays a plain JSON-serialisable
 * value end to end, matching every other field here — a 32-byte Ed25519
 * public key is 64 hex characters, comfortably inside the ~5 KB budget
 * (AGENTS.md §6) alongside a 64-byte (128 hex character) signature.
 */
export interface MetadataToken {
  readonly title: string;
  readonly creator: string;
  readonly description: string;
  readonly provenance: Provenance;

  /** A MIME-style content type string, e.g. "image/jpeg", "text/plain", "video/mp4". */
  readonly contentType: string;

  readonly blobPointer: BlobPointer;

  /** Content hash of the full piece this token points at (SPEC.md §3.2: blobs always addressed by content hash). */
  readonly contentHash: string;

  /** Hex-encoded signature over {@link canonicalizeTokenForSigning}'s output. Empty string means unsigned. */
  readonly signature: string;

  /** Hex-encoded public key of the identity that produced `signature` (issue #57's `DeviceIdentity.publicKey`). Absent means unsigned. */
  readonly signerPublicKey?: string;
}

/**
 * The exact fields a signature covers, per {@link canonicalizeTokenForSigning}.
 * Deliberately excludes `signature`/`signerPublicKey` (circular) and
 * `provenance` (mutable per-hop — see {@link incrementHopCount}'s doc
 * comment for why that must not invalidate the signature).
 */
interface SignedTokenFields {
  readonly title: string;
  readonly creator: string;
  readonly description: string;
  readonly contentType: string;
  readonly blobPointer: BlobPointer;
  readonly contentHash: string;
}

function signedFields(token: MetadataToken): SignedTokenFields {
  return {
    title: token.title,
    creator: token.creator,
    description: token.description,
    contentType: token.contentType,
    blobPointer: token.blobPointer,
    contentHash: token.contentHash,
  };
}

/**
 * The canonical bytes a `MetadataToken`'s signature covers — issue #58's
 * interim canonicalization ("a simple deterministic JSON stringify with
 * sorted keys is fine ... to be superseded by #24's real wire format").
 * Uses {@link canonicalStringify} (`../crypto/canonical-json.js`) so the
 * result is stable regardless of field construction order, then UTF-8
 * encodes it — the same two-step shape `#24`'s wire codec uses for whole
 * messages (`../protocol/swap-message-codec.js`), just scoped to the fields
 * a signer actually vouches for (see {@link SignedTokenFields}).
 */
export function canonicalizeTokenForSigning(token: MetadataToken): Uint8Array {
  return utf8Encode(canonicalStringify(signedFields(token)));
}

/**
 * `true` if `token` carries both a non-empty signature and a signer public
 * key. Does not verify the signature is *valid* — see
 * {@link verifyMetadataTokenSignature} for that. An unsigned token (empty
 * signature, or no `signerPublicKey`) always returns `false` here; issue
 * #58's policy is that unsigned tokens are rejected by default, and this is
 * the cheap check that lets a caller short-circuit before ever invoking a
 * `SignatureVerifierPort`.
 */
export function isTokenSigned(token: MetadataToken): boolean {
  return token.signature !== "" && !!token.signerPublicKey && token.signerPublicKey !== "";
}

/**
 * Verify `token`'s signature using `verifier` (a `SignatureVerifierPort` —
 * issue #58). Returns `false` (never throws) for an unsigned token, a
 * tampered token (any signed field mutated invalidates the signature — see
 * {@link canonicalizeTokenForSigning}), or a malformed hex field.
 *
 * This function is pure — it only ever calls `verifier.verify`, which is
 * itself synchronous and I/O-free (see `../ports/signature-verifier-port.js`'s
 * doc comment) — so it can live in `core` even though the actual elliptic-
 * curve math behind `verifier` lives in an adapter.
 */
export function verifyMetadataTokenSignature(
  token: MetadataToken,
  verifier: SignatureVerifierPort,
): boolean {
  if (!isTokenSigned(token)) {
    return false;
  }
  try {
    const publicKey = hexDecode(token.signerPublicKey as string);
    const signature = hexDecode(token.signature);
    const message = canonicalizeTokenForSigning(token);
    return verifier.verify(publicKey, message, signature);
  } catch {
    return false; // malformed hex in signature/signerPublicKey — treat as unverifiable, not a crash
  }
}

/** Canonical serialisation used both to measure size and to transmit the token. */
export function serializeMetadataToken(token: MetadataToken): string {
  return JSON.stringify(token);
}

/**
 * Number of bytes `text` would occupy encoded as UTF-8.
 *
 * Deliberately a hand-rolled code-point walk rather than `TextEncoder`:
 * `core`'s `tsconfig.json` sets `types: []` and a `lib` with no DOM/Node
 * globals (see `tsconfig.base.json`) precisely so nothing in the domain
 * silently depends on which host runtime it happens to be running under —
 * `core` runs identically inside a React Native app, a browser, and a
 * plain Node process (SPEC.md §8). This keeps that true for size
 * validation too.
 */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint > 0xffff) {
      i++; // consume the low surrogate half of this code point
    }
    if (codePoint <= 0x7f) {
      bytes += 1;
    } else if (codePoint <= 0x7ff) {
      bytes += 2;
    } else if (codePoint <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

/** Serialised size of a token, in bytes (UTF-8), not characters — matters for non-ASCII titles/descriptions. */
export function metadataTokenByteSize(token: MetadataToken): number {
  return utf8ByteLength(serializeMetadataToken(token));
}

/** `true` if the token fits within the fixed size budget (AGENTS.md §6: "under ~5 KB"). */
export function isWithinSizeBudget(token: MetadataToken): boolean {
  return metadataTokenByteSize(token) <= METADATA_TOKEN_MAX_BYTES;
}

/** Throws if the token exceeds the size budget; otherwise a no-op. */
export function validateMetadataTokenSize(token: MetadataToken): void {
  const size = metadataTokenByteSize(token);
  if (size > METADATA_TOKEN_MAX_BYTES) {
    throw new Error(
      `MetadataToken exceeds size budget: ${String(size)} bytes > ${String(METADATA_TOKEN_MAX_BYTES)} bytes`,
    );
  }
}
