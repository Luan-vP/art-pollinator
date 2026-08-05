/**
 * `LanDiscoveryProber` tests — real network (a real `LanDiscoveryResponder`
 * to probe against), but the prober itself under test uses only `fetch`,
 * proving it is genuinely usable without `node:http` (i.e., safe for
 * `clients/mobile`'s web composition root — see this file's sibling
 * `lan-discovery-prober.ts`'s doc comment for why that safety matters).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoveredPeer } from "@art-pollinator/core";
import { TimerSchedulerPort } from "@art-pollinator/scheduler-timer";
import { LanDiscoveryProber } from "./lan-discovery-prober.js";
import { LanDiscoveryResponder } from "./lan-discovery-responder.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

let nextPort = 49_000;
function freshPort(): number {
  nextPort += 1;
  return nextPort;
}

const activeResponders: LanDiscoveryResponder[] = [];
const activeTimers: TimerSchedulerPort[] = [];

afterEach(async () => {
  await Promise.all(activeResponders.map((r) => r.close()));
  activeResponders.length = 0;
  for (const t of activeTimers) t.cancelAll();
  activeTimers.length = 0;
});

describe("LanDiscoveryProber", () => {
  it("has no static import of node:http (or any node:* module) — safe for a browser bundle", () => {
    // A source-level check, deliberately mirroring
    // scripts/check-web-bundle-native-imports.mjs's own reasoning
    // (AGENTS.md §5): this class must never pull in a Node-only module,
    // even transitively, since clients/mobile's web composition root
    // constructs it directly.
    const contents = readFileSync(join(__dirname, "lan-discovery-prober.ts"), "utf8");
    expect(contents).not.toMatch(/from\s+["']node:/);
  });

  it("discovers a real responder over real fetch, using only SchedulerPort + fetch", async () => {
    const port = freshPort();
    const responder = new LanDiscoveryResponder({
      selfPeerId: "http://127.0.0.1:" + String(port),
      selfKind: "node",
    });
    activeResponders.push(responder);
    await responder.listen(port, "127.0.0.1");

    const timer = new TimerSchedulerPort();
    activeTimers.push(timer);
    const prober = new LanDiscoveryProber({
      port,
      candidateHosts: ["127.0.0.1"],
      scheduler: timer,
      probeIntervalMs: 100,
      probeTimeoutMs: 300,
    });

    const found: DiscoveredPeer[] = [];
    await prober.startDiscovery((peer) => found.push(peer));
    expect(found).toEqual([{ address: { id: "http://127.0.0.1:" + String(port) }, kind: "node" }]);
    await prober.stopDiscovery();
  });

  it("isDiscovering reflects start/stop, and both are idempotent", async () => {
    const timer = new TimerSchedulerPort();
    activeTimers.push(timer);
    const prober = new LanDiscoveryProber({
      port: freshPort(),
      candidateHosts: [],
      scheduler: timer,
      probeIntervalMs: 1_000,
    });
    expect(prober.isDiscovering).toBe(false);
    await prober.startDiscovery(() => undefined);
    expect(prober.isDiscovering).toBe(true);
    await prober.startDiscovery(() => undefined); // idempotent
    await prober.stopDiscovery();
    expect(prober.isDiscovering).toBe(false);
    await expect(prober.stopDiscovery()).resolves.toBeUndefined(); // idempotent
  });
});
