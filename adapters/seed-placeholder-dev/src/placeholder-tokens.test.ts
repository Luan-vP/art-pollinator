import { describe, expect, it } from "vitest";
import { isWithinSizeBudget, isTokenSigned } from "@art-pollinator/core";
import { PLACEHOLDER_METADATA_TOKENS } from "./placeholder-tokens.js";

describe("PLACEHOLDER_METADATA_TOKENS — synthetic, obviously-fake fixtures (issue #42)", () => {
  it("is non-empty", () => {
    expect(PLACEHOLDER_METADATA_TOKENS.length).toBeGreaterThan(0);
  });

  it("every token is a valid, unsigned MetadataToken within the size budget", () => {
    for (const token of PLACEHOLDER_METADATA_TOKENS) {
      expect(isWithinSizeBudget(token)).toBe(true);
      expect(isTokenSigned(token)).toBe(false);
    }
  });

  it("every token's contentHash is deterministic (re-importing produces the same fixtures)", async () => {
    const { PLACEHOLDER_METADATA_TOKENS: reimported } = await import("./placeholder-tokens.js");
    expect(reimported.map((t) => t.contentHash)).toEqual(
      PLACEHOLDER_METADATA_TOKENS.map((t) => t.contentHash),
    );
  });

  it("content hashes are unique across all fixtures (no accidental duplicates)", () => {
    const hashes = PLACEHOLDER_METADATA_TOKENS.map((t) => t.contentHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("every token's title and creator are obviously synthetic placeholders, not plausible real names", () => {
    const obviouslyFakeMarkers = ["placeholder", "fixture", "untitled", "sample", "dev seed"];
    for (const token of PLACEHOLDER_METADATA_TOKENS) {
      const haystack = `${token.title} ${token.creator}`.toLowerCase();
      expect(obviouslyFakeMarkers.some((marker) => haystack.includes(marker))).toBe(true);
    }
  });

  it("every token's blobPointer uses the local-filesystem scheme and shares the token's own contentHash", () => {
    for (const token of PLACEHOLDER_METADATA_TOKENS) {
      expect(token.blobPointer.scheme).toBe("local-filesystem");
      expect(token.blobPointer.contentHash).toBe(token.contentHash);
    }
  });
});
