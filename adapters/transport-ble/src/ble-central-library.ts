/**
 * The subset of `react-native-ble-plx`'s public API `BleTransportAdapter`
 * actually calls, expressed as a plain TypeScript interface rather than an
 * import of the real package.
 *
 * ## Why an interface, not a dependency on the real package
 *
 * `react-native-ble-plx` is a native-only module (AGENTS.md §5: "has no web
 * implementation... CI fails the build if it leaks into the web bundle").
 * This package (`@art-pollinator/transport-ble`) is a plain TypeScript
 * package with no React Native runtime available in this sandbox (no BLE
 * radio, no iOS/Android device — `docs/spikes/0028-background-ble-feasibility.md`).
 * Depending on the real package here would add an unresolvable native
 * dependency to a package that needs to `npm test` in plain Node, for no
 * benefit: the composition root (`clients/mobile/src/composition/composition-root.native.ts`)
 * is where a real `BleManager`/`Device` from `react-native-ble-plx`
 * actually gets constructed and passed in — this interface is the seam
 * (AGENTS.md §2 rule 3's "ports are shaped by what the domain needs," the
 * same discipline applied one layer down, to an adapter's own external
 * dependency). Structural typing means a real `react-native-ble-plx`
 * `Device` instance satisfies {@link BleDeviceHandle} without this file
 * ever importing the package.
 *
 * Method names and shapes below are chosen to match
 * `react-native-ble-plx`'s documented public API as closely as this
 * adapter needs (`discoverAllServicesAndCharacteristics`,
 * `writeCharacteristicWithResponseForService`,
 * `monitorCharacteristicForService`, `mtu`, `connectToDevice`,
 * `cancelDeviceConnection`) — verifying this interface against the real
 * library's exact current type definitions on real hardware is part of
 * the disclosed, undischarged real-device follow-up (README.md).
 */

/** A live GATT connection to one peer device — the subset of `react-native-ble-plx`'s `Device` this adapter uses. */
export interface BleDeviceHandle {
  readonly id: string;
  /** The negotiated ATT MTU for this connection (default 23 on most stacks until negotiated higher). */
  readonly mtu: number;
  discoverAllServicesAndCharacteristics(): Promise<void>;
  writeCharacteristicWithResponseForService(
    serviceUUID: string,
    characteristicUUID: string,
    base64Value: string,
  ): Promise<void>;
  /** Subscribe to notifications on a characteristic; returns a subscription to release with `.remove()`. */
  monitorCharacteristicForService(
    serviceUUID: string,
    characteristicUUID: string,
    listener: (
      error: Error | null,
      characteristic: { readonly value: string | null } | null,
    ) => void,
  ): BleSubscription;
}

export interface BleSubscription {
  remove(): void;
}

/** The subset of `react-native-ble-plx`'s `BleManager` this adapter uses for the Central role. */
export interface BleCentralLibrary {
  connectToDevice(deviceId: string): Promise<BleDeviceHandle>;
  cancelDeviceConnection(deviceId: string): Promise<void>;
}
