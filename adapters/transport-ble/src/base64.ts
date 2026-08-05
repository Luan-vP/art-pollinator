/**
 * Base64 encode/decode for GATT characteristic values.
 * `react-native-ble-plx` represents characteristic values as base64
 * strings (matching the native iOS/Android BLE APIs it wraps) — this
 * adapter follows that convention so a real `BleDeviceHandle` (a real
 * `react-native-ble-plx` `Device`) can be dropped in unchanged. Uses
 * Node's `Buffer` (available in this package's test/typecheck environment
 * and, via React Native's polyfill, in the native app runtime this adapter
 * ships in).
 */
export function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function base64Decode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}
