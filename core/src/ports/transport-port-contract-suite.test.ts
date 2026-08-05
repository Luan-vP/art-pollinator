import { describe, it } from "vitest";
import { createInMemoryTransportPair } from "./fakes/in-memory-transport-port.js";
import { transportPortContractCases } from "./transport-port-contract-suite.js";

// Proves the contract suite is well-formed by running it against the
// existing in-memory fake (issue #18), and gives a regression check while
// building the HTTP (issue #43) and BLE (issue #33) adapters against the
// identical suite in their own packages. `transport-port-contract-suite.ts`
// itself stays free of any `vitest` import — this is the thin adapter that
// wires the framework-agnostic cases into vitest's describe/it, mirroring
// `metadata-repository-contract-suite.test.ts`'s pattern.
describe("transport port contract suite — in-memory fake (issue #18)", () => {
  const cases = transportPortContractCases(() => {
    const addressA = { id: "device-a" };
    const addressB = { id: "device-b" };
    const { a, b } = createInMemoryTransportPair(addressA, addressB);
    return { a, addressA, b, addressB };
  });

  for (const contractCase of cases) {
    it(contractCase.name, contractCase.run);
  }
});
