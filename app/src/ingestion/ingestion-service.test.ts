import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_CAPACITY,
  InMemoryBlobStorePort,
  InMemoryIdentityPort,
  InMemoryMetadataRepositoryPort,
  hashContent,
  hexDecode,
  type LibraryCapacity,
  verifyMetadataTokenSignature,
} from "@art-pollinator/core";
import { InMemorySignatureVerifierPort } from "@art-pollinator/core";
import { LibraryService } from "../library/library-service.js";
import { IngestionService } from "./ingestion-service.js";

function syntheticBlob(label: string): Uint8Array {
  return new TextEncoder().encode(`synthetic-demo-blob:${label}`);
}

describe("IngestionService — issue #53 (venue seeding and artist publishing are the same operation)", () => {
  it("hashes the blob, stores it via BlobStorePort, and adds the resulting token to the Library", async () => {
    const blobStore = new InMemoryBlobStorePort();
    const libraryService = LibraryService.createEmpty(new InMemoryMetadataRepositoryPort());
    const service = new IngestionService({ libraryService, blobStore });

    const blob = syntheticBlob("piece-one");
    const result = await service.ingest({
      title: "Untitled Study",
      creator: "A. Artist",
      description: "A short description.",
      contentType: "image/png",
      blob,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expectedHash = hashContent(blob);
    expect(result.token.contentHash).toBe(expectedHash);
    expect(result.token.title).toBe("Untitled Study");
    expect(result.token.creator).toBe("A. Artist");
    expect(result.token.contentType).toBe("image/png");
    expect(result.token.blobPointer).toEqual({
      scheme: "local-filesystem",
      contentHash: expectedHash,
    });
    expect(result.token.provenance).toEqual({ hopCount: 0 });

    // The blob is genuinely stored, addressable by the same content hash.
    await expect(blobStore.get(expectedHash)).resolves.toEqual(blob);

    // The token is genuinely resident in the library, not just returned.
    const library = libraryService.getLibrary();
    expect(library.entries.has(expectedHash)).toBe(true);
    expect(library.entries.get(expectedHash)?.locked).toBe(false);
  });

  it("computes the SAME content hash for the same bytes regardless of title framing — venue seeding and artist publishing produce identical hashing behaviour", async () => {
    const blob = syntheticBlob("shared-bytes");
    const blobStoreVenue = new InMemoryBlobStorePort();
    const venueService = new IngestionService({
      libraryService: LibraryService.createEmpty(new InMemoryMetadataRepositoryPort()),
      blobStore: blobStoreVenue,
    });
    const blobStoreArtist = new InMemoryBlobStorePort();
    const artistService = new IngestionService({
      libraryService: LibraryService.createEmpty(new InMemoryMetadataRepositoryPort()),
      blobStore: blobStoreArtist,
    });

    // "Venue seeding" framing: a node operator adds a piece to their collection.
    const venueResult = await venueService.ingest({
      title: "Local Show Poster",
      creator: "Venue Curator",
      description: "Seeded directly by the venue.",
      contentType: "image/jpeg",
      blob,
    });
    // "Artist publishing" framing: the same operation, framed as the artist adding their own piece (issue #55's UI affordance).
    const artistResult = await artistService.ingest({
      title: "My Piece",
      creator: "The Artist Themselves",
      description: "Published by me.",
      contentType: "image/jpeg",
      blob,
    });

    expect(venueResult.ok).toBe(true);
    expect(artistResult.ok).toBe(true);
    if (!venueResult.ok || !artistResult.ok) return;

    // Same bytes -> same content hash, regardless of which "framing" ingested them.
    expect(venueResult.token.contentHash).toBe(artistResult.token.contentHash);
  });

  it("signs the token when an IdentityPort is configured (issue #58's signing convention)", async () => {
    const blobStore = new InMemoryBlobStorePort();
    const libraryService = LibraryService.createEmpty(new InMemoryMetadataRepositoryPort());
    const identity = new InMemoryIdentityPort("test-artist-device");
    const service = new IngestionService({ libraryService, blobStore, identity });

    const result = await service.ingest({
      title: "Signed Piece",
      creator: "Signed Artist",
      description: "This one is signed.",
      contentType: "image/png",
      blob: syntheticBlob("signed"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token.signature).not.toBe("");
    expect(result.token.signerPublicKey).toBeDefined();

    const verifier = new InMemorySignatureVerifierPort();
    expect(verifyMetadataTokenSignature(result.token, verifier)).toBe(true);
  });

  it("leaves the token unsigned when no IdentityPort is configured — a working, if unsigned, ingestion path", async () => {
    const service = new IngestionService({
      libraryService: LibraryService.createEmpty(new InMemoryMetadataRepositoryPort()),
      blobStore: new InMemoryBlobStorePort(),
    });

    const result = await service.ingest({
      title: "Unsigned Piece",
      creator: "Someone",
      description: "No identity configured.",
      contentType: "image/png",
      blob: syntheticBlob("unsigned"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token.signature).toBe("");
    expect(result.token.signerPublicKey).toBeUndefined();
  });

  it("returns ok:false, not a thrown error, when the library's swappable pool is full", async () => {
    const capacity: LibraryCapacity = { ...DEFAULT_LIBRARY_CAPACITY, swappableSlots: 0 };
    const libraryService = LibraryService.createEmpty(
      new InMemoryMetadataRepositoryPort(),
      capacity,
    );
    const service = new IngestionService({
      libraryService,
      blobStore: new InMemoryBlobStorePort(),
    });

    const result = await service.ingest({
      title: "No Room",
      creator: "Someone",
      description: "The pool is full.",
      contentType: "image/png",
      blob: syntheticBlob("no-room"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("swappable pool is full");
  });

  it("rejects a token that would exceed the ~5 KB size budget (AGENTS.md §6), without ever storing it in the library", async () => {
    const libraryService = LibraryService.createEmpty(new InMemoryMetadataRepositoryPort());
    const service = new IngestionService({
      libraryService,
      blobStore: new InMemoryBlobStorePort(),
    });

    const result = await service.ingest({
      title: "T".repeat(10_000), // the token's own text fields, not the blob, drive its size
      creator: "Someone",
      description: "Oversized title above.",
      contentType: "image/png",
      blob: syntheticBlob("oversized"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("size budget");
    expect(libraryService.getLibrary().entries.size).toBe(0);
  });

  it("hex-decodes cleanly (sanity: contentHash is well-formed lowercase hex, per core's sha256Hex)", async () => {
    const service = new IngestionService({
      libraryService: LibraryService.createEmpty(new InMemoryMetadataRepositoryPort()),
      blobStore: new InMemoryBlobStorePort(),
    });
    const result = await service.ingest({
      title: "Hex Check",
      creator: "Someone",
      description: "Sanity check.",
      contentType: "image/png",
      blob: syntheticBlob("hex-check"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => hexDecode(result.token.contentHash)).not.toThrow();
  });
});
