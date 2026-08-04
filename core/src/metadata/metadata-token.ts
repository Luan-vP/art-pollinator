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

/**
 * Placeholder provenance shape.
 *
 * Full lineage/provenance design is issue #21 (a later batch), and SPEC.md
 * §7 flags an open risk it must resolve first: a token recording an
 * *identified* hop path, combined with nodes' persistent identities, becomes
 * a readable record of which venues its holder visited. This stub
 * deliberately records only a hop **count** (see `PrioritySignals.hopCount`
 * in `../priority/priority.js`, which reads the same value) — never an
 * identified path — so nothing here forecloses that design question. When
 * #21 lands, it can extend this shape (e.g. with signed hop-count
 * attestations); it should not need to remove anything this stub added.
 */
export interface Provenance {
  /** Number of hops since the item's origin. Not an identified path — see above. */
  readonly hopCount: number;
}

/**
 * Placeholder blob pointer.
 *
 * The real "resolvable-anywhere" blob pointer design is issue #39 (a later
 * batch). SPEC.md §3.2 requires blobs to be addressed by content hash
 * regardless of storage backend (local filesystem now, cloud buckets
 * later), so this stub carries only the one thing guaranteed stable across
 * every backend — the content hash — and deliberately avoids embedding any
 * filesystem-path or URL assumption that a later backend would force a
 * rewrite of.
 */
export interface BlobPointer {
  readonly contentHash: string;
}

/**
 * A `MetadataToken`, per SPEC.md §3.1.
 *
 * `signature` is a placeholder string field for now; real signing and
 * verification is issue #58 (a later batch, cross-cutting with identity
 * work #57). An empty string means "unsigned" — callers/policies that care
 * about signature verification decide how to treat that, `core` does not
 * assume every token is signed yet.
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

  /** Placeholder for issue #58 (token signing). Empty string means unsigned. */
  readonly signature: string;
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
