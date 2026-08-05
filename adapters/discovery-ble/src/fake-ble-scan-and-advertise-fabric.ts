/**
 * Test-only fakes for `./ble-scan-library.ts` / `./ble-advertise-library.ts`,
 * wired into a shared in-memory fabric so two `BleDiscoveryAdapter`
 * instances can mutually discover each other in a test — used only by
 * `ble-discovery-adapter.test.ts`, never exported from `./index.ts`.
 *
 * A scanner never sees its own advertisement, mirroring how a real BLE
 * radio does not receive its own transmissions — `BleDiscoveryAdapter`
 * itself doesn't need any "ignore myself" logic because real hardware
 * (and this fake) both handle that beneath the adapter's API surface.
 */
import type { BleAdvertiseLibrary } from "./ble-advertise-library.js";
import type { BleScanLibrary, ScannedDevice } from "./ble-scan-library.js";

type ScanListener = (error: null, device: ScannedDevice | null) => void;

interface RegisteredScanner {
  readonly selfId: string;
  readonly listener: ScanListener;
}

/** A shared "BLE airspace": who's currently advertising, and who's currently scanning. */
export class FakeBleScanAndAdvertiseFabric {
  private readonly advertising = new Map<string, readonly string[]>();
  private readonly scanners = new Set<RegisteredScanner>();

  advertise(deviceId: string, serviceUUIDs: readonly string[]): void {
    this.advertising.set(deviceId, serviceUUIDs);
    this.notifyScanners({ id: deviceId, serviceUUIDs });
  }

  stopAdvertising(deviceId: string): void {
    this.advertising.delete(deviceId);
  }

  addScanListener(selfId: string, listener: ScanListener): RegisteredScanner {
    const entry: RegisteredScanner = { selfId, listener };
    this.scanners.add(entry);
    // A newly-started scan immediately "sees" every other device already advertising.
    for (const [id, serviceUUIDs] of this.advertising) {
      if (id !== selfId) listener(null, { id, serviceUUIDs });
    }
    return entry;
  }

  removeScanListener(entry: RegisteredScanner): void {
    this.scanners.delete(entry);
  }

  private notifyScanners(device: ScannedDevice): void {
    for (const { selfId, listener } of this.scanners) {
      if (selfId !== device.id) listener(null, device);
    }
  }
}

export interface FakeBlePeripheralOptions {
  readonly deviceId: string;
  readonly fabric: FakeBleScanAndAdvertiseFabric;
}

export class FakeBleAdvertiseLibrary implements BleAdvertiseLibrary {
  constructor(private readonly options: FakeBlePeripheralOptions) {}

  startAdvertising(options: { readonly serviceUUIDs: readonly string[] }): Promise<void> {
    this.options.fabric.advertise(this.options.deviceId, options.serviceUUIDs);
    return Promise.resolve();
  }

  stopAdvertising(): Promise<void> {
    this.options.fabric.stopAdvertising(this.options.deviceId);
    return Promise.resolve();
  }
}

export class FakeBleScanLibrary implements BleScanLibrary {
  private readonly fabric: FakeBleScanAndAdvertiseFabric;
  /** This scanner's own device id — used only to filter out its own advertisement, mirroring real BLE hardware (see this file's header comment). Not part of the real `BleScanLibrary` interface, which has no notion of "self" at all. */
  private readonly selfId: string;
  private activeRegistration: RegisteredScanner | undefined;

  constructor(options: {
    readonly fabric: FakeBleScanAndAdvertiseFabric;
    readonly selfId: string;
  }) {
    this.fabric = options.fabric;
    this.selfId = options.selfId;
  }

  startDeviceScan(
    _serviceUUIDs: readonly string[] | null,
    listener: (error: Error | null, device: ScannedDevice | null) => void,
  ): void {
    this.activeRegistration = this.fabric.addScanListener(this.selfId, listener);
  }

  stopDeviceScan(): void {
    if (this.activeRegistration) {
      this.fabric.removeScanListener(this.activeRegistration);
      this.activeRegistration = undefined;
    }
  }
}
