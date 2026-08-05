/**
 * Real `react-native-ble-plx` shims for `@art-pollinator/discovery-ble`'s
 * `BleScanLibrary` and `@art-pollinator/transport-ble`'s `BleCentralLibrary`
 * — the only place in this codebase that actually imports
 * `react-native-ble-plx` (native-only, AGENTS.md §5). This file lives under
 * `composition-root.native.ts`'s resolution path only; nothing in
 * `composition-root.web.ts` reaches it.
 *
 * ## Why a shim, not a direct pass-through
 *
 * Both adapter packages define their own small interfaces shaped to
 * *this* codebase's needs (`ble-scan-library.ts` /
 * `ble-central-library.ts`'s own doc comments explain why — those
 * packages need to run `npm test` in plain Node with no native module
 * available). The real `BleManager`'s methods are close but not identical:
 * `startDeviceScan` takes an extra `options` parameter this codebase
 * doesn't need, and several methods resolve to `Promise<Device>` /
 * `Promise<Characteristic>` where the adapter interfaces only need
 * `Promise<void>` (this codebase never reads the resolved value). This
 * file is the narrow translation layer between the two.
 *
 * **Real-hardware verification of this exact shim is undischarged** — see
 * `@art-pollinator/transport-ble` and `@art-pollinator/discovery-ble`'s own
 * READMEs. This file has been typechecked against `react-native-ble-plx`'s
 * shipped type definitions but never run against an actual BLE radio.
 */
import { BleManager, type Device } from "react-native-ble-plx";
import type { BleScanLibrary, ScannedDevice } from "@art-pollinator/discovery-ble";
import type {
  BleCentralLibrary,
  BleDeviceHandle,
  BleSubscription,
} from "@art-pollinator/transport-ble";

function toScannedDevice(device: Device): ScannedDevice {
  return { id: device.id, serviceUUIDs: device.serviceUUIDs ?? null };
}

function toDeviceHandle(device: Device): BleDeviceHandle {
  return {
    id: device.id,
    mtu: device.mtu,
    discoverAllServicesAndCharacteristics: () =>
      device.discoverAllServicesAndCharacteristics().then(() => undefined),
    writeCharacteristicWithResponseForService: (serviceUUID, characteristicUUID, base64Value) =>
      device
        .writeCharacteristicWithResponseForService(serviceUUID, characteristicUUID, base64Value)
        .then(() => undefined),
    monitorCharacteristicForService: (serviceUUID, characteristicUUID, listener): BleSubscription =>
      device.monitorCharacteristicForService(
        serviceUUID,
        characteristicUUID,
        (error, characteristic) => {
          listener(error, characteristic ? { value: characteristic.value } : null);
        },
      ),
  };
}

/** One `BleManager` instance, shared by the scan (discovery) and central (transport) shims below — `react-native-ble-plx`'s own recommended usage is a single long-lived manager per app. */
export function createSharedBleManager(): BleManager {
  return new BleManager();
}

export function createRealBleScanLibrary(manager: BleManager): BleScanLibrary {
  return {
    startDeviceScan(serviceUUIDs, listener) {
      manager.startDeviceScan(serviceUUIDs as string[] | null, null, (error, device) => {
        listener(error, device ? toScannedDevice(device) : null);
      });
    },
    stopDeviceScan() {
      void manager.stopDeviceScan();
    },
  };
}

export function createRealBleCentralLibrary(manager: BleManager): BleCentralLibrary {
  return {
    connectToDevice: async (deviceId) => toDeviceHandle(await manager.connectToDevice(deviceId)),
    cancelDeviceConnection: (deviceId) =>
      manager.cancelDeviceConnection(deviceId).then(() => undefined),
  };
}
