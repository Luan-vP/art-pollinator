import { describe, it } from "vitest";
import { naiveAcceptPolicy } from "./accept-policy.js";
import { naiveEvictionPolicy } from "./eviction-policy.js";
import { naiveOfferPolicy } from "./offer-policy.js";
import { policyContractCases } from "./policy-contract-suite.js";
import { defaultPriorityPolicy } from "./priority-policy.js";

// This is the file issue #15 (IMPLEMENTATION.md Phase 1a item 15) requires:
// it proves the naive defaults for all four policy seams pass the shared
// contract suite. `policy-contract-suite.ts` itself stays free of any
// `vitest` import (see that file's header comment for why) — this is the
// thin adapter that wires the framework-agnostic cases into vitest's
// describe/it. A later adapter or alternate-policy author does the same
// against their own policy set, by importing `policyContractCases`
// directly — nothing here is naive-default-specific except the four
// `naive*` values passed in below.
describe("policy contract suite — naive defaults (issue #15)", () => {
  const cases = policyContractCases({
    priorityPolicy: defaultPriorityPolicy,
    offerPolicy: naiveOfferPolicy,
    acceptPolicy: naiveAcceptPolicy,
    evictionPolicy: naiveEvictionPolicy,
  });

  for (const contractCase of cases) {
    it(contractCase.name, contractCase.run);
  }
});
