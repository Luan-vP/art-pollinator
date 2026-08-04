import { describe, expect, it } from "vitest";
import { createInMemoryTransportPair, InMemoryTransportPort } from "./in-memory-transport-port.js";

const addressA = { id: "device-a" };
const addressB = { id: "device-b" };

describe("InMemoryTransportPort", () => {
  it("round-trips: a message sent by one paired transport arrives via the other's receive()", async () => {
    const { a, b } = createInMemoryTransportPair(addressA, addressB);
    const payload = new Uint8Array([1, 2, 3]);

    await a.send(addressB, payload);
    const received = await b.receive();

    expect(received.from).toEqual(addressA);
    expect(received.message).toEqual(payload);
  });

  it("receive() resolves immediately from a queued message sent before receive() was called", async () => {
    const { a, b } = createInMemoryTransportPair(addressA, addressB);
    await a.send(addressB, new Uint8Array([9]));
    // receive() is called strictly after send() above already completed —
    // the message must already be queued, not lost.
    const received = await b.receive();
    expect(received.message).toEqual(new Uint8Array([9]));
  });

  it("receive() resolves once a message arrives, when called before send()", async () => {
    const { a, b } = createInMemoryTransportPair(addressA, addressB);
    const receivePromise = b.receive();
    await a.send(addressB, new Uint8Array([5]));
    const received = await receivePromise;
    expect(received.message).toEqual(new Uint8Array([5]));
  });

  it("is bidirectional: both ends can send to and receive from each other", async () => {
    const { a, b } = createInMemoryTransportPair(addressA, addressB);
    await a.send(addressB, new Uint8Array([1]));
    await b.send(addressA, new Uint8Array([2]));

    const bReceived = await b.receive();
    const aReceived = await a.receive();

    expect(bReceived.message).toEqual(new Uint8Array([1]));
    expect(aReceived.message).toEqual(new Uint8Array([2]));
  });

  it("preserves message order within a single direction", async () => {
    const { a, b } = createInMemoryTransportPair(addressA, addressB);
    await a.send(addressB, new Uint8Array([1]));
    await a.send(addressB, new Uint8Array([2]));
    await a.send(addressB, new Uint8Array([3]));

    const first = await b.receive();
    const second = await b.receive();
    const third = await b.receive();

    expect([first.message, second.message, third.message]).toEqual([
      new Uint8Array([1]),
      new Uint8Array([2]),
      new Uint8Array([3]),
    ]);
  });

  it("rejects send() to an address it is not connected to", async () => {
    const unconnected = new InMemoryTransportPort(addressA);
    await expect(unconnected.send(addressB, new Uint8Array([1]))).rejects.toThrow();
  });

  it("disconnect() releases the peer wiring, so a subsequent send() rejects", async () => {
    const { a } = createInMemoryTransportPair(addressA, addressB);
    await a.disconnect(addressB);
    await expect(a.send(addressB, new Uint8Array([1]))).rejects.toThrow();
  });
});
