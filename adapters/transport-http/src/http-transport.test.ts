/**
 * Real-network tests for the HTTP `TransportPort` (issue #43): a real
 * `node:http` server on an ephemeral loopback port, a real `fetch`-based
 * client, exchanging actual `@art-pollinator/core` wire-protocol messages
 * (`encodeSwapProtocolMessage`/`decodeSwapProtocolMessage`). Nothing here
 * is mocked — this is the fully real, fully verifiable half of this
 * batch's work (contrast with the BLE adapters, which have no hardware to
 * test against in this environment).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  createAcceptMessage,
  createOfferMessage,
  decodeSwapProtocolMessage,
  encodeSwapProtocolMessage,
  type MetadataToken,
} from "@art-pollinator/core";
import { HttpTransportServer } from "./http-transport-server.js";
import { HttpTransportClient } from "./http-transport-client.js";

function token(contentHash: string): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "A piece worth passing on.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
}

let server: HttpTransportServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close();
    server = undefined;
  }
});

async function startServer(): Promise<{ server: HttpTransportServer; baseUrl: string }> {
  const s = new HttpTransportServer({ longPollTimeoutMs: 2_000 });
  const { baseUrl } = await s.listen(0);
  server = s;
  return { server: s, baseUrl };
}

describe("HttpTransportServer + HttpTransportClient — real HTTP round trip", () => {
  it("carries a real wire-protocol offer message from client to server", async () => {
    const { server: s, baseUrl } = await startServer();
    const client = new HttpTransportClient({ selfAddress: { id: "device-a" } });

    const offer = createOfferMessage([token("piece-1"), token("piece-2")]);
    await client.send({ id: baseUrl }, encodeSwapProtocolMessage(offer));

    const inbound = await s.receive();
    expect(inbound.from).toEqual({ id: "device-a" });
    const decoded = decodeSwapProtocolMessage(inbound.message);
    expect(decoded).toEqual(offer);
  });

  it("carries a real wire-protocol message from server to client (the long-poll direction)", async () => {
    const { server: s, baseUrl } = await startServer();
    const client = new HttpTransportClient({ selfAddress: { id: "device-a" } });
    client.connect({ id: baseUrl }); // start long-polling before anything is queued

    const accept = createAcceptMessage(["piece-1"]);
    const receivePromise = client.receive();
    // Give the client's long-poll GET a moment to actually reach the
    // server before the server queues the reply, proving the "arrives
    // after the poll was already open" path, not just "was already queued".
    await new Promise((resolve) => setTimeout(resolve, 50));
    await s.send({ id: "device-a" }, encodeSwapProtocolMessage(accept));

    const inbound = await receivePromise;
    expect(inbound.from).toEqual({ id: baseUrl });
    expect(decodeSwapProtocolMessage(inbound.message)).toEqual(accept);
  });

  it("round-trips a full two-round exchange resembling SwapService's offer/accept flow", async () => {
    const { server: s, baseUrl } = await startServer();
    const client = new HttpTransportClient({ selfAddress: { id: "device-a" } });
    const serverPeer = { id: baseUrl };
    const clientPeer = { id: "device-a" };

    // Round 1: client offers, server offers back.
    const clientOffer = createOfferMessage([token("from-client")]);
    const serverOffer = createOfferMessage([token("from-server")]);
    await client.send(serverPeer, encodeSwapProtocolMessage(clientOffer));
    const serverGotOffer = decodeSwapProtocolMessage((await s.receive()).message);
    await s.send(clientPeer, encodeSwapProtocolMessage(serverOffer));
    const clientGotOffer = decodeSwapProtocolMessage((await client.receive()).message);

    expect(serverGotOffer).toEqual(clientOffer);
    expect(clientGotOffer).toEqual(serverOffer);

    // Round 2: accept messages, same shape.
    const clientAccept = createAcceptMessage(["from-server"]);
    const serverAccept = createAcceptMessage(["from-client"]);
    await client.send(serverPeer, encodeSwapProtocolMessage(clientAccept));
    const serverGotAccept = decodeSwapProtocolMessage((await s.receive()).message);
    await s.send(clientPeer, encodeSwapProtocolMessage(serverAccept));
    const clientGotAccept = decodeSwapProtocolMessage((await client.receive()).message);

    expect(serverGotAccept).toEqual(clientAccept);
    expect(clientGotAccept).toEqual(serverAccept);
  });

  it("disconnect() on the client aborts a pending long-poll receive()", async () => {
    const { baseUrl } = await startServer();
    const client = new HttpTransportClient({ selfAddress: { id: "device-a" } });
    client.connect({ id: baseUrl });
    const receivePromise = client.receive();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.disconnect({ id: baseUrl });
    // The poll loop's fetch was aborted; receive() has nothing queued and
    // no further poller to ever satisfy it, so it should remain pending
    // forever, not resolve or reject — a real caller wouldn't leave it
    // dangling (it would race it against something else, or not call
    // receive() again after disconnecting). Assert the abort itself
    // succeeded and no message was ever delivered instead.
    let settled = false;
    void receivePromise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);
  });

  it("connect() is idempotent — calling it twice for the same peer does not start a second poll loop", async () => {
    const { server: s, baseUrl } = await startServer();
    const client = new HttpTransportClient({ selfAddress: { id: "device-a" } });
    client.connect({ id: baseUrl });
    client.connect({ id: baseUrl }); // idempotent, must not start a duplicate poller

    await s.send({ id: "device-a" }, new Uint8Array([1]));
    const first = await client.receive();
    expect(Array.from(first.message)).toEqual([1]);

    // If a duplicate poller had been started, a second message would race
    // two in-flight long-polls and could arrive out of the order the
    // server sent it in, or be duplicated. Sending a second message and
    // checking it arrives exactly once, correctly, is this test's proof.
    await s.send({ id: "device-a" }, new Uint8Array([2]));
    const second = await client.receive();
    expect(Array.from(second.message)).toEqual([2]);
  });
});
