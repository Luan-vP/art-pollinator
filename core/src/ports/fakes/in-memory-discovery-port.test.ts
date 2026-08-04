import { describe, expect, it } from "vitest";
import type { DiscoveredPeer } from "../discovery-port.js";
import { InMemoryDiscoveryPort } from "./in-memory-discovery-port.js";

const somePeer: DiscoveredPeer = { address: { id: "peer-1" }, kind: "person" };

describe("InMemoryDiscoveryPort", () => {
  it("is not discovering before startDiscovery is called", () => {
    const discovery = new InMemoryDiscoveryPort();
    expect(discovery.isDiscovering).toBe(false);
  });

  it("round-trips: startDiscovery registers a callback that simulateDiscovered invokes", async () => {
    const discovery = new InMemoryDiscoveryPort();
    const found: DiscoveredPeer[] = [];
    await discovery.startDiscovery((peer) => found.push(peer));
    discovery.simulateDiscovered(somePeer);
    expect(found).toEqual([somePeer]);
  });

  it("is discovering after startDiscovery, and not after stopDiscovery", async () => {
    const discovery = new InMemoryDiscoveryPort();
    await discovery.startDiscovery(() => {
      /* no-op */
    });
    expect(discovery.isDiscovering).toBe(true);
    await discovery.stopDiscovery();
    expect(discovery.isDiscovering).toBe(false);
  });

  it("simulateDiscovered before startDiscovery is a no-op (no callback to invoke)", () => {
    const discovery = new InMemoryDiscoveryPort();
    expect(() => {
      discovery.simulateDiscovered(somePeer);
    }).not.toThrow();
  });

  it("simulateDiscovered after stopDiscovery no longer invokes the old callback", async () => {
    const discovery = new InMemoryDiscoveryPort();
    const found: DiscoveredPeer[] = [];
    await discovery.startDiscovery((peer) => found.push(peer));
    await discovery.stopDiscovery();
    discovery.simulateDiscovered(somePeer);
    expect(found).toEqual([]);
  });

  it("supports multiple discovered peers in sequence", async () => {
    const discovery = new InMemoryDiscoveryPort();
    const found: DiscoveredPeer[] = [];
    await discovery.startDiscovery((peer) => found.push(peer));
    const nodePeer: DiscoveredPeer = { address: { id: "node-1" }, kind: "node" };
    discovery.simulateDiscovered(somePeer);
    discovery.simulateDiscovered(nodePeer);
    expect(found).toEqual([somePeer, nodePeer]);
  });
});
