/**
 * Real-network tests for `HttpProbeLanDiscoveryAdapter` (issue #44): two
 * instances bound to distinct real loopback addresses (127.0.0.1 and
 * 127.0.0.2 — both are valid loopback addresses on Linux, verified in this
 * environment; see README.md) on the *same* known port, each probing the
 * other. Nothing here is mocked — real `node:http` servers, real `fetch`
 * probes, a real `TimerSchedulerPort` driving the probe cadence.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoveredPeer } from "@art-pollinator/core";
import { TimerSchedulerPort } from "@art-pollinator/scheduler-timer";
import { HttpProbeLanDiscoveryAdapter } from "./http-probe-lan-discovery-adapter.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let nextPort = 48_000; // avoid port collisions across tests in the same run
function freshPort(): number {
  nextPort += 1;
  return nextPort;
}

const activeAdapters: HttpProbeLanDiscoveryAdapter[] = [];
const activeTimers: TimerSchedulerPort[] = [];

afterEach(async () => {
  await Promise.all(activeAdapters.map((a) => a.stopDiscovery()));
  activeAdapters.length = 0;
  for (const t of activeTimers) t.cancelAll();
  activeTimers.length = 0;
});

describe("HttpProbeLanDiscoveryAdapter — two real instances on loopback", () => {
  it("discover each other within a short window, each via the other's known-port responder", async () => {
    const port = freshPort();
    const timerA = new TimerSchedulerPort();
    const timerB = new TimerSchedulerPort();
    activeTimers.push(timerA, timerB);

    const nodeA = new HttpProbeLanDiscoveryAdapter({
      selfAddress: { id: "http://127.0.0.1:" + String(port) },
      selfKind: "person",
      host: "127.0.0.1",
      port,
      candidateHosts: ["127.0.0.2"],
      scheduler: timerA,
      probeIntervalMs: 150,
      probeTimeoutMs: 300,
    });
    const nodeB = new HttpProbeLanDiscoveryAdapter({
      selfAddress: { id: "http://127.0.0.2:" + String(port) },
      selfKind: "node",
      host: "127.0.0.2",
      port,
      candidateHosts: ["127.0.0.1"],
      scheduler: timerB,
      probeIntervalMs: 150,
      probeTimeoutMs: 300,
    });
    activeAdapters.push(nodeA, nodeB);

    const foundByA: DiscoveredPeer[] = [];
    const foundByB: DiscoveredPeer[] = [];
    await nodeA.startDiscovery((peer) => foundByA.push(peer));
    await nodeB.startDiscovery((peer) => foundByB.push(peer));

    // Poll up to a short contact-window-sized budget rather than a single
    // fixed sleep, so this isn't flaky under CI scheduling jitter.
    const deadline = Date.now() + 5_000;
    while ((foundByA.length === 0 || foundByB.length === 0) && Date.now() < deadline) {
      await wait(50);
    }

    expect(foundByA).toEqual([
      { address: { id: "http://127.0.0.2:" + String(port) }, kind: "node" },
    ]);
    expect(foundByB).toEqual([
      { address: { id: "http://127.0.0.1:" + String(port) }, kind: "person" },
    ]);
  });

  it("does not report the same peer twice across repeated probe cycles", async () => {
    const port = freshPort();
    const timerA = new TimerSchedulerPort();
    const timerB = new TimerSchedulerPort();
    activeTimers.push(timerA, timerB);

    const nodeA = new HttpProbeLanDiscoveryAdapter({
      selfAddress: { id: "peer-a" },
      selfKind: "person",
      host: "127.0.0.1",
      port,
      candidateHosts: ["127.0.0.2"],
      scheduler: timerA,
      probeIntervalMs: 80,
      probeTimeoutMs: 300,
    });
    const nodeB = new HttpProbeLanDiscoveryAdapter({
      selfAddress: { id: "peer-b" },
      selfKind: "node",
      host: "127.0.0.2",
      port,
      candidateHosts: ["127.0.0.1"],
      scheduler: timerB,
      probeIntervalMs: 80,
      probeTimeoutMs: 300,
    });
    activeAdapters.push(nodeA, nodeB);

    const foundByA: DiscoveredPeer[] = [];
    await nodeA.startDiscovery((peer) => foundByA.push(peer));
    await nodeB.startDiscovery(() => undefined);

    await wait(600); // several probe cycles' worth
    expect(foundByA.length).toBe(1);
  });

  it("isDiscovering reflects start/stop, and stopDiscovery is idempotent", async () => {
    const port = freshPort();
    const timer = new TimerSchedulerPort();
    activeTimers.push(timer);
    const node = new HttpProbeLanDiscoveryAdapter({
      selfAddress: { id: "solo" },
      selfKind: "node",
      host: "127.0.0.1",
      port,
      candidateHosts: [],
      scheduler: timer,
      probeIntervalMs: 1_000,
    });
    activeAdapters.push(node);

    expect(node.isDiscovering).toBe(false);
    await node.startDiscovery(() => undefined);
    expect(node.isDiscovering).toBe(true);
    await node.stopDiscovery();
    expect(node.isDiscovering).toBe(false);
    await expect(node.stopDiscovery()).resolves.toBeUndefined(); // idempotent
  });

  it("probing a candidate host with nothing listening never calls onPeerFound for it", async () => {
    const port = freshPort();
    const timer = new TimerSchedulerPort();
    activeTimers.push(timer);
    const node = new HttpProbeLanDiscoveryAdapter({
      selfAddress: { id: "lonely" },
      selfKind: "person",
      host: "127.0.0.1",
      port,
      candidateHosts: ["127.0.0.9"], // nothing listens here
      scheduler: timer,
      probeIntervalMs: 100,
      probeTimeoutMs: 200,
    });
    activeAdapters.push(node);

    const found: DiscoveredPeer[] = [];
    await node.startDiscovery((peer) => found.push(peer));
    await wait(500);
    expect(found).toEqual([]);
  });
});
