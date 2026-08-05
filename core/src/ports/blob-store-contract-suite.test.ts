import { describe, it } from "vitest";
import { blobStoreContractCases } from "./blob-store-contract-suite.js";
import { InMemoryBlobStorePort } from "./fakes/in-memory-blob-store-port.js";

describe("BlobStorePort contract suite — InMemoryBlobStorePort (issue #40, AGENTS.md §2 rule 5)", () => {
  for (const { name, run } of blobStoreContractCases(() => new InMemoryBlobStorePort())) {
    it(name, run);
  }
});
