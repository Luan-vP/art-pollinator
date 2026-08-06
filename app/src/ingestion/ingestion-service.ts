/**
 * IngestionService — the ingestion-path driving port for issue #53
 * (IMPLEMENTATION.md Phase 3, item 53): "an `IngestionService` driving port
 * covering venue seeding and artist publishing."
 *
 * ## Design: one operation, two framings — not two code paths
 *
 * Issue #53's own definition of done asks this to cover "both venue seeding
 * and artist publishing paths," and issue #55 (metadata authoring UX) frames
 * the exact same affordance as "a user adds a piece end to end." At the
 * domain level these are identical: someone supplies a title, creator,
 * description, content type and a blob, and the result is a signed-or-not
 * `MetadataToken` (pointing at that blob, addressed by its content hash) it
 * added to a `Library`. "A venue operator seeding their node's collection"
 * and "an artist publishing their own piece from the authoring screen" are
 * the same call to {@link ingest} with different UI framing around it
 * (`clients/mobile`'s `AuthoringScreen`, issue #55) — nothing here branches
 * on who the caller is, matching this batch's explicit instruction not to
 * build a separate "venue" vs "artist" path when the operation does not
 * differ. If a real distinction ever needs to exist (e.g. venues get a
 * bulk-import affordance, or artist-published content needs a different
 * default provenance/attribution shape), that is new, additive behaviour on
 * top of this one op — not a reason to have forked it pre-emptively.
 *
 * ## Design: `hashContent`, then `BlobStorePort.put`, then `LibraryService.add`
 *
 * Three steps, each delegating to existing, already-tested machinery rather
 * than reimplementing any of it:
 *
 * 1. **Content hash** — `core`'s `hashContent` (SHA-256, issue #23) computed
 *    directly over the caller-supplied blob bytes. This is the same
 *    primitive `adapters/blob-store-filesystem`'s `FilesystemBlobStorePort`
 *    uses to verify integrity on fetch, and the same one `MetadataToken
 *    .contentHash` is defined in terms of everywhere else in this codebase
 *    (SPEC.md §3.2: "blobs are always addressed by content hash").
 * 2. **Blob storage** — `BlobStorePort.put(contentHash, blob)` (issue #40's
 *    port), so the heavy asset lands wherever this caller's composition root
 *    wired that port to (local filesystem on Node, an in-memory fake in
 *    tests, a future RN-specific adapter for the mobile authoring screen —
 *    see `clients/mobile`'s composition root doc comment for the disclosed
 *    gap this batch does not close).
 * 3. **Library add** — `LibraryService.add(token)` (issue #38's existing use
 *    case), which persists the token to `MetadataRepositoryPort` and applies
 *    `core`'s `addItem` to the in-memory `Library` snapshot — the exact same
 *    path a swap-accepted item takes, so an authored/seeded piece is
 *    immediately a real resident of the library, indistinguishable to
 *    `OfferPolicy`/`AcceptPolicy`/`EvictionPolicy` from anything acquired by
 *    swap. This is what makes the authored piece genuinely offerable
 *    afterwards (issue #55's DoD) — see `./ingestion-service.test.ts` and
 *    `./ingestion-to-swap.test.ts` for the direct proof.
 *
 * ## Design: signing is optional, and mirrors `SwapService`'s existing convention
 *
 * `identity`, when supplied, signs the freshly-built token via `../identity/
 * sign-metadata-token.js` (issue #58) before it reaches `LibraryService.add`
 * — an ingested piece should be attributable to whoever authored it, exactly
 * as SPEC.md §3.1 lists "signature" among a token's contents. When omitted,
 * the token is added unsigned (`signature: ""`), matching every other
 * optional-port convention in `app/src/swap/swap-service.ts` ("omit to skip
 * ... default; keeps existing callers/tests unchanged") — a composition root
 * without a real `IdentityPort` adapter for its platform (e.g.
 * `clients/mobile`, which has no RN identity adapter yet — see that
 * package's own disclosed gap) still gets a working ingestion path, just an
 * unsigned one.
 *
 * ## Rights and licensing: explicitly NOT decided here
 *
 * This service performs the *mechanics* of ingestion. It takes no position
 * on *whether a given piece of content is allowed to be ingested at all* —
 * that is the rights and consent question issue #54 opens (SPEC.md §10,
 * §11 open question 5), which is **not resolved** by this batch (see
 * `docs/rights/consent-model-DRAFT.md`, delivered as a draft proposal for a
 * real artist/venue conversation, not a shipped policy). Nothing in this
 * service enforces "the artist consented" — there is no consent flag on
 * `MetadataToken`, and inventing one here would be exactly the kind of
 * engineering-invented answer to a non-engineering question AGENTS.md §3
 * and this batch's instructions warn against. The one place this boundary
 * is actually enforced today is the placeholder-content hard boundary
 * (`@art-pollinator/seed-placeholder-dev`'s off-by-default gate) — unrelated
 * to this service, which is equally usable for a placeholder fixture in a
 * dev build and for real content once a real consent process exists.
 */
import {
  hashContent,
  isWithinSizeBudget,
  localFilesystemBlobPointer,
  metadataTokenByteSize,
  type IdentityPort,
  type BlobStorePort,
  type MetadataToken,
} from "@art-pollinator/core";
import type { LibraryService } from "../library/library-service.js";
import type { LibraryOperationResult } from "@art-pollinator/core";
import { signMetadataToken } from "../identity/sign-metadata-token.js";

/**
 * What a caller supplies to ingest one piece — venue seeding and artist
 * publishing both fill in exactly these fields (see this file's doc
 * comment). `blob` is the heavy asset's raw bytes; this service computes its
 * content hash and stores it via `BlobStorePort` itself, so callers never
 * compute a hash or pick a blob pointer scheme themselves.
 */
export interface IngestionInput {
  readonly title: string;
  readonly creator: string;
  readonly description: string;
  /** A MIME-style content type, e.g. "image/jpeg", "text/plain" (matches `MetadataToken.contentType`). */
  readonly contentType: string;
  readonly blob: Uint8Array;
}

export type IngestionResult =
  | { readonly ok: true; readonly token: MetadataToken }
  | { readonly ok: false; readonly error: string };

export interface IngestionServiceDeps {
  readonly libraryService: LibraryService;
  readonly blobStore: BlobStorePort;
  /**
   * Signs the freshly-built token before it is added, if supplied. Omit to
   * add an unsigned token — see this file's doc comment ("signing is
   * optional").
   */
  readonly identity?: IdentityPort;
}

export class IngestionService {
  constructor(private readonly deps: IngestionServiceDeps) {}

  /**
   * Ingest one piece: hash `input.blob`, store it, build a `MetadataToken`
   * pointing at it, sign it if an `identity` was configured, and add it to
   * this device/node's `Library` via `LibraryService.add`.
   *
   * Returns `{ ok: false, error }` (never throws) if the resulting token
   * exceeds the ~5 KB size budget (AGENTS.md §6) or if `LibraryService.add`
   * itself rejects (e.g. the swappable pool is full) — in both cases the
   * blob bytes are still left in `blobStore` under their content hash: a
   * `put` is idempotent and content-addressed, so a caller retrying (after
   * freeing a slot, say) does not need to re-supply the blob, and a stray
   * unreferenced blob is a disclosed, low-cost gap (the same shape
   * `BlobStorePort`'s own contract makes no promise about orphan cleanup —
   * no adapter in this codebase does reference counting today).
   */
  async ingest(input: IngestionInput): Promise<IngestionResult> {
    const contentHash = hashContent(input.blob);
    await this.deps.blobStore.put(contentHash, input.blob);

    let token: MetadataToken = {
      title: input.title,
      creator: input.creator,
      description: input.description,
      provenance: { hopCount: 0 },
      contentType: input.contentType,
      blobPointer: localFilesystemBlobPointer(contentHash),
      contentHash,
      signature: "",
    };

    if (!isWithinSizeBudget(token)) {
      return {
        ok: false,
        error:
          `Ingested token exceeds the ~5 KB size budget ` +
          `(${String(metadataTokenByteSize(token))} bytes) — shorten the title/description.`,
      };
    }

    if (this.deps.identity) {
      token = await signMetadataToken(token, this.deps.identity);
    }

    const result: LibraryOperationResult = await this.deps.libraryService.add(token);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, token };
  }
}
