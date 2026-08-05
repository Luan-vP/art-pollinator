import { afterEach, describe, expect, it } from "vitest";
import { LanDiscoveryResponder } from "./lan-discovery-responder.js";

let responder: LanDiscoveryResponder | undefined;

afterEach(async () => {
  await responder?.close();
  responder = undefined;
});

describe("LanDiscoveryResponder", () => {
  it("responds to a real GET request with its own peer id and kind as JSON", async () => {
    responder = new LanDiscoveryResponder({
      selfPeerId: "http://127.0.0.1:48123",
      selfKind: "node",
    });
    await responder.listen(48123, "127.0.0.1");

    const response = await fetch("http://127.0.0.1:48123/art-pollinator-node");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { peerId: string; kind: string };
    expect(body).toEqual({ peerId: "http://127.0.0.1:48123", kind: "node" });
  });

  it("returns 404 for any other path", async () => {
    responder = new LanDiscoveryResponder({ selfPeerId: "peer", selfKind: "person" });
    await responder.listen(48124, "127.0.0.1");
    const response = await fetch("http://127.0.0.1:48124/something-else");
    expect(response.status).toBe(404);
  });
});
