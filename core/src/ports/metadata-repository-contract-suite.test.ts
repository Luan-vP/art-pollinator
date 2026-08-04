import { describe, it } from "vitest";
import { InMemoryMetadataRepositoryPort } from "./fakes/in-memory-metadata-repository-port.js";
import { metadataRepositoryContractCases } from "./metadata-repository-contract-suite.js";

// Issue #26 (IMPLEMENTATION.md Phase 1a item 26): proves the contract suite
// is well-formed by running it against the existing in-memory fake (issue
// #18), and gives a regression check while building the SQLite adapter
// (issue #25) against the identical suite in
// `adapters/metadata-repository-sqlite/src/sqlite-metadata-repository.test.ts`.
// `metadata-repository-contract-suite.ts` itself stays free of any `vitest`
// import (see that file's header comment for why) — this is the thin
// adapter that wires the framework-agnostic cases into vitest's
// describe/it, mirroring `policy-contract-suite.test.ts`'s pattern.
describe("metadata repository contract suite — in-memory fake (issue #18)", () => {
  const cases = metadataRepositoryContractCases(() => new InMemoryMetadataRepositoryPort());

  for (const contractCase of cases) {
    it(contractCase.name, contractCase.run);
  }
});
