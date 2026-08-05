/**
 * BleDiscoveryAdapter — `DiscoveryPort` over BLE (issue #34): mutual
 * advertise-and-scan (SPEC.md §6.1), internally composing two different
 * native libraries behind one port interface, exactly as ADR-0010/0011
 * anticipated:
 *
 * - **Scan** (Central role): `react-native-ble-plx`, via `./ble-scan-library.ts`.
 * - **Advertise** (Peripheral role): `munim-bluetooth`, via
 *   `./ble-advertise-library.ts` — see ADR-0011 for why this library.
 *
 * Neither library is exposed to `DiscoveryPort`'s callers (AGENTS.md §2
 * rule 3) — this class is where the composition happens.
 *
 * ## How a scanned device's `PeerKind` is determined without connecting
 *
 * A BLE advertisement's `serviceUUIDs` are visible to a scanner without
 * establishing a GATT connection. This adapter advertises one of two fixed
 * service UUIDs depending on `selfKind` ({@link PERSON_DISCOVERY_SERVICE_UUID}
 * / {@link NODE_DISCOVERY_SERVICE_UUID}) and classifies a scanned device's
 * kind the same way in reverse — cheap, and avoids needing to parse
 * manufacturer data or connect just to find out what kind of peer was
 * seen. `DiscoveredPeer.address.id` is the scanned device's own BLE id,
 * unchanged — the same convention `@art-pollinator/transport-ble` uses for
 * `connectToDevice`, so a composition root can hand a `DiscoveredPeer`
 * straight to `BleTransportAdapter` without translation.
 *
 * ## Testing
 *
 * All tests run against mocked scan/advertise surfaces
 * (`./fake-ble-scan-and-advertise-fabric.ts`) — not real hardware, since
 * this sandbox has neither a BLE radio nor an iOS/Android device (see
 * README.md).
 */
import type { DiscoveredPeer, DiscoveryPort, PeerKind } from "@art-pollinator/core";
import type { BleAdvertiseLibrary } from "./ble-advertise-library.js";
import type { BleScanLibrary, ScannedDevice } from "./ble-scan-library.js";

/** Advertised by a device whose `selfKind` is `"person"`. Arbitrary but fixed — both sides of this codebase agree on it, which is all that's required. */
export const PERSON_DISCOVERY_SERVICE_UUID = "6e400010-b5a3-f393-e0a9-e50e24dcca9e";
/** Advertised by a device whose `selfKind` is `"node"`. */
export const NODE_DISCOVERY_SERVICE_UUID = "6e400011-b5a3-f393-e0a9-e50e24dcca9e";

function classifyKind(device: ScannedDevice): PeerKind | undefined {
  const uuids = device.serviceUUIDs ?? [];
  if (uuids.includes(PERSON_DISCOVERY_SERVICE_UUID)) return "person";
  if (uuids.includes(NODE_DISCOVERY_SERVICE_UUID)) return "node";
  return undefined; // an advertisement not using this codebase's discovery UUIDs — not one of ours
}

export interface BleDiscoveryAdapterOptions {
  readonly selfKind: PeerKind;
  readonly scanner: BleScanLibrary;
  readonly advertiser: BleAdvertiseLibrary;
}

export class BleDiscoveryAdapter implements DiscoveryPort {
  private readonly selfKind: PeerKind;
  private readonly scanner: BleScanLibrary;
  private readonly advertiser: BleAdvertiseLibrary;

  private discovering = false;
  private readonly discoveredIds = new Set<string>();
  private onPeerFound: ((peer: DiscoveredPeer) => void) | undefined;

  constructor(options: BleDiscoveryAdapterOptions) {
    this.selfKind = options.selfKind;
    this.scanner = options.scanner;
    this.advertiser = options.advertiser;
  }

  async startDiscovery(onPeerFound: (peer: DiscoveredPeer) => void): Promise<void> {
    if (this.discovering) return;
    this.onPeerFound = onPeerFound;
    this.discoveredIds.clear();

    const selfServiceUUID =
      this.selfKind === "person" ? PERSON_DISCOVERY_SERVICE_UUID : NODE_DISCOVERY_SERVICE_UUID;
    await this.advertiser.startAdvertising({ serviceUUIDs: [selfServiceUUID] });
    this.discovering = true;

    this.scanner.startDeviceScan(
      [PERSON_DISCOVERY_SERVICE_UUID, NODE_DISCOVERY_SERVICE_UUID],
      (error, device) => {
        if (error || !device) return;
        if (this.discoveredIds.has(device.id)) return; // DiscoveryPort: once per newly-discovered peer
        const kind = classifyKind(device);
        if (!kind) return; // not one of this codebase's discovery UUIDs
        this.discoveredIds.add(device.id);
        this.onPeerFound?.({ address: { id: device.id }, kind });
      },
    );
  }

  async stopDiscovery(): Promise<void> {
    if (!this.discovering) return;
    this.discovering = false;
    this.scanner.stopDeviceScan();
    await this.advertiser.stopAdvertising();
    this.onPeerFound = undefined;
  }

  get isDiscovering(): boolean {
    return this.discovering;
  }
}
