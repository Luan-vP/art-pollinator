import { describe, expect, it } from "vitest";
import {
  createTrustAdjustedAcceptPolicy,
  TrustTracker,
  classifyTrustLevel,
} from "./trust-tracker.js";
import { createNaiveAcceptPolicy } from "../policies/accept-policy.js";
import { EMPTY_LIBRARY } from "../library/library.js";
import type { Item } from "../policies/policy-types.js";

function item(contentHash: string): Item {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
}

describe("TrustTracker — a brand-new identity", () => {
  it("reports the neutral, fully-unpenalized default — never punishes a peer just for being new", () => {
    const tracker = new TrustTracker();
    const snapshot = tracker.getSnapshot("never-seen", 0);
    expect(snapshot.trustLevel).toBe("neutral");
    expect(snapshot.acceptCapacityFraction).toBe(1);
    expect(snapshot.netPenalty).toBe(0);
  });
});

describe("TrustTracker — recording outcomes", () => {
  it("a throttled/rejected outcome increases netPenalty and shrinks acceptCapacityFraction", () => {
    const tracker = new TrustTracker();
    tracker.recordOutcome("flooder", "throttled", 1_000);
    const snapshot = tracker.getSnapshot("flooder", 1_000);
    expect(snapshot.badCount).toBe(1);
    expect(snapshot.netPenalty).toBe(1);
    expect(snapshot.acceptCapacityFraction).toBe(0.5);
    expect(snapshot.trustLevel).toBe("low-trust");
  });

  it("netPenalty grows monotonically as more bad outcomes accumulate, never resetting on its own", () => {
    const tracker = new TrustTracker();
    const fractions: number[] = [];
    for (let i = 0; i < 6; i++) {
      tracker.recordOutcome("repeat-offender", "throttled", i * 1_000);
      fractions.push(tracker.acceptCapacityFraction("repeat-offender", i * 1_000));
    }
    // Strictly decreasing — proves the penalty compounds across separate
    // calls (standing in for separate rate-limit windows), not just once.
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeLessThan(fractions[i - 1] as number);
    }
    expect(tracker.getSnapshot("repeat-offender", 6_000).trustLevel).toBe("quarantined");
    expect(
      tracker.getSnapshot("repeat-offender", 6_000).acceptCapacityFraction,
    ).toBeLessThanOrEqual(1 / 6);
  });

  it("a reciprocal swap forgives exactly one prior bad mark, never boosting past the unpenalized ceiling", () => {
    const tracker = new TrustTracker();
    tracker.recordOutcome("mixed-history", "throttled", 0);
    tracker.recordOutcome("mixed-history", "throttled", 1_000);
    expect(tracker.getSnapshot("mixed-history", 1_000).netPenalty).toBe(2);

    tracker.recordOutcome("mixed-history", "reciprocalSwap", 2_000);
    expect(tracker.getSnapshot("mixed-history", 2_000).netPenalty).toBe(1);

    tracker.recordOutcome("mixed-history", "reciprocalSwap", 3_000);
    expect(tracker.getSnapshot("mixed-history", 3_000).netPenalty).toBe(0);
    expect(tracker.getSnapshot("mixed-history", 3_000).acceptCapacityFraction).toBe(1);

    // A third reciprocal swap, with no further bad marks, cannot push
    // acceptCapacityFraction above 1 — there is no "more permissive than
    // unpenalized" (see the module doc comment).
    tracker.recordOutcome("mixed-history", "reciprocalSwap", 4_000);
    const snapshot = tracker.getSnapshot("mixed-history", 4_000);
    expect(snapshot.acceptCapacityFraction).toBe(1);
    expect(snapshot.trustLevel).toBe("trusted");
  });

  it("a one-way swap moves neither reciprocalCount nor badCount — only reciprocal swaps build trust", () => {
    const tracker = new TrustTracker();
    tracker.recordOutcome("one-way-seeder", "oneWaySwap", 0);
    tracker.recordOutcome("one-way-seeder", "oneWaySwap", 1_000);
    tracker.recordOutcome("one-way-seeder", "oneWaySwap", 2_000);
    const snapshot = tracker.getSnapshot("one-way-seeder", 2_000);
    expect(snapshot.reciprocalCount).toBe(0);
    expect(snapshot.badCount).toBe(0);
    expect(snapshot.acceptCapacityFraction).toBe(1);
    expect(snapshot.trustLevel).toBe("neutral");
  });
});

describe("classifyTrustLevel", () => {
  it("classifies the four levels at their documented boundaries", () => {
    expect(classifyTrustLevel(0, 0)).toBe("neutral");
    expect(classifyTrustLevel(0, 3)).toBe("trusted");
    expect(classifyTrustLevel(1, 0)).toBe("low-trust");
    expect(classifyTrustLevel(4, 0)).toBe("low-trust");
    expect(classifyTrustLevel(5, 0)).toBe("quarantined");
    expect(classifyTrustLevel(9, 9)).toBe("quarantined"); // netPenalty is already the forgiven value; classify trusts its input
  });
});

describe("prune", () => {
  it("drops keys not seen within maxAgeMs, keeps recently-seen ones", () => {
    const tracker = new TrustTracker();
    tracker.recordOutcome("stale", "throttled", 0);
    tracker.recordOutcome("fresh", "throttled", 9_000);
    tracker.prune(10_000, 5_000);
    expect(tracker.trackedKeyCount()).toBe(1);
    expect(tracker.getSnapshot("stale", 10_000).badCount).toBe(0); // pruned — starts fresh
    expect(tracker.getSnapshot("fresh", 10_000).badCount).toBe(1); // retained
  });
});

describe("createTrustAdjustedAcceptPolicy", () => {
  const offered = [item("a"), item("b"), item("c"), item("d"), item("e")];

  it("passes through the base policy's selection unchanged at fraction 1 (neutral/trusted identities)", () => {
    const base = createNaiveAcceptPolicy(5);
    const wrapped = createTrustAdjustedAcceptPolicy(base, 1, 5);
    expect(wrapped.selectAccept(offered, EMPTY_LIBRARY)).toEqual(
      base.selectAccept(offered, EMPTY_LIBRARY),
    );
  });

  it("truncates the base policy's selection to floor(swappableSlots * fraction)", () => {
    const base = createNaiveAcceptPolicy(5);
    const wrapped = createTrustAdjustedAcceptPolicy(base, 0.5, 5); // cap = floor(2.5) = 2
    const result = wrapped.selectAccept(offered, EMPTY_LIBRARY);
    expect(result).toHaveLength(2);
    expect(result).toEqual(offered.slice(0, 2));
  });

  it("a fraction low enough to floor to zero accepts nothing at all — the literal meaning of 'quarantined'", () => {
    const base = createNaiveAcceptPolicy(5);
    const wrapped = createTrustAdjustedAcceptPolicy(base, 1 / 6, 5); // floor(0.833) = 0
    expect(wrapped.selectAccept(offered, EMPTY_LIBRARY)).toEqual([]);
  });

  it("never accepts more than the base policy itself would have (the cap is a ceiling, not a floor)", () => {
    const base = createNaiveAcceptPolicy(5);
    const wrapped = createTrustAdjustedAcceptPolicy(base, 1, 5);
    // Base policy already limits to remaining capacity (5); a generous
    // trust fraction must not somehow accept more than that.
    expect(wrapped.selectAccept(offered, EMPTY_LIBRARY).length).toBeLessThanOrEqual(5);
  });
});
