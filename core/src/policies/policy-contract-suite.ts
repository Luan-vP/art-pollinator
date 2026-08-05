/**
 * Policy contract suite — one reusable set of behavioural cases every
 * `PriorityPolicy`, `OfferPolicy`, `AcceptPolicy`, and `EvictionPolicy`
 * implementation must satisfy, including (but not limited to) the naive
 * defaults (issue #15, IMPLEMENTATION.md Phase 1a item 15, AGENTS.md §2
 * rule 5: "Every port/seam ships a contract test suite").
 *
 * ## Design: plain assertion functions, no test-framework import
 *
 * This file is *not* named `*.test.ts`, so `scripts/check-core-boundaries.mjs`
 * does **not** exempt it from `core`'s "no bare imports" rule — it may not
 * depend on the `vitest` package at all (see that script's own comment: the
 * exemption is scoped to files matching the test/spec filename pattern, not
 * to anything conceptually test-related). Rather than fight that boundary,
 * this suite is framework-agnostic by construction: each case is a plain
 * `() => void` that throws a plain `Error` on failure. A real test file
 * (`policy-contract-suite.test.ts`, which *does* match the pattern and may
 * import `vitest`) wraps each case in `it(name, run)`. A future adapter or
 * alternate-policy author does the same from their own `*.test.ts` file,
 * against whatever test runner they use — nothing here is vitest-specific.
 *
 * ## Design: policies and fixtures are both inputs, not hardcoded
 *
 * `policyContractCases` takes a `PolicyContractSubject` (the four policies
 * under test) and optional `PolicyContractFixtures` (currently just
 * `makeToken`, for overriding how a `MetadataToken` fixture is constructed).
 * Nothing in this file references `naiveOfferPolicy` or any other concrete
 * default — those are wired in by `policy-contract-suite.test.ts`, which
 * exercises the suite against the naive defaults specifically, satisfying
 * this issue's "naive defaults must pass" criterion without coupling the
 * suite itself to any one implementation. A later adapter package (or a
 * differently-tuned `PriorityPolicy`) reuses `policyContractCases` by
 * importing it and supplying its own policy set.
 */

import { MAX_LOCKABLE_SLOTS, SWAPPABLE_SLOTS } from "../constants.js";
import type { Library, LibraryEntry } from "../library/library.js";
import type { MetadataToken } from "../metadata/metadata-token.js";
import type { PeerKind } from "../ports/discovery-port.js";
import {
  comparePriority,
  toPriority,
  type Priority,
  type PriorityContext,
} from "../priority/priority.js";
import type { AcceptPolicy } from "./accept-policy.js";
import type { EvictionPolicy } from "./eviction-policy.js";
import type { OfferPolicy } from "./offer-policy.js";
import type { PriorityPolicy } from "./priority-policy.js";
import type { Item } from "./policy-types.js";

/** The four policy seams (SPEC.md §5) this suite exercises together. */
export interface PolicyContractSubject {
  readonly priorityPolicy: PriorityPolicy;
  readonly offerPolicy: OfferPolicy;
  readonly acceptPolicy: AcceptPolicy;
  readonly evictionPolicy: EvictionPolicy;
}

/** Overrides for how this suite builds its test fixtures. All optional — sensible defaults are used otherwise. */
export interface PolicyContractFixtures {
  /** Build a `MetadataToken` fixture for the given content hash. Override to exercise the suite against differently-shaped tokens (e.g. non-default `contentType`, larger `description`) without touching the suite itself. */
  readonly makeToken?: (contentHash: string) => MetadataToken;
}

/** A single named, runnable contract case. `run` throws a plain `Error` on failure. */
export interface PolicyContractCase {
  readonly name: string;
  readonly run: () => void;
}

const defaultMakeToken = (contentHash: string): MetadataToken => ({
  title: `Piece ${contentHash}`,
  creator: "Someone",
  description: "A piece.",
  provenance: { hopCount: 0 },
  contentType: "image/jpeg",
  blobPointer: { scheme: "local-filesystem", contentHash },
  contentHash,
  signature: "",
});

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertHashesEqual(
  actual: readonly Item[],
  expectedHashes: readonly string[],
  message: string,
): void {
  const actualHashes = actual
    .map((item) => item.contentHash)
    .slice()
    .sort();
  const expected = [...expectedHashes].sort();
  assertTrue(
    actualHashes.length === expected.length && actualHashes.every((h, i) => h === expected[i]),
    `${message} (expected [${expected.join(", ")}], got [${actualHashes.join(", ")}])`,
  );
}

interface RawEntrySpec {
  readonly contentHash: string;
  readonly locked: boolean;
  readonly priority: number;
}

function buildLibrary(
  entries: readonly RawEntrySpec[],
  makeToken: (hash: string) => MetadataToken,
): Library {
  const map = new Map<string, LibraryEntry>();
  for (const e of entries) {
    map.set(e.contentHash, {
      token: makeToken(e.contentHash),
      locked: e.locked,
      priority: toPriority(e.priority),
    });
  }
  return { entries: map };
}

const PEER_KINDS: readonly PeerKind[] = ["node", "person"];

/**
 * Build the full list of contract cases for a given policy set. Every case
 * is self-contained (constructs its own fixtures) so cases can be run in
 * any order, individually or as a whole, by whatever test runner the caller
 * uses.
 */
export function policyContractCases(
  subject: PolicyContractSubject,
  fixtures: PolicyContractFixtures = {},
): readonly PolicyContractCase[] {
  const makeToken = fixtures.makeToken ?? defaultMakeToken;
  const { priorityPolicy, offerPolicy, acceptPolicy, evictionPolicy } = subject;

  function context(overrides: Partial<PriorityContext> = {}): PriorityContext {
    return { recencyMs: 0, hopCount: 0, dwellMs: 0, ...overrides };
  }

  const cases: PolicyContractCase[] = [];

  // --- PriorityPolicy ------------------------------------------------

  cases.push({
    name: "PriorityPolicy.score is a pure function: identical inputs produce identical output",
    run: () => {
      const item = makeToken("priority-purity");
      const ctx = context({ userRank: 3, recencyMs: 1_000, hopCount: 2, dwellMs: 5_000 });
      const first = priorityPolicy.score(item, ctx);
      const second = priorityPolicy.score(item, ctx);
      assertTrue(
        first === second,
        "PriorityPolicy.score must be deterministic for identical inputs",
      );
    },
  });

  cases.push({
    name: "PriorityPolicy.score always returns a finite, comparable Priority",
    run: () => {
      const item = makeToken("priority-finite");
      const contexts = [
        context(),
        context({ userRank: 0 }),
        context({ userRank: 100, recencyMs: 10_000_000, hopCount: 50, dwellMs: 0 }),
      ];
      for (const ctx of contexts) {
        const result: Priority = priorityPolicy.score(item, ctx);
        assertTrue(Number.isFinite(result), "PriorityPolicy.score must return a finite number");
      }
    },
  });

  // --- OfferPolicy: shared locked-item invariant ----------------------

  cases.push({
    name: "OfferPolicy never offers a locked item — 5 locked + 5 swappable simultaneously",
    run: () => {
      const entries: RawEntrySpec[] = [];
      for (let i = 0; i < MAX_LOCKABLE_SLOTS; i++) {
        entries.push({ contentHash: `locked-${String(i)}`, locked: true, priority: 0 });
      }
      for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
        entries.push({ contentHash: `swap-${String(i)}`, locked: false, priority: 0 });
      }
      const library = buildLibrary(entries, makeToken);

      for (const peerKind of PEER_KINDS) {
        const offered = offerPolicy.selectOffer(library, peerKind);
        for (const item of offered) {
          assertTrue(
            !item.contentHash.startsWith("locked-"),
            `OfferPolicy must never offer a locked item, but offered "${item.contentHash}" for peerKind "${peerKind}"`,
          );
        }
      }
    },
  });

  cases.push({
    name: "OfferPolicy never offers a locked item — adversarial: the locked pool is the only non-empty pool",
    run: () => {
      // Deliberately more locked entries than MAX_LOCKABLE_SLOTS would ever
      // normally allow, and zero swappable entries — constructed directly,
      // not via Library's own lockItem, so the policy cannot be relying on
      // Library's capacity invariants having held to reach this state.
      const library = buildLibrary(
        Array.from({ length: 9 }, (_, i) => ({
          contentHash: `only-locked-${String(i)}`,
          locked: true,
          priority: i,
        })),
        makeToken,
      );

      for (const peerKind of PEER_KINDS) {
        const offered = offerPolicy.selectOffer(library, peerKind);
        assertTrue(
          offered.length === 0,
          `OfferPolicy must offer nothing when every held item is locked, but offered ${String(offered.length)} item(s) for peerKind "${peerKind}"`,
        );
      }
    },
  });

  cases.push({
    name: "OfferPolicy only offers items actually held in the library (no fabricated items)",
    run: () => {
      const entries: RawEntrySpec[] = [
        { contentHash: "held-a", locked: false, priority: 0 },
        { contentHash: "held-b", locked: false, priority: 0 },
      ];
      const library = buildLibrary(entries, makeToken);
      const held = new Set(entries.map((e) => e.contentHash));

      for (const peerKind of PEER_KINDS) {
        const offered = offerPolicy.selectOffer(library, peerKind);
        for (const item of offered) {
          assertTrue(
            held.has(item.contentHash),
            `OfferPolicy offered an item not held by the library: "${item.contentHash}"`,
          );
        }
      }
    },
  });

  // --- AcceptPolicy ----------------------------------------------------

  cases.push({
    name: "AcceptPolicy never accepts more items than remaining swappable capacity",
    run: () => {
      const library = buildLibrary(
        Array.from({ length: SWAPPABLE_SLOTS - 1 }, (_, i) => ({
          contentHash: `existing-${String(i)}`,
          locked: false,
          priority: 0,
        })),
        makeToken,
      );
      const offered = Array.from({ length: 20 }, (_, i) => makeToken(`offer-${String(i)}`));
      const accepted = acceptPolicy.selectAccept(offered, library);
      assertTrue(
        accepted.length <= 1,
        `AcceptPolicy accepted ${String(accepted.length)} item(s) with only 1 slot of remaining capacity`,
      );
    },
  });

  cases.push({
    name: "AcceptPolicy accepts nothing beyond a full swappable pool",
    run: () => {
      const library = buildLibrary(
        Array.from({ length: SWAPPABLE_SLOTS }, (_, i) => ({
          contentHash: `existing-${String(i)}`,
          locked: false,
          priority: 0,
        })),
        makeToken,
      );
      const offered = [makeToken("new-1"), makeToken("new-2")];
      const accepted = acceptPolicy.selectAccept(offered, library);
      assertTrue(
        accepted.length === 0,
        "AcceptPolicy must accept nothing when the swappable pool is already full",
      );
    },
  });

  cases.push({
    name: "AcceptPolicy only accepts items that were actually offered (no fabrication)",
    run: () => {
      const offered = [makeToken("real-1"), makeToken("real-2")];
      const offeredHashes = new Set(offered.map((t) => t.contentHash));
      const accepted = acceptPolicy.selectAccept(offered, buildLibrary([], makeToken));
      for (const item of accepted) {
        assertTrue(
          offeredHashes.has(item.contentHash),
          `AcceptPolicy accepted an item that was never offered: "${item.contentHash}"`,
        );
      }
    },
  });

  cases.push({
    name: "AcceptPolicy never returns duplicate content hashes",
    run: () => {
      const offered = [makeToken("dup"), makeToken("dup"), makeToken("unique")];
      const accepted = acceptPolicy.selectAccept(offered, buildLibrary([], makeToken));
      const hashes = accepted.map((t) => t.contentHash);
      assertTrue(
        new Set(hashes).size === hashes.length,
        "AcceptPolicy returned a duplicate content hash",
      );
    },
  });

  // --- EvictionPolicy: shared locked-item invariant ---------------------

  cases.push({
    name: "EvictionPolicy never evicts a locked item — 5 locked + 5 swappable simultaneously",
    run: () => {
      const entries: RawEntrySpec[] = [];
      for (let i = 0; i < MAX_LOCKABLE_SLOTS; i++) {
        entries.push({ contentHash: `locked-${String(i)}`, locked: true, priority: -1000 });
      }
      for (let i = 0; i < SWAPPABLE_SLOTS; i++) {
        entries.push({ contentHash: `swap-${String(i)}`, locked: false, priority: i });
      }
      const library = buildLibrary(entries, makeToken);
      const incoming = Array.from({ length: SWAPPABLE_SLOTS }, (_, i) =>
        makeToken(`incoming-${String(i)}`),
      );

      const evicted = evictionPolicy.selectEvict(library, incoming);
      for (const item of evicted) {
        assertTrue(
          !item.contentHash.startsWith("locked-"),
          `EvictionPolicy must never evict a locked item, but evicted "${item.contentHash}"`,
        );
      }
    },
  });

  cases.push({
    name: "EvictionPolicy never evicts a locked item — adversarial: it is simultaneously the lowest-priority item in the whole library",
    run: () => {
      const entries: RawEntrySpec[] = [
        { contentHash: "locked-lowest", locked: true, priority: -1_000_000 },
        ...Array.from({ length: SWAPPABLE_SLOTS }, (_, i) => ({
          contentHash: `swap-${String(i)}`,
          locked: false,
          priority: i,
        })),
      ];
      const library = buildLibrary(entries, makeToken);
      const evicted = evictionPolicy.selectEvict(library, [makeToken("incoming")]);
      for (const item of evicted) {
        assertTrue(
          item.contentHash !== "locked-lowest",
          "EvictionPolicy must never evict a locked item, even when it is the library's lowest-priority item",
        );
      }
    },
  });

  cases.push({
    name: "EvictionPolicy evicts only items actually held in the swappable pool (no fabrication, no locked items)",
    run: () => {
      const entries: RawEntrySpec[] = [
        { contentHash: "locked-a", locked: true, priority: -1 },
        { contentHash: "swap-a", locked: false, priority: 0 },
        { contentHash: "swap-b", locked: false, priority: 1 },
      ];
      const library = buildLibrary(entries, makeToken);
      const swappableHashes = new Set(["swap-a", "swap-b"]);
      const evicted = evictionPolicy.selectEvict(library, [
        makeToken("in-1"),
        makeToken("in-2"),
        makeToken("in-3"),
      ]);
      for (const item of evicted) {
        assertTrue(
          swappableHashes.has(item.contentHash),
          `EvictionPolicy evicted an item not in the swappable pool: "${item.contentHash}"`,
        );
      }
    },
  });

  cases.push({
    name: "EvictionPolicy evicts nothing when incoming already fits without eviction",
    run: () => {
      const library = buildLibrary(
        Array.from({ length: SWAPPABLE_SLOTS - 1 }, (_, i) => ({
          contentHash: `swap-${String(i)}`,
          locked: false,
          priority: i,
        })),
        makeToken,
      );
      const evicted = evictionPolicy.selectEvict(library, [makeToken("incoming")]);
      assertTrue(
        evicted.length === 0,
        "EvictionPolicy must evict nothing when there is already room for incoming items",
      );
    },
  });

  return cases;
}

// Re-exported for callers that want to assert on specific hash sets directly
// (e.g. a future adapter's own additional cases layered on top of this
// suite) without redefining the comparison helper.
export { assertHashesEqual, assertTrue, comparePriority };
