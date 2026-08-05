import { describe, expect, it } from "vitest";
import { comparePriority, type PriorityContext } from "../priority/priority.js";
import type { MetadataToken } from "../metadata/metadata-token.js";
import {
  createWeightedPriorityPolicy,
  defaultPriorityPolicy,
  DEFAULT_PRIORITY_WEIGHTS,
  type PriorityWeights,
} from "./priority-policy.js";

const item: MetadataToken = {
  title: "Untitled",
  creator: "Someone",
  description: "A piece.",
  provenance: { hopCount: 0 },
  contentType: "image/jpeg",
  blobPointer: { scheme: "local-filesystem", contentHash: "a".repeat(64) },
  contentHash: "a".repeat(64),
  signature: "",
};

function context(overrides: Partial<PriorityContext> = {}): PriorityContext {
  return { recencyMs: 0, hopCount: 0, dwellMs: 0, ...overrides };
}

describe("defaultPriorityPolicy (weighted combination)", () => {
  it("scores an explicitly-ranked item higher than an unranked one, all else equal", () => {
    const ranked = defaultPriorityPolicy.score(item, context({ userRank: 5 }));
    const unranked = defaultPriorityPolicy.score(item, context({}));
    expect(comparePriority(ranked, unranked)).toBeGreaterThan(0);
  });

  it("treats an unranked item as neutral, not as ranked-at-zero being penalised further than ranked-at-zero would be", () => {
    // userRank omitted and userRank: 0 must score identically under the default policy,
    // since both contribute a userRank term of 0.
    const omitted = defaultPriorityPolicy.score(item, context({}));
    const explicitZero = defaultPriorityPolicy.score(item, context({ userRank: 0 }));
    expect(omitted).toBe(explicitZero);
  });

  it("scores a more recent item higher than an older one, all else equal", () => {
    const recent = defaultPriorityPolicy.score(item, context({ recencyMs: 1_000 }));
    const old = defaultPriorityPolicy.score(item, context({ recencyMs: 1_000_000 }));
    expect(comparePriority(recent, old)).toBeGreaterThan(0);
  });

  it("scores a lower hop-count item higher than a higher hop-count one, all else equal", () => {
    const nearOrigin = defaultPriorityPolicy.score(item, context({ hopCount: 0 }));
    const farFromOrigin = defaultPriorityPolicy.score(item, context({ hopCount: 5 }));
    expect(comparePriority(nearOrigin, farFromOrigin)).toBeGreaterThan(0);
  });

  it("scores a longer-dwelling item higher than a briefly-held one, all else equal", () => {
    const longDwell = defaultPriorityPolicy.score(item, context({ dwellMs: 10_000_000 }));
    const shortDwell = defaultPriorityPolicy.score(item, context({ dwellMs: 1_000 }));
    expect(comparePriority(longDwell, shortDwell)).toBeGreaterThan(0);
  });

  it("is a pure function: identical inputs produce identical output", () => {
    const ctx = context({ userRank: 2, recencyMs: 500, hopCount: 1, dwellMs: 60_000 });
    expect(defaultPriorityPolicy.score(item, ctx)).toBe(defaultPriorityPolicy.score(item, ctx));
  });
});

describe("createWeightedPriorityPolicy with custom weights", () => {
  it("lets a composition root swap in different weights without touching the interface", () => {
    const recencyOnlyWeights: PriorityWeights = {
      userRank: 0,
      recency: -1,
      hopCount: 0,
      dwell: 0,
    };
    const policy = createWeightedPriorityPolicy(recencyOnlyWeights);

    const rankedButOld = policy.score(item, context({ userRank: 999, recencyMs: 100 }));
    const unrankedButNewer = policy.score(item, context({ userRank: 0, recencyMs: 10 }));

    // With userRank weighted to 0, only recency should matter — the newer item wins
    // despite having no user rank, because rank is fully excluded by these weights.
    expect(comparePriority(unrankedButNewer, rankedButOld)).toBeGreaterThan(0);
  });

  it("DEFAULT_PRIORITY_WEIGHTS documents the intended sign of each signal", () => {
    expect(DEFAULT_PRIORITY_WEIGHTS.userRank).toBeGreaterThan(0);
    expect(DEFAULT_PRIORITY_WEIGHTS.recency).toBeLessThan(0);
    expect(DEFAULT_PRIORITY_WEIGHTS.hopCount).toBeLessThan(0);
    expect(DEFAULT_PRIORITY_WEIGHTS.dwell).toBeGreaterThan(0);
  });
});
