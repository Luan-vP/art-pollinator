/**
 * SwapService trust-model tests (issue #59) — proving the two claims this
 * batch's design rests on:
 *
 * 1. A flooding **node** identity, throttled repeatedly across several
 *    separate rate-limit windows, gets *progressively* more restricted by
 *    `AcceptPolicy` — not just the same flat per-window limit every time
 *    (issue #59's explicit acceptance criterion: "Test simulates a
 *    flooding node across multiple rate-limit windows and proving it gets
 *    progressively more restricted").
 * 2. The identical flooding pattern from a **person**-kind peer never
 *    moves `TrustTracker` at all — proving the privacy-scoping decision in
 *    `SwapServiceDeps.trustTracker`'s doc comment (and
 *    `docs/adr/0017-trust-tracker-scoped-to-node-identities.md`) actually
 *    holds in the one real call site, not just on paper.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_LIBRARY,
  InMemoryClockPort,
  InMemoryEncounterLogPort,
  InMemoryMetadataRepositoryPort,
  SlidingWindowRateLimiter,
  TrustTracker,
  createInMemoryTransportPair,
  createNaiveAcceptPolicy,
  naiveEvictionPolicy,
  naiveOfferPolicy,
  type DiscoveredPeer,
  type Library,
  type LibraryCapacity,
  type MetadataToken,
  type PeerAddress,
  type PeerKind,
} from "@art-pollinator/core";
import { SwapService } from "./swap-service.js";

/** A fixed batch of distinct-content-hash tokens, unique per (epoch, attempt) so dedup never suppresses a count this test is trying to measure. */
function offerBatch(epoch: number, attempt: number, count: number): MetadataToken[] {
  return Array.from({ length: count }, (_, i) => {
    // Padded with "z" (never present in the numeric/hyphen prefix) rather
    // than "0" — padding with a digit risks two different indices (e.g.
    // "i1" and "i10") producing the *same* final 64-char string once
    // padded, silently colliding two supposedly-distinct content hashes.
    const contentHash = `flood-e${String(epoch)}-a${String(attempt)}-i${String(i)}`.padEnd(64, "z");
    return {
      title: `Junk ${contentHash}`,
      creator: "Flooder",
      description: "",
      provenance: { hopCount: 0 },
      contentType: "text/plain",
      blobPointer: { scheme: "local-filesystem", contentHash },
      contentHash,
      signature: "",
    } satisfies MetadataToken;
  });
}

const OFFER_BATCH_SIZE = 20;
const TARGET_CAPACITY: LibraryCapacity = { maxLockableSlots: 0, swappableSlots: 20 };
const RATE_LIMIT_WINDOW_MS = 1_000;

interface RunEpochDeps {
  readonly rateLimiter: SlidingWindowRateLimiter;
  readonly trustTracker: TrustTracker;
  readonly flooderAddress: PeerAddress;
  readonly targetAddress: PeerAddress;
  readonly targetPerceivesFlooderAs: PeerKind;
  readonly epoch: number;
  readonly baseTimeMs: number;
}

/**
 * Run one rate-limit window's worth of the flooder's behaviour: one
 * allowed attempt (measuring how many items `AcceptPolicy` accepts *right
 * now*, reflecting whatever trust history prior epochs already left
 * behind), then one attempt that exceeds the window's limit and gets
 * throttled (feeding this epoch's bad mark into `TrustTracker` for the
 * *next* epoch to see). Returns the allowed attempt's accepted count.
 */
async function runEpoch(deps: RunEpochDeps): Promise<number> {
  const {
    rateLimiter,
    trustTracker,
    flooderAddress,
    targetAddress,
    targetPerceivesFlooderAs,
    epoch,
    baseTimeMs,
  } = deps;

  async function attempt(attemptIndex: number, timeMs: number): Promise<number> {
    const { a: transportFlooder, b: transportTarget } = createInMemoryTransportPair(
      flooderAddress,
      targetAddress,
    );
    const flooderLibrary: Library = EMPTY_LIBRARY;
    const batch = offerBatch(epoch, attemptIndex, OFFER_BATCH_SIZE);

    const flooderService = new SwapService({
      transport: transportFlooder,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(timeMs),
      offerPolicy: { selectOffer: () => batch },
      acceptPolicy: createNaiveAcceptPolicy(20),
      evictionPolicy: naiveEvictionPolicy,
      receiveTimeoutMs: 200,
    });
    const targetService = new SwapService({
      transport: transportTarget,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(timeMs),
      offerPolicy: naiveOfferPolicy, // target's own library is always empty — offers nothing back (one-way from target's side)
      acceptPolicy: createNaiveAcceptPolicy(TARGET_CAPACITY.swappableSlots),
      evictionPolicy: naiveEvictionPolicy,
      libraryCapacity: TARGET_CAPACITY,
      swapRateLimiter: rateLimiter,
      trustTracker,
      receiveTimeoutMs: 200,
    });

    const targetPeer: DiscoveredPeer = { address: flooderAddress, kind: targetPerceivesFlooderAs };
    const flooderPeer: DiscoveredPeer = { address: targetAddress, kind: "person" };

    const results = await Promise.allSettled([
      flooderService.swap(flooderPeer, flooderLibrary),
      targetService.swap(targetPeer, EMPTY_LIBRARY),
    ]);
    const targetResult = results[1];
    return targetResult.status === "fulfilled" ? targetResult.value.accepted.length : -1; // -1 marks "throttled/aborted"
  }

  const allowedCount = await attempt(0, baseTimeMs);
  const throttledCount = await attempt(1, baseTimeMs + 10);
  expect(throttledCount).toBe(-1); // the second attempt in the same window must be throttled

  return allowedCount;
}

describe("TrustTracker + SwapService — a flooding node identity across multiple rate-limit windows (issue #59)", () => {
  it("gets progressively more restricted each window — not the same flat cap every time", async () => {
    const rateLimiter = new SlidingWindowRateLimiter({
      maxEvents: 1,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    const trustTracker = new TrustTracker();
    const flooderAddress: PeerAddress = { id: "flooding-node" };
    const targetAddress: PeerAddress = { id: "target-device" };

    const acceptedCounts: number[] = [];
    for (let epoch = 0; epoch < 4; epoch++) {
      const accepted = await runEpoch({
        rateLimiter,
        trustTracker,
        flooderAddress,
        targetAddress,
        targetPerceivesFlooderAs: "node",
        epoch,
        // Each epoch starts a fresh rate-limit window — comfortably spaced
        // beyond RATE_LIMIT_WINDOW_MS so the two attempts within an epoch
        // share a window but different epochs never do.
        baseTimeMs: epoch * (RATE_LIMIT_WINDOW_MS * 2),
      });
      acceptedCounts.push(accepted);
    }

    // The real claim: strictly decreasing, proving compounding restriction
    // across windows — a flat per-window rate limit alone would instead
    // produce the *same* allowed-attempt accepted count every epoch.
    for (let i = 1; i < acceptedCounts.length; i++) {
      expect(acceptedCounts[i]).toBeLessThan(acceptedCounts[i - 1] as number);
    }
    // And the very first epoch, before any history exists, is unpenalized —
    // a brand-new node identity is never punished just for showing up.
    expect(acceptedCounts[0]).toBe(OFFER_BATCH_SIZE);

    const finalSnapshot = trustTracker.getSnapshot("flooding-node", 100_000);
    expect(finalSnapshot.badCount).toBeGreaterThanOrEqual(3); // one throttle recorded per epoch after the first
    expect(finalSnapshot.trustLevel).not.toBe("neutral");
  });

  it("a person-kind peer with the identical throttling pattern never moves TrustTracker at all (privacy scoping)", async () => {
    const rateLimiter = new SlidingWindowRateLimiter({
      maxEvents: 1,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });
    const trustTracker = new TrustTracker();
    const flooderAddress: PeerAddress = { id: "flooding-person" };
    const targetAddress: PeerAddress = { id: "target-device-2" };

    const acceptedCounts: number[] = [];
    for (let epoch = 0; epoch < 3; epoch++) {
      const accepted = await runEpoch({
        rateLimiter,
        trustTracker,
        flooderAddress,
        targetAddress,
        targetPerceivesFlooderAs: "person", // the scoping boundary under test
        epoch,
        baseTimeMs: epoch * (RATE_LIMIT_WINDOW_MS * 2),
      });
      acceptedCounts.push(accepted);
    }

    // No progressive restriction — every allowed attempt gets the full,
    // unpenalized batch, because trust tracking never engaged for a
    // person-kind peer, even though the rate limiter (a separate,
    // already-accepted short-window mechanism) still throttled the second
    // attempt in every window exactly as before.
    expect(acceptedCounts).toEqual([OFFER_BATCH_SIZE, OFFER_BATCH_SIZE, OFFER_BATCH_SIZE]);

    // The strongest form of the claim: TrustTracker was never even written
    // to for this identity — not "forgiving," genuinely untouched.
    expect(trustTracker.trackedKeyCount()).toBe(0);
  });
});
