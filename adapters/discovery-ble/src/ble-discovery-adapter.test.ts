/**
 * `BleDiscoveryAdapter` tests against mocked `react-native-ble-plx`
 * (scan) and `munim-bluetooth` (advertise)-shaped surfaces
 * (`./fake-ble-scan-and-advertise-fabric.ts`) — NOT real hardware (this
 * sandbox has none; see README.md). Proves mutual advertise-and-scan
 * discovery logic, `PeerKind` classification, deduplication, and
 * start/stop lifecycle — the same behavioural bar
 * `core/src/ports/fakes/in-memory-discovery-port.test.ts` holds the
 * in-memory fake to (see AGENTS.md's working-agreement note on this being
 * a documented alternative to a shared `DiscoveryPort` contract suite,
 * which isn't cheap to write generically across such different discovery
 * mechanisms — see README.md).
 */
import { describe, expect, it } from "vitest";
import type { DiscoveredPeer } from "@art-pollinator/core";
import {
  BleDiscoveryAdapter,
  NODE_DISCOVERY_SERVICE_UUID,
  PERSON_DISCOVERY_SERVICE_UUID,
} from "./ble-discovery-adapter.js";
import {
  FakeBleAdvertiseLibrary,
  FakeBleScanAndAdvertiseFabric,
  FakeBleScanLibrary,
} from "./fake-ble-scan-and-advertise-fabric.js";

function makeAdapter(
  fabric: FakeBleScanAndAdvertiseFabric,
  deviceId: string,
  selfKind: "person" | "node",
): BleDiscoveryAdapter {
  return new BleDiscoveryAdapter({
    selfKind,
    scanner: new FakeBleScanLibrary({ fabric, selfId: deviceId }),
    advertiser: new FakeBleAdvertiseLibrary({ deviceId, fabric }),
  });
}

describe("BleDiscoveryAdapter — mutual advertise-and-scan over a mocked BLE fabric", () => {
  it("is not discovering before startDiscovery is called", () => {
    const fabric = new FakeBleScanAndAdvertiseFabric();
    const adapter = makeAdapter(fabric, "device-a", "person");
    expect(adapter.isDiscovering).toBe(false);
  });

  it("two devices discover each other, each classifying the other's PeerKind correctly, within a single (mocked) contact window", async () => {
    const fabric = new FakeBleScanAndAdvertiseFabric();
    const personDevice = makeAdapter(fabric, "device-a", "person");
    const nodeDevice = makeAdapter(fabric, "device-b", "node");

    const foundByPerson: DiscoveredPeer[] = [];
    const foundByNode: DiscoveredPeer[] = [];

    // "Mutual advertise-and-scan" (SPEC.md §6.1): both sides start
    // discovery — each simultaneously advertises (Peripheral) and scans
    // (Central) via the fake fabric, exactly as the real composition of
    // react-native-ble-plx + munim-bluetooth would.
    await personDevice.startDiscovery((peer) => foundByPerson.push(peer));
    await nodeDevice.startDiscovery((peer) => foundByNode.push(peer));

    expect(foundByPerson).toEqual([{ address: { id: "device-b" }, kind: "node" }]);
    expect(foundByNode).toEqual([{ address: { id: "device-a" }, kind: "person" }]);
  });

  it("does not report the same peer twice even if its advertisement is seen again", async () => {
    const fabric = new FakeBleScanAndAdvertiseFabric();
    const scanning = makeAdapter(fabric, "device-a", "person");
    const advertiserOnly = makeAdapter(fabric, "device-b", "node");

    const found: DiscoveredPeer[] = [];
    await scanning.startDiscovery((peer) => found.push(peer));
    await advertiserOnly.startDiscovery(() => undefined);

    // Simulate the peer re-advertising (real BLE devices re-advertise
    // periodically) by triggering the advertisement again directly.
    fabric.advertise("device-b", [NODE_DISCOVERY_SERVICE_UUID]);
    fabric.advertise("device-b", [NODE_DISCOVERY_SERVICE_UUID]);

    expect(found.length).toBe(1);
  });

  it("ignores an advertisement that doesn't use this codebase's discovery service UUIDs", async () => {
    const fabric = new FakeBleScanAndAdvertiseFabric();
    const scanning = makeAdapter(fabric, "device-a", "person");
    const found: DiscoveredPeer[] = [];
    await scanning.startDiscovery((peer) => found.push(peer));

    fabric.advertise("some-other-ble-device", ["0000180d-0000-1000-8000-00805f9b34fb"]); // e.g. a heart-rate monitor's standard service UUID
    expect(found).toEqual([]);
  });

  it("is discovering after startDiscovery, and not after stopDiscovery", async () => {
    const fabric = new FakeBleScanAndAdvertiseFabric();
    const adapter = makeAdapter(fabric, "device-a", "person");
    await adapter.startDiscovery(() => undefined);
    expect(adapter.isDiscovering).toBe(true);
    await adapter.stopDiscovery();
    expect(adapter.isDiscovering).toBe(false);
  });

  it("stopDiscovery is idempotent", async () => {
    const fabric = new FakeBleScanAndAdvertiseFabric();
    const adapter = makeAdapter(fabric, "device-a", "person");
    await expect(adapter.stopDiscovery()).resolves.toBeUndefined();
    await adapter.startDiscovery(() => undefined);
    await adapter.stopDiscovery();
    await expect(adapter.stopDiscovery()).resolves.toBeUndefined();
  });

  it("stopDiscovery stops advertising too, so a later scanner no longer sees this device", async () => {
    const fabric = new FakeBleScanAndAdvertiseFabric();
    const advertiser = makeAdapter(fabric, "device-a", "person");
    await advertiser.startDiscovery(() => undefined);
    await advertiser.stopDiscovery();

    const laterScanner = makeAdapter(fabric, "device-b", "node");
    const found: DiscoveredPeer[] = [];
    await laterScanner.startDiscovery((peer) => found.push(peer));
    expect(found).toEqual([]);
  });

  it("stopDiscovery stops scanning too, so a later advertisement is never reported", async () => {
    const fabric = new FakeBleScanAndAdvertiseFabric();
    const scanning = makeAdapter(fabric, "device-a", "person");
    const found: DiscoveredPeer[] = [];
    await scanning.startDiscovery((peer) => found.push(peer));
    await scanning.stopDiscovery();

    fabric.advertise("device-b", [NODE_DISCOVERY_SERVICE_UUID]);
    expect(found).toEqual([]);
  });

  it("supports multiple distinct peers discovered in sequence", async () => {
    const fabric = new FakeBleScanAndAdvertiseFabric();
    const scanning = makeAdapter(fabric, "device-a", "person");
    const found: DiscoveredPeer[] = [];
    await scanning.startDiscovery((peer) => found.push(peer));

    fabric.advertise("device-b", [NODE_DISCOVERY_SERVICE_UUID]);
    fabric.advertise("device-c", [PERSON_DISCOVERY_SERVICE_UUID]);

    expect(found).toEqual([
      { address: { id: "device-b" }, kind: "node" },
      { address: { id: "device-c" }, kind: "person" },
    ]);
  });

  it("startDiscovery is idempotent while already running", async () => {
    const fabric = new FakeBleScanAndAdvertiseFabric();
    const adapter = makeAdapter(fabric, "device-a", "person");
    let calls = 0;
    const onFound = (): void => {
      calls += 1;
    };
    await adapter.startDiscovery(onFound);
    await adapter.startDiscovery(onFound); // second call is a no-op
    fabric.advertise("device-b", [NODE_DISCOVERY_SERVICE_UUID]);
    expect(calls).toBe(1);
  });
});
