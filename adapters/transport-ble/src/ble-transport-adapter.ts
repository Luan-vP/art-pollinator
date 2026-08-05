/**
 * BleTransportAdapter — `TransportPort` over BLE GATT (issue #33).
 *
 * ## Scope for this batch: Central role only
 *
 * `react-native-ble-plx` only implements the BLE Central role (spike 0028,
 * ADR-0010). Once two devices have found each other via discovery
 * (`@art-pollinator/discovery-ble`, issue #34), an actual GATT *connection*
 * for one specific pair still needs exactly one side to be Central (the
 * connecting party) and the other to be Peripheral (the party whose GATT
 * server is connected to) — SPEC.md §6.1's mutual advertise-and-scan
 * guarantees both sides *detect* each other, not that either side is free
 * to unilaterally pick which BLE role it plays for the ensuing connection.
 *
 * This adapter implements only the Central half: it connects out to a
 * peer, writes outbound wire-protocol bytes (chunked, `./ble-chunking.ts`)
 * to the peer's inbox characteristic, and monitors the peer's outbox
 * characteristic for notifications, reassembling them back into complete
 * messages. **The symmetric Peripheral-role half — this device hosting its
 * own GATT server characteristics so an inbound Central connection can
 * write to and be notified by it — is NOT implemented in this batch.**
 * That half depends on `munim-bluetooth`'s GATT-server/peripheral API
 * (ADR-0011), which itself carries "no long production track record" risk
 * this codebase has not yet spiked at the GATT-server-characteristic level
 * (only at the advertising level, for `@art-pollinator/discovery-ble`).
 * This is a disclosed, undischarged gap — see README.md — alongside "no
 * real hardware to verify against at all" (this sandbox has no BLE radio).
 *
 * ## Testing
 *
 * All tests in this package run against a mocked
 * `react-native-ble-plx`-shaped surface (`./ble-central-library.ts`'s
 * interface, implemented by test fakes) — proving this class's
 * chunking/reassembly and connection-management logic is correct, not
 * that it works against real hardware.
 */
import type { PeerAddress, TransportPort } from "@art-pollinator/core";
import type { BleCentralLibrary, BleDeviceHandle, BleSubscription } from "./ble-central-library.js";
import { chunkMessage, MessageReassembler } from "./ble-chunking.js";
import { base64Decode, base64Encode } from "./base64.js";

/** Placeholder swap-service UUIDs (Nordic UART-service-shaped, a common convention for a simple bidirectional GATT pipe) — a real deployment should mint its own, but the exact value is arbitrary as long as both sides of a connection agree, which is exactly what this codebase controls on both ends. */
export const SWAP_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const INBOX_CHARACTERISTIC_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const OUTBOX_CHARACTERISTIC_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

interface InboundMessage {
  readonly from: PeerAddress;
  readonly message: Uint8Array;
}

interface Connection {
  readonly device: BleDeviceHandle;
  readonly subscription: BleSubscription;
  readonly reassembler: MessageReassembler;
}

export interface BleTransportAdapterOptions {
  readonly central: BleCentralLibrary;
}

export class BleTransportAdapter implements TransportPort {
  private readonly central: BleCentralLibrary;
  private readonly connections = new Map<string, Connection>();
  private readonly inbox: InboundMessage[] = [];
  private readonly waiters: ((message: InboundMessage) => void)[] = [];

  constructor(options: BleTransportAdapterOptions) {
    this.central = options.central;
  }

  /**
   * Proactively establish (and start monitoring notifications on) the GATT
   * connection to `peer`, ahead of the first `send()`. Not part of
   * `TransportPort` itself — an adapter-specific capability, matching how
   * `HttpTransportServer.listen()`/`.close()` are extras beyond the port
   * interface. Real BLE connection setup can be slow enough that a caller
   * (e.g. right after discovery resolves, before a swap's first message)
   * benefits from doing it up front rather than paying that latency inside
   * the first `send()`. A no-op if already connected. `send()` still calls
   * this internally when a connection doesn't exist yet, so calling it
   * explicitly is an optimization, never a requirement.
   */
  async connect(peer: PeerAddress): Promise<void> {
    await this.getOrConnect(peer);
  }

  async send(peer: PeerAddress, message: Uint8Array): Promise<void> {
    const connection = await this.getOrConnect(peer);
    const chunks = chunkMessage(message, connection.device.mtu);
    for (const chunk of chunks) {
      await connection.device.writeCharacteristicWithResponseForService(
        SWAP_SERVICE_UUID,
        INBOX_CHARACTERISTIC_UUID,
        base64Encode(chunk),
      );
    }
  }

  receive(): Promise<{ readonly from: PeerAddress; readonly message: Uint8Array }> {
    const queued = this.inbox.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  async disconnect(peer: PeerAddress): Promise<void> {
    const connection = this.connections.get(peer.id);
    if (!connection) return;
    connection.subscription.remove();
    this.connections.delete(peer.id);
    await this.central.cancelDeviceConnection(peer.id);
  }

  private async getOrConnect(peer: PeerAddress): Promise<Connection> {
    const existing = this.connections.get(peer.id);
    if (existing) return existing;

    const device = await this.central.connectToDevice(peer.id);
    await device.discoverAllServicesAndCharacteristics();
    const reassembler = new MessageReassembler();
    const subscription = device.monitorCharacteristicForService(
      SWAP_SERVICE_UUID,
      OUTBOX_CHARACTERISTIC_UUID,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const frame = base64Decode(characteristic.value);
        const complete = reassembler.push(frame);
        if (complete) this.deliver(peer, complete);
      },
    );
    const connection: Connection = { device, subscription, reassembler };
    this.connections.set(peer.id, connection);
    return connection;
  }

  private deliver(from: PeerAddress, message: Uint8Array): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ from, message });
    } else {
      this.inbox.push({ from, message });
    }
  }
}
