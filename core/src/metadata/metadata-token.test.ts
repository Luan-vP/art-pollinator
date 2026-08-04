import { describe, expect, it } from "vitest";
import {
  isWithinSizeBudget,
  metadataTokenByteSize,
  serializeMetadataToken,
  validateMetadataTokenSize,
  type MetadataToken,
} from "./metadata-token.js";
import { METADATA_TOKEN_MAX_BYTES } from "../constants.js";

/** Deterministic filler text of a given length — no randomness needed in `core` tests. */
function fillerText(length: number): string {
  const base =
    "Study for a coastline at dusk, oil and pigment on reclaimed canvas, exploring erosion as a slow form of drawing. ";
  let out = "";
  while (out.length < length) {
    out += base;
  }
  return out.slice(0, length);
}

function makeToken(overrides: Partial<MetadataToken> = {}): MetadataToken {
  return {
    title: "Coastline Study No. 4",
    creator: "R. Alaba",
    description: fillerText(200),
    provenance: { hopCount: 2 },
    contentType: "image/jpeg",
    blobPointer: { contentHash: "a".repeat(64) },
    contentHash: "a".repeat(64),
    signature: "",
    ...overrides,
  };
}

describe("MetadataToken shape", () => {
  it("has no field for an embedded preview image", () => {
    const token = makeToken();
    const keys = Object.keys(serializeJson(token));
    for (const forbidden of ["previewImage", "thumbnail", "image", "imageData", "preview"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("carries the fields specified in SPEC.md §3.1", () => {
    const token = makeToken();
    expect(token).toMatchObject({
      title: expect.any(String),
      creator: expect.any(String),
      description: expect.any(String),
      provenance: { hopCount: expect.any(Number) },
      contentType: expect.any(String),
      blobPointer: { contentHash: expect.any(String) },
      contentHash: expect.any(String),
      signature: expect.any(String),
    });
  });
});

function serializeJson(token: MetadataToken): Record<string, unknown> {
  return JSON.parse(serializeMetadataToken(token)) as Record<string, unknown>;
}

describe("size budget — realistic tokens", () => {
  const realisticShapes: Array<[string, Partial<MetadataToken>]> = [
    ["short title/description", { title: "Untitled", description: fillerText(50) }],
    ["typical wall-text length description", { description: fillerText(400) }],
    ["long creator name and title", { creator: fillerText(80), title: fillerText(120) }],
    ["generous description, still plausible", { description: fillerText(1500) }],
  ];

  it.each(realisticShapes)("%s stays under the ~5 KB budget", (_label, overrides) => {
    const token = makeToken(overrides);
    const size = metadataTokenByteSize(token);
    expect(size).toBeLessThanOrEqual(METADATA_TOKEN_MAX_BYTES);
    expect(isWithinSizeBudget(token)).toBe(true);
    expect(() => validateMetadataTokenSize(token)).not.toThrow();
  });

  it("byte size matches the serialisation's length for pure-ASCII content", () => {
    // For ASCII-only text, UTF-8 byte length equals character length —
    // an independent sanity check on the byte-counting logic.
    const token = makeToken();
    const serialized = serializeMetadataToken(token);
    expect(/^[\x00-\x7f]*$/.test(serialized)).toBe(true);
    expect(metadataTokenByteSize(token)).toBe(serialized.length);
  });

  it("accounts for multi-byte UTF-8 characters, not just character count", () => {
    const asciiToken = makeToken({ description: fillerText(100) });
    const unicodeToken = makeToken({ description: "🎨".repeat(100) }); // each emoji is 4 bytes in UTF-8
    expect(metadataTokenByteSize(unicodeToken)).toBeGreaterThan(metadataTokenByteSize(asciiToken));
  });
});

describe("size budget — maximally-stuffed token", () => {
  it("a token stuffed with maximally-long realistic field values is clearly flagged over budget", () => {
    const stuffedToken = makeToken({
      title: fillerText(300),
      creator: fillerText(150),
      description: fillerText(8000), // far beyond a plausible wall-text blurb, well past 5 KB alone
    });

    const size = metadataTokenByteSize(stuffedToken);
    expect(size).toBeGreaterThan(METADATA_TOKEN_MAX_BYTES);
    expect(isWithinSizeBudget(stuffedToken)).toBe(false);
    expect(() => validateMetadataTokenSize(stuffedToken)).toThrow(/exceeds size budget/);
  });

  it("a token at the edge of a plausible description length stays under budget", () => {
    // ~2 KB description plus the other fields comfortably clears the ~5 KB budget
    // without needing every field maxed out simultaneously.
    const edgeToken = makeToken({ description: fillerText(2000) });
    expect(isWithinSizeBudget(edgeToken)).toBe(true);
  });
});
