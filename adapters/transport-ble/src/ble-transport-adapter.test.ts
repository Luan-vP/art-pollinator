/**
 * `BleTransportAdapter` tests against a mocked `react-native-ble-plx`-shaped
 * surface (`./fake-ble-central-library.ts`) — NOT real hardware (this
 * sandbox has none; see README.md). Proves: chunking on send, reassembly
 * on receive, and the same `TransportPort` contract suite every other
 * transport in this codebase passes.
 */
import { describe, expect, it } from "vitest";
import {
  createOfferMessage,
  decodeSwapProtocolMessage,
  encodeSwapProtocolMessage,
  transportPortContractCases,
  type MetadataToken,
  type TransportPortPair,
} from "@art-pollinator/core";
import { BleTransportAdapter } from "./ble-transport-adapter.js";
import { chunkMessage, MessageReassembler } from "./ble-chunking.js";
import { base64Decode, base64Encode } from "./base64.js";
import { FakeBleCentralLibrary, FakeBleFabric } from "./fake-ble-central-library.js";

function token(contentHash: string): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "A piece.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { contentHash },
    contentHash,
    signature: "",
  };
}

describe("BleTransportAdapter — send() chunks large messages over a small MTU", () => {
  it("splits a ~5KB message into multiple GATT writes, each within the MTU budget, and they reassemble to the original bytes", async () => {
    const fabric = new FakeBleFabric();
    const writes: string[] = [];
    const central = new FakeBleCentralLibrary({
      selfId: "device-a",
      fabric,
      mtu: 23,
      onWrite: (_target, base64Value) => writes.push(base64Value),
    });
    const adapter = new BleTransportAdapter({ central });

    const message = new Uint8Array(5_000).map((_, i) => i % 256);
    await adapter.send({ id: "device-b" }, message);

    expect(writes.length).toBeGreaterThan(1); // proves chunking actually happened
    for (const w of writes) {
      const frame = base64Decode(w);
      expect(frame.length).toBeLessThanOrEqual(23 - 3); // stays within MTU minus ATT header
    }

    const reassembler = new MessageReassembler();
    let result: Uint8Array | undefined;
    for (const w of writes) result = reassembler.push(base64Decode(w));
    expect(Array.from(result ?? [])).toEqual(Array.from(message));
  });

  it("a message that fits in one chunk still round-trips correctly", async () => {
    const fabric = new FakeBleFabric();
    const writes: string[] = [];
    const central = new FakeBleCentralLibrary({
      selfId: "device-a",
      fabric,
      mtu: 185,
      onWrite: (_t, v) => writes.push(v),
    });
    const adapter = new BleTransportAdapter({ central });
    const message = new Uint8Array([1, 2, 3, 4, 5]);
    await adapter.send({ id: "device-b" }, message);
    expect(writes.length).toBe(1);
  });

  it("reuses the same connection across multiple sends to the same peer (no reconnect per message)", async () => {
    const fabric = new FakeBleFabric();
    let connectCount = 0;
    const realCentral = new FakeBleCentralLibrary({ selfId: "device-a", fabric, mtu: 100 });
    const central = {
      connectToDevice: async (id: string) => {
        connectCount += 1;
        return realCentral.connectToDevice(id);
      },
      cancelDeviceConnection: (id: string) => realCentral.cancelDeviceConnection(id),
    };
    const adapter = new BleTransportAdapter({ central });
    await adapter.send({ id: "device-b" }, new Uint8Array([1]));
    await adapter.send({ id: "device-b" }, new Uint8Array([2]));
    await adapter.send({ id: "device-b" }, new Uint8Array([3]));
    expect(connectCount).toBe(1);
  });
});

describe("BleTransportAdapter — receive() reassembles chunked notifications", () => {
  it("delivers a complete message once all chunks for it have arrived via monitored notifications", async () => {
    const fabric = new FakeBleFabric();
    const central = new FakeBleCentralLibrary({ selfId: "device-a", fabric, mtu: 10 });
    const adapter = new BleTransportAdapter({ central });

    // Establish the connection (and therefore the monitor registration)
    // before simulating any inbound notifications.
    await adapter.connect({ id: "device-b" });

    const original = new Uint8Array([10, 20, 30, 40, 50, 60, 70]);
    const chunks = chunkMessage(original, 10);
    const receivePromise = adapter.receive();
    for (const chunk of chunks) {
      fabric.deliver("device-a", base64Encode(chunk)); // simulates the peer's outbound notification reaching this device
    }
    const inbound = await receivePromise;
    expect(inbound.from).toEqual({ id: "device-b" });
    expect(Array.from(inbound.message)).toEqual(Array.from(original));
  });

  it("carries a real wire-protocol offer message end to end through chunking", async () => {
    const fabric = new FakeBleFabric();
    const central = new FakeBleCentralLibrary({ selfId: "device-a", fabric, mtu: 20 });
    const adapter = new BleTransportAdapter({ central });
    await adapter.connect({ id: "device-b" });

    const offer = createOfferMessage([token("piece-1"), token("piece-2")]);
    const encoded = encodeSwapProtocolMessage(offer);
    const chunks = chunkMessage(encoded, 20);

    const receivePromise = adapter.receive();
    for (const chunk of chunks) fabric.deliver("device-a", base64Encode(chunk));
    const inbound = await receivePromise;
    expect(decodeSwapProtocolMessage(inbound.message)).toEqual(offer);
  });
});

describe("TransportPort contract suite — BleTransportAdapter over a mocked BLE fabric", () => {
  async function makeConnectedPair(): Promise<TransportPortPair> {
    const fabric = new FakeBleFabric();
    const addressA = { id: "device-a" };
    const addressB = { id: "device-b" };
    const centralA = new FakeBleCentralLibrary({ selfId: "device-a", fabric, mtu: 100 });
    const centralB = new FakeBleCentralLibrary({ selfId: "device-b", fabric, mtu: 100 });
    const a = new BleTransportAdapter({ central: centralA });
    const b = new BleTransportAdapter({ central: centralB });
    // The contract suite's cases exercise receive() being called before
    // any send() on either side — real BLE requires the GATT connection
    // (and this Central's notification monitor) to already exist before a
    // peer's write can be observed at all, so the suite's pair factory
    // establishes both connections up front via the adapter-specific
    // `connect()` (see `ble-transport-adapter.ts`'s doc comment on it),
    // exactly as a real composition root would right after discovery.
    await a.connect(addressB);
    await b.connect(addressA);
    return { a, addressA, b, addressB };
  }

  const cases = transportPortContractCases(makeConnectedPair);
  for (const contractCase of cases) {
    it(contractCase.name, contractCase.run);
  }
});
