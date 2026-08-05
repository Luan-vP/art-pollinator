/**
 * The subset of `react-native-ble-plx`'s public API `BleDiscoveryAdapter`
 * uses for the Central/scan role, expressed as a plain interface rather
 * than an import of the real (native-only) package — same rationale as
 * `@art-pollinator/transport-ble`'s `ble-central-library.ts`: this package
 * needs to `npm test` in plain Node, and the real native module is only
 * ever constructed at the composition root
 * (`clients/mobile/src/composition/composition-root.native.ts`).
 *
 * Shaped to match `BleManager.startDeviceScan`/`.stopDeviceScan` — a
 * scanned device's `serviceUUIDs` (visible in its advertisement, without
 * needing to connect) is what this adapter uses to tell a `person` peer
 * apart from a `node` peer; see `./ble-discovery-adapter.ts`.
 */

export interface ScannedDevice {
  readonly id: string;
  readonly serviceUUIDs: readonly string[] | null;
}

export interface BleScanLibrary {
  /**
   * Begin scanning. `listener` is invoked once per advertisement seen
   * (which, on real hardware, commonly means once per re-advertisement
   * interval for the *same* device — deduplication is this adapter's job,
   * not the scan library's).
   */
  startDeviceScan(
    serviceUUIDs: readonly string[] | null,
    listener: (error: Error | null, device: ScannedDevice | null) => void,
  ): void;
  stopDeviceScan(): void;
}
