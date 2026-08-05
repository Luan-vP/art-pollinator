/**
 * Test-only fakes shaped to `./ble-central-library.ts`'s interface
 * (itself shaped to `react-native-ble-plx`'s public API — see that file's
 * doc comment). Used by `ble-transport-adapter.test.ts` only; never
 * exported from `./index.ts`.
 *
 * ## What this fabric simplifies away, on purpose
 *
 * A single real BLE GATT connection has exactly one Central side and one
 * Peripheral side (`ble-transport-adapter.ts`'s doc comment). This fake
 * fabric lets *two* `BleTransportAdapter` instances — both Central-only,
 * as designed — exchange messages with each other for test purposes, by
 * having each one's fake central ALSO register a listener for its own
 * device id (something a real Central role cannot do; only a Peripheral's
 * GATT server can receive writes addressed to itself). This is a
 * deliberate, disclosed test convenience: it lets this suite exercise
 * `BleTransportAdapter`'s send/receive/chunking logic bidirectionally
 * without needing a second, real Peripheral-role implementation — it does
 * NOT model real BLE's Central/Peripheral asymmetry, which remains the
 * disclosed real-hardware gap this package's README describes.
 */
import type { BleCentralLibrary, BleDeviceHandle, BleSubscription } from "./ble-central-library.js";

type Listener = (base64: string) => void;

/** A shared in-memory "network" two `FakeBleCentralLibrary` instances are wired into. */
export class FakeBleFabric {
  private readonly listenersByRecipientId = new Map<string, Listener>();

  registerListener(recipientId: string, listener: Listener): void {
    this.listenersByRecipientId.set(recipientId, listener);
  }

  unregisterListener(recipientId: string): void {
    this.listenersByRecipientId.delete(recipientId);
  }

  deliver(recipientId: string, base64Value: string): void {
    this.listenersByRecipientId.get(recipientId)?.(base64Value);
  }
}

export interface FakeBleCentralLibraryOptions {
  readonly selfId: string;
  readonly fabric: FakeBleFabric;
  readonly mtu?: number;
  /** Record every write this central makes, for assertions independent of the fabric's delivery. */
  readonly onWrite?: (targetId: string, base64Value: string) => void;
}

/**
 * A `BleCentralLibrary` fake wired into a `FakeBleFabric`. Writing to peer
 * `X`'s inbox delivers to whatever registered a listener under key `X` in
 * the shared fabric; connecting also registers *this* central's own id as
 * a recipient (see this file's doc comment for why that's a test-only
 * simplification, not a real BLE capability).
 */
export class FakeBleCentralLibrary implements BleCentralLibrary {
  private readonly selfId: string;
  private readonly fabric: FakeBleFabric;
  private readonly mtu: number;
  private readonly onWrite: ((targetId: string, base64Value: string) => void) | undefined;
  private ownOutboxListener: Listener | undefined;

  constructor(options: FakeBleCentralLibraryOptions) {
    this.selfId = options.selfId;
    this.fabric = options.fabric;
    this.mtu = options.mtu ?? 23;
    this.onWrite = options.onWrite;
  }

  /** Test control: simulate this device's own peripheral-role code (out of adapter scope, see this file's doc comment) delivering a frame addressed to `recipientId` — i.e., what a real Peripheral-role write-request handler would have received. */
  connectToDevice(deviceId: string): Promise<BleDeviceHandle> {
    const handle: BleDeviceHandle = {
      id: deviceId,
      mtu: this.mtu,
      discoverAllServicesAndCharacteristics: () => Promise.resolve(),
      writeCharacteristicWithResponseForService: (_service, _characteristic, base64Value) => {
        this.onWrite?.(deviceId, base64Value);
        this.fabric.deliver(deviceId, base64Value);
        return Promise.resolve();
      },
      monitorCharacteristicForService: (_service, _characteristic, listener): BleSubscription => {
        // Simplification per this file's doc comment: this central
        // registers itself (its OWN id) as the fabric recipient, so writes
        // addressed to "me" (from a peer's write call above) reach this
        // monitor callback — standing in for the Peripheral-role write
        // path a real device would use instead.
        this.ownOutboxListener = (base64Value) => {
          listener(null, { value: base64Value });
        };
        this.fabric.registerListener(this.selfId, this.ownOutboxListener);
        return {
          remove: () => {
            this.fabric.unregisterListener(this.selfId);
          },
        };
      },
    };
    return Promise.resolve(handle);
  }

  cancelDeviceConnection(_deviceId: string): Promise<void> {
    this.fabric.unregisterListener(this.selfId);
    return Promise.resolve();
  }
}
