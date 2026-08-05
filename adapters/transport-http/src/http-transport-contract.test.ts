/**
 * Runs `@art-pollinator/core`'s `transportPortContractCases` (issue #43's
 * "passes the identical `TransportPort` contract suite" as the BLE adapter,
 * #33) against a real `HttpTransportServer` + `HttpTransportClient` pair —
 * a genuinely networked pass of the same suite the in-memory fake and the
 * (mocked) BLE adapter also run.
 */
import { afterEach, describe, it } from "vitest";
import { transportPortContractCases, type TransportPortPair } from "@art-pollinator/core";
import { HttpTransportServer } from "./http-transport-server.js";
import { HttpTransportClient } from "./http-transport-client.js";

const openServers: HttpTransportServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.map((s) => s.close()));
  openServers.length = 0;
});

async function makeConnectedPair(): Promise<TransportPortPair> {
  const server = new HttpTransportServer({ longPollTimeoutMs: 3_000 });
  const { baseUrl } = await server.listen(0);
  openServers.push(server);

  const addressA = { id: "device-a" };
  const addressB = { id: baseUrl };
  const client = new HttpTransportClient({ selfAddress: addressA });

  return { a: client, addressA, b: server, addressB };
}

describe("TransportPort contract suite — HttpTransportServer + HttpTransportClient (issue #43)", () => {
  const cases = transportPortContractCases(makeConnectedPair);
  for (const contractCase of cases) {
    it(contractCase.name, contractCase.run);
  }
});
