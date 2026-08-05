/**
 * The subset of `munim-bluetooth`'s public API `BleDiscoveryAdapter` uses
 * for the Peripheral/advertise role (ADR-0011), expressed as a plain
 * interface rather than an import of the real (native-only) package — same
 * rationale as `./ble-scan-library.ts`.
 *
 * `munim-bluetooth`'s peripheral surface is newer and less battle-tested
 * than `react-native-ble-plx`'s (ADR-0011's own "no long production track
 * record" caveat) — this interface is this adapter's best-effort shape of
 * what a "start/stop advertising these service UUIDs" call needs to look
 * like, not a verified 1:1 mirror of the library's exact current types.
 * Confirming this against `munim-bluetooth`'s actual API on real hardware
 * is part of the disclosed real-device follow-up (README.md).
 */
export interface BleAdvertiseLibrary {
  /** Begin advertising these service UUIDs so a scanning Central can detect this device and classify its `PeerKind` (`./ble-discovery-adapter.ts`). */
  startAdvertising(options: { readonly serviceUUIDs: readonly string[] }): Promise<void>;
  stopAdvertising(): Promise<void>;
}
