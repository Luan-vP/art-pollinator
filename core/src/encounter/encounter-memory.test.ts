import { describe, expect, it } from "vitest";
import type { MetadataToken } from "../metadata/metadata-token.js";
import {
  DEFAULT_ENCOUNTER_SUPPRESSION_WINDOW_MS,
  filterSuppressedCandidates,
  isSuppressed,
  type EncounterHistoryByContentHash,
  type EncounterHistoryEntry,
} from "./encounter-memory.js";

function token(contentHash: string): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "A piece.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
}

function historyMap(
  entries: Record<string, readonly EncounterHistoryEntry[]>,
): EncounterHistoryByContentHash {
  return new Map(Object.entries(entries));
}

describe("isSuppressed", () => {
  it("is false with no history at all", () => {
    expect(isSuppressed(undefined, 1_000, 500)).toBe(false);
  });

  it("is false with an empty history array", () => {
    expect(isSuppressed([], 1_000, 500)).toBe(false);
  });

  it("is true for a 'declined' outcome within the window", () => {
    expect(isSuppressed([{ outcome: "declined", atEpochMs: 900 }], 1_000, 500)).toBe(true);
  });

  it("is true for an 'evicted' outcome within the window", () => {
    expect(isSuppressed([{ outcome: "evicted", atEpochMs: 900 }], 1_000, 500)).toBe(true);
  });

  it("is false once the outcome ages past the window", () => {
    expect(isSuppressed([{ outcome: "declined", atEpochMs: 400 }], 1_000, 500)).toBe(false);
  });

  it("is true for an outcome exactly windowMs old (inclusive boundary)", () => {
    expect(isSuppressed([{ outcome: "declined", atEpochMs: 500 }], 1_000, 500)).toBe(true);
  });

  it("is false for an outcome one millisecond past the window", () => {
    expect(isSuppressed([{ outcome: "declined", atEpochMs: 499 }], 1_000, 500)).toBe(false);
  });

  it("ignores 'offered' and 'accepted' outcomes — only declined/evicted suppress", () => {
    expect(
      isSuppressed(
        [
          { outcome: "offered", atEpochMs: 999 },
          { outcome: "accepted", atEpochMs: 999 },
        ],
        1_000,
        500,
      ),
    ).toBe(false);
  });

  it("is true if any entry in a mixed history is a recent declined/evicted, even amongst non-suppressing ones", () => {
    expect(
      isSuppressed(
        [
          { outcome: "offered", atEpochMs: 100 },
          { outcome: "accepted", atEpochMs: 200 },
          { outcome: "declined", atEpochMs: 950 },
        ],
        1_000,
        500,
      ),
    ).toBe(true);
  });
});

describe("filterSuppressedCandidates", () => {
  it("passes through every candidate when none have suppressing history", () => {
    const candidates = [token("a"), token("b")];
    const result = filterSuppressedCandidates(candidates, historyMap({}), 1_000, 500);
    expect(result).toEqual(candidates);
  });

  it("removes only the candidates with recent declined/evicted history", () => {
    const candidates = [token("declined-recent"), token("clean"), token("evicted-recent")];
    const history = historyMap({
      "declined-recent": [{ outcome: "declined", atEpochMs: 900 }],
      "evicted-recent": [{ outcome: "evicted", atEpochMs: 950 }],
    });
    const result = filterSuppressedCandidates(candidates, history, 1_000, 500);
    expect(result.map((t) => t.contentHash)).toEqual(["clean"]);
  });

  it("preserves the relative order of surviving candidates", () => {
    const candidates = [token("keep-1"), token("suppress"), token("keep-2")];
    const history = historyMap({ suppress: [{ outcome: "declined", atEpochMs: 999 }] });
    const result = filterSuppressedCandidates(candidates, history, 1_000, 500);
    expect(result.map((t) => t.contentHash)).toEqual(["keep-1", "keep-2"]);
  });

  it("un-suppresses a candidate once its declined/evicted record ages past the window", () => {
    const candidates = [token("aged-out")];
    const history = historyMap({ "aged-out": [{ outcome: "declined", atEpochMs: 0 }] });

    const stillWithinWindow = filterSuppressedCandidates(candidates, history, 400, 500);
    expect(stillWithinWindow).toEqual([]);

    const pastWindow = filterSuppressedCandidates(candidates, history, 600, 500);
    expect(pastWindow).toEqual(candidates);
  });

  it("never suppresses based on peer identity — the filter's inputs carry none at all", () => {
    // Item-scoped by construction: EncounterHistoryByContentHash is keyed
    // only by content hash, so there is no peer field anywhere in this
    // filter's signature that a "rotated identity" could even attach to.
    const candidates = [token("shared-item")];
    const history = historyMap({ "shared-item": [{ outcome: "declined", atEpochMs: 900 }] });
    const result = filterSuppressedCandidates(candidates, history, 1_000, 500);
    expect(result).toEqual([]);
  });

  it("has a sane, non-trivial default suppression window exported for callers to fall back on", () => {
    expect(DEFAULT_ENCOUNTER_SUPPRESSION_WINDOW_MS).toBeGreaterThan(0);
  });
});
