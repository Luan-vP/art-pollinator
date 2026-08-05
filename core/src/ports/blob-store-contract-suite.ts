/**
 * Contract suite — one reusable set of behavioural cases every
 * `BlobStorePort` implementation must satisfy: the in-memory fake
 * (`./fakes/in-memory-blob-store-port.ts`) and the filesystem adapter
 * (issue #40, `adapters/blob-store-filesystem/`) both pass this identically
 * (AGENTS.md §2 rule 5: "Every port ships with a contract test suite").
 *
 * ## Fixtures use REAL content hashes, not arbitrary labels
 *
 * Every fixture's "content hash" is `sha256Hex(data)` (`../crypto/sha256.js`
 * — the same hashing primitive `MetadataToken.contentHash` and
 * `BlobPointer.contentHash` are defined in terms of, SPEC.md §3.2) computed
 * from the actual bytes being stored, not an arbitrary label like
 * `"hash-a"`. This is deliberate, not incidental: the filesystem adapter
 * verifies fetched bytes against the requested content hash and throws on a
 * mismatch (issue #40's own DoD), so a shared suite using labels that don't
 * actually correspond to their bytes would make every real `get()` in this
 * suite throw for that adapter — every `BlobStorePort` caller in this
 * codebase already only ever calls `put`/`get` with a real content hash
 * (`MetadataToken.contentHash` / `BlobPointer.contentHash`), so fixtures
 * that do the same are the *more* faithful contract, not an arbitrary
 * tightening for this suite's own sake.
 *
 * ## Scope: round-trip storage semantics only, not corruption detection
 *
 * This suite covers exactly what every `BlobStorePort` implementation can
 * be held to identically: put/get round-trips the same bytes, `get` on a
 * blob never stored is `undefined`, `has` tracks presence, `delete` removes
 * (and is a no-op on an absent blob), and `put` overwrites. It deliberately
 * does **not** include a hash-mismatch (corruption) case: an in-memory `Map`
 * has no failure mode that could ever return corrupted bytes for a key it
 * holds, so there is no way for the fake to "pass" such a case except
 * vacuously. That case — "fetched blobs are verified against their content
 * hash; mismatch is rejected" — is instead exercised by
 * `adapters/blob-store-filesystem`'s own test suite, which can actually
 * manufacture the corrupted-file condition being tested for (see that
 * package's `filesystem-blob-store.test.ts`).
 *
 * Follows the exact structural precedent `metadata-repository-contract-suite.ts`
 * already set: lives beside the port it exercises (not in `fakes/`), is not
 * a `*.test.ts` file (so `scripts/check-core-boundaries.mjs` does not exempt
 * it from `core`'s "no bare imports" rule — it may not import a test
 * framework), and takes a fresh-store factory as its input rather than
 * hardcoding one implementation.
 */
import { sha256Hex } from "../crypto/sha256.js";

export interface BlobStoreContractCase {
  readonly name: string;
  readonly run: () => Promise<void>;
}

function assertTrue(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertBytesEqual(actual: Uint8Array | undefined, expected: Uint8Array): void {
  assertTrue(actual !== undefined, "expected bytes, got undefined");
  const a = actual as Uint8Array;
  assertTrue(
    a.length === expected.length && a.every((b, i) => b === expected[i]),
    `bytes are not equal: actual=[${Array.from(a).join(",")}] expected=[${Array.from(expected).join(",")}]`,
  );
}

/** A (contentHash, data) fixture pair where contentHash genuinely is `sha256Hex(data)` — see this file's doc comment. */
function fixture(data: readonly number[]): {
  readonly contentHash: string;
  readonly data: Uint8Array;
} {
  const bytes = new Uint8Array(data);
  return { contentHash: sha256Hex(bytes), data: bytes };
}

/** Minimal shape every `BlobStorePort` implementation exposes — kept local to avoid an import cycle back to the port file for the type alone. */
export interface BlobStoreUnderTest {
  put(contentHash: string, data: Uint8Array): Promise<void>;
  get(contentHash: string): Promise<Uint8Array | undefined>;
  has(contentHash: string): Promise<boolean>;
  delete(contentHash: string): Promise<void>;
}

/**
 * Build the full list of contract cases for a given blob-store factory.
 * `makeFreshStore` is allowed to be async (a real adapter may need to
 * create a temp directory, open a connection, etc).
 */
export function blobStoreContractCases(
  makeFreshStore: () => BlobStoreUnderTest | Promise<BlobStoreUnderTest>,
): readonly BlobStoreContractCase[] {
  const cases: BlobStoreContractCase[] = [];

  cases.push({
    name: "round-trip: put then get returns the same bytes",
    run: async () => {
      const store = await makeFreshStore();
      const { contentHash, data } = fixture([1, 2, 3, 4, 5]);
      await store.put(contentHash, data);
      const found = await store.get(contentHash);
      assertBytesEqual(found, data);
    },
  });

  cases.push({
    name: "get returns undefined for a blob never put",
    run: async () => {
      const store = await makeFreshStore();
      const { contentHash } = fixture([0xde, 0xad, 0xbe, 0xef]);
      const found = await store.get(contentHash);
      assertTrue(found === undefined, "expected undefined for a content hash never stored");
    },
  });

  cases.push({
    name: "has reports false before put and true after",
    run: async () => {
      const store = await makeFreshStore();
      const { contentHash, data } = fixture([9]);
      assertTrue((await store.has(contentHash)) === false, "expected false before put");
      await store.put(contentHash, data);
      assertTrue((await store.has(contentHash)) === true, "expected true after put");
    },
  });

  cases.push({
    name: "delete removes a blob; has reports false afterward",
    run: async () => {
      const store = await makeFreshStore();
      const { contentHash, data } = fixture([1, 2, 3]);
      await store.put(contentHash, data);
      await store.delete(contentHash);
      assertTrue((await store.has(contentHash)) === false, "expected false after delete");
      const found = await store.get(contentHash);
      assertTrue(found === undefined, "expected undefined after delete");
    },
  });

  cases.push({
    name: "delete is a no-op for a content hash never stored",
    run: async () => {
      const store = await makeFreshStore();
      const { contentHash } = fixture([0x99]);
      await store.delete(contentHash); // must not throw
    },
  });

  cases.push({
    // A content-addressed store can never legitimately hold two different
    // byte payloads under the same real content hash (that would be a hash
    // collision) — so "overwrite" for a hash-verifying adapter means
    // "putting the same (contentHash, data) pair again is safe and
    // idempotent," not "different bytes replace old ones under a shared
    // key." The latter would only arise from a caller passing a
    // contentHash that doesn't match its data, which is a caller bug this
    // suite deliberately does not construct (see this file's doc comment).
    name: "put is idempotent: putting the same (contentHash, data) pair twice still round-trips correctly",
    run: async () => {
      const store = await makeFreshStore();
      const { contentHash, data } = fixture([1, 2, 3]);
      await store.put(contentHash, data);
      await store.put(contentHash, data);
      const found = await store.get(contentHash);
      assertBytesEqual(found, data);
    },
  });

  cases.push({
    name: "distinct content hashes are stored independently",
    run: async () => {
      const store = await makeFreshStore();
      const a = fixture([1]);
      const b = fixture([2]);
      await store.put(a.contentHash, a.data);
      await store.put(b.contentHash, b.data);
      assertBytesEqual(await store.get(a.contentHash), a.data);
      assertBytesEqual(await store.get(b.contentHash), b.data);
    },
  });

  cases.push({
    name: "a fresh store instance from makeFreshStore never carries over state from a previous instance",
    run: async () => {
      const first = await makeFreshStore();
      const { contentHash, data } = fixture([7, 7, 7]);
      await first.put(contentHash, data);

      const second = await makeFreshStore();
      assertTrue(
        (await second.has(contentHash)) === false,
        "a fresh store must not already hold a blob put to a previous instance",
      );
    },
  });

  return cases;
}
