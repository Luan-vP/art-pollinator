import { describe, expect, it } from "vitest";
import { MAX_OFFER_ITEMS, validateOfferItems } from "./ingest-validation.js";
import type { MetadataToken } from "../metadata/metadata-token.js";

function token(contentHash: string, descriptionLength = 10): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "x".repeat(descriptionLength),
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
}

describe("validateOfferItems (issue #49 — content validation on ingest)", () => {
  it("accepts every item when all are within the size budget and the offer is within the count limit", () => {
    const items = [token("a"), token("b"), token("c")];
    const result = validateOfferItems(items);
    expect(result.accepted).toEqual(items);
    expect(result.rejectedOversizedItems).toEqual([]);
    expect(result.rejectedWholeOfferTooLarge).toBe(false);
  });

  it("drops an individual item exceeding the ~5 KB token size budget, keeping the rest", () => {
    const huge = token("huge", 10_000); // well beyond METADATA_TOKEN_MAX_BYTES
    const normal = token("normal");
    const result = validateOfferItems([huge, normal]);
    expect(result.accepted).toEqual([normal]);
    expect(result.rejectedOversizedItems).toEqual([huge]);
    expect(result.rejectedWholeOfferTooLarge).toBe(false);
  });

  it("rejects the whole offer outright when it exceeds MAX_OFFER_ITEMS — no partial acceptance", () => {
    const items = Array.from({ length: MAX_OFFER_ITEMS + 1 }, (_, i) => token(`item-${String(i)}`));
    const result = validateOfferItems(items);
    expect(result.rejectedWholeOfferTooLarge).toBe(true);
    expect(result.accepted).toEqual([]);
    expect(result.rejectedOversizedItems).toEqual([]);
  });

  it("accepts an offer at exactly MAX_OFFER_ITEMS", () => {
    const items = Array.from({ length: MAX_OFFER_ITEMS }, (_, i) => token(`item-${String(i)}`));
    const result = validateOfferItems(items);
    expect(result.rejectedWholeOfferTooLarge).toBe(false);
    expect(result.accepted).toHaveLength(MAX_OFFER_ITEMS);
  });

  it("handles an empty offer (a one-way swap's receiving side offers nothing)", () => {
    const result = validateOfferItems([]);
    expect(result).toEqual({
      accepted: [],
      rejectedOversizedItems: [],
      rejectedWholeOfferTooLarge: false,
    });
  });
});
