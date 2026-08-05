/**
 * Repository contract suite — one reusable set of behavioural cases every
 * `MetadataRepositoryPort` implementation must satisfy: the in-memory fake
 * (issue #18, `./fakes/in-memory-metadata-repository-port.ts`) and the
 * SQLite adapter (issue #25, `adapters/metadata-repository-sqlite/`) both
 * pass this identically (issue #26, AGENTS.md §2 rule 5: "Every port ships
 * a contract test suite").
 *
 * ## Placement: sibling of the port, not a `fakes/` subfolder
 *
 * This lives at `core/src/ports/metadata-repository-contract-suite.ts`,
 * next to `metadata-repository-port.ts` — the interface it exercises.
 * `core/src/policies/policy-contract-suite.ts` sets the precedent this
 * follows: a contract suite sits beside the thing it contracts, not beside
 * any one implementation. (`fakes/` is reserved for concrete in-memory
 * implementations, not for suites that run *against* an implementation.)
 *
 * ## Design: plain assertion functions, no test-framework import
 *
 * This file is *not* named `*.test.ts`, so `scripts/check-core-boundaries.mjs`
 * does **not** exempt it from `core`'s "no bare imports" rule (see that
 * script's comment, and `policy-contract-suite.ts`'s header for the same
 * reasoning applied there). It may not import `vitest`. Each case is a
 * plain `() => Promise<void>` (repository operations are async — see
 * `MetadataRepositoryPort`) that throws a plain `Error` on failure.
 * `metadata-repository-contract-suite.test.ts` (which *does* match the
 * test-file pattern) wraps each case in `it(name, run)` against the
 * in-memory fake. `adapters/metadata-repository-sqlite`'s own `*.test.ts`
 * does the same against the SQLite adapter — nothing here is fake- or
 * adapter-specific.
 *
 * ## Design: the repository factory is the input, not a hardcoded fake
 *
 * `metadataRepositoryContractCases` takes `makeFreshRepository`, a factory
 * producing a new, empty `MetadataRepositoryPort` per call (allowed to be
 * async, since a real adapter may need to open a file/connection). Every
 * case calls it itself and builds its own fixtures, so cases are
 * independent, order-agnostic, and runnable individually or as a whole by
 * whatever test runner the caller uses.
 */

import type { MetadataToken } from "../metadata/metadata-token.js";
import type { MetadataRepositoryPort } from "./metadata-repository-port.js";

/** A single named, runnable contract case. `run` throws a plain `Error` on failure. */
export interface MetadataRepositoryContractCase {
  readonly name: string;
  readonly run: () => Promise<void>;
}

/** Overrides for how this suite builds its test fixtures. All optional. */
export interface MetadataRepositoryContractFixtures {
  /** Build a `MetadataToken` fixture for the given content hash. Override to exercise the suite against differently-shaped tokens without touching the suite itself. */
  readonly makeToken?: (contentHash: string) => MetadataToken;
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

/** A signed-token fixture — exercises the optional `signerPublicKey` field through a round-trip. */
function signedToken(contentHash: string): MetadataToken {
  return {
    title: `Signed piece ${contentHash}`,
    creator: "Someone Else",
    description: "A signed piece.",
    provenance: { hopCount: 2 },
    contentType: "text/plain",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "aa".repeat(64), // 128 hex chars — a plausible Ed25519 signature shape
    signerPublicKey: "bb".repeat(32), // 64 hex chars — a plausible Ed25519 public key shape
  };
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Structural equality that treats an `undefined`-valued (or entirely
 * absent) property the same way — matching how `expect(...).toEqual` in
 * the existing in-memory fake's test already treats them (see
 * `fakes/in-memory-metadata-repository-port.test.ts`), and matching how a
 * SQL adapter may reasonably represent "no `signerPublicKey`" as an omitted
 * key rather than a literal `undefined` property.
 */
function normalize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function assertTokensEqual(actual: MetadataToken | undefined, expected: MetadataToken): void {
  assertTrue(actual !== undefined, "expected a token, got undefined");
  const actualNormalized = JSON.stringify(normalize(actual));
  const expectedNormalized = JSON.stringify(normalize(expected));
  assertTrue(
    actualNormalized === expectedNormalized,
    `tokens are not equal:\n  actual:   ${actualNormalized}\n  expected: ${expectedNormalized}`,
  );
}

function assertContentHashSetEquals(
  actual: readonly MetadataToken[],
  expectedHashes: readonly string[],
  message: string,
): void {
  const actualHashes = actual
    .map((t) => t.contentHash)
    .slice()
    .sort();
  const expected = [...expectedHashes].sort();
  assertTrue(
    actualHashes.length === expected.length && actualHashes.every((h, i) => h === expected[i]),
    `${message} (expected [${expected.join(", ")}], got [${actualHashes.join(", ")}])`,
  );
}

/**
 * Build the full list of contract cases for a given repository factory.
 * Covers: store-then-retrieve round-trip (including the optional
 * `signerPublicKey` field), retrieval of a non-existent token,
 * update/overwrite semantics, deletion (including no-op deletion of an
 * absent token), and `listAll` querying.
 */
export function metadataRepositoryContractCases(
  makeFreshRepository: () => MetadataRepositoryPort | Promise<MetadataRepositoryPort>,
  fixtures: MetadataRepositoryContractFixtures = {},
): readonly MetadataRepositoryContractCase[] {
  const makeToken = fixtures.makeToken ?? defaultMakeToken;
  const cases: MetadataRepositoryContractCase[] = [];

  cases.push({
    name: "round-trip: save then findByContentHash returns the same token",
    run: async () => {
      const repo = await makeFreshRepository();
      const t = makeToken("a");
      await repo.save(t);
      const found = await repo.findByContentHash("a");
      assertTokensEqual(found, t);
    },
  });

  cases.push({
    name: "round-trip: a signed token (with signerPublicKey) survives save/findByContentHash unchanged",
    run: async () => {
      const repo = await makeFreshRepository();
      const t = signedToken("signed-a");
      await repo.save(t);
      const found = await repo.findByContentHash("signed-a");
      assertTokensEqual(found, t);
    },
  });

  cases.push({
    name: "findByContentHash returns undefined for a non-existent content hash",
    run: async () => {
      const repo = await makeFreshRepository();
      const found = await repo.findByContentHash("does-not-exist");
      assertTrue(found === undefined, "expected undefined for an unknown content hash");
    },
  });

  cases.push({
    name: "findByContentHash returns undefined on a repository with other tokens held, but not this one",
    run: async () => {
      const repo = await makeFreshRepository();
      await repo.save(makeToken("held-1"));
      await repo.save(makeToken("held-2"));
      const found = await repo.findByContentHash("not-held");
      assertTrue(found === undefined, "expected undefined for a hash never saved");
    },
  });

  cases.push({
    name: "save overwrites an existing token with the same content hash (update semantics, not append)",
    run: async () => {
      const repo = await makeFreshRepository();
      await repo.save(makeToken("a"));
      const updated: MetadataToken = { ...makeToken("a"), title: "Updated title" };
      await repo.save(updated);

      const found = await repo.findByContentHash("a");
      assertTokensEqual(found, updated);

      const all = await repo.listAll();
      const matching = all.filter((t) => t.contentHash === "a");
      assertTrue(
        matching.length === 1,
        `save must overwrite, not duplicate: expected exactly 1 entry for "a", found ${String(matching.length)}`,
      );
    },
  });

  cases.push({
    name: "save overwrite can flip a token between unsigned and signed",
    run: async () => {
      const repo = await makeFreshRepository();
      await repo.save(makeToken("flip"));
      const nowSigned: MetadataToken = { ...signedToken("flip") };
      await repo.save(nowSigned);
      const found = await repo.findByContentHash("flip");
      assertTokensEqual(found, nowSigned);
    },
  });

  cases.push({
    name: "delete removes a token by content hash",
    run: async () => {
      const repo = await makeFreshRepository();
      await repo.save(makeToken("a"));
      await repo.delete("a");
      const found = await repo.findByContentHash("a");
      assertTrue(found === undefined, "expected the token to be gone after delete");
    },
  });

  cases.push({
    name: "delete is a no-op for a content hash that was never held",
    run: async () => {
      const repo = await makeFreshRepository();
      await repo.delete("never-existed"); // must not throw
      const all = await repo.listAll();
      assertTrue(all.length === 0, "delete of an absent token must not create or affect any row");
    },
  });

  cases.push({
    name: "delete only removes the targeted token, leaving others intact",
    run: async () => {
      const repo = await makeFreshRepository();
      await repo.save(makeToken("keep-1"));
      await repo.save(makeToken("remove-me"));
      await repo.save(makeToken("keep-2"));
      await repo.delete("remove-me");
      const all = await repo.listAll();
      assertContentHashSetEquals(all, ["keep-1", "keep-2"], "delete affected the wrong rows");
    },
  });

  cases.push({
    name: "listAll on a fresh repository is empty",
    run: async () => {
      const repo = await makeFreshRepository();
      const all = await repo.listAll();
      assertTrue(Array.isArray(all) && all.length === 0, "expected an empty array");
    },
  });

  cases.push({
    name: "listAll returns every currently-persisted token, order-independent",
    run: async () => {
      const repo = await makeFreshRepository();
      await repo.save(makeToken("a"));
      await repo.save(makeToken("b"));
      await repo.save(makeToken("c"));
      const all = await repo.listAll();
      assertContentHashSetEquals(all, ["a", "b", "c"], "listAll did not return every saved token");
    },
  });

  cases.push({
    name: "a fresh repository instance from makeFreshRepository never carries over state from a previous instance",
    run: async () => {
      const first = await makeFreshRepository();
      await first.save(makeToken("leftover"));

      const second = await makeFreshRepository();
      const all = await second.listAll();
      assertTrue(
        all.every((t) => t.contentHash !== "leftover"),
        "a fresh repository must not already contain a token saved to a previous instance",
      );
    },
  });

  return cases;
}
