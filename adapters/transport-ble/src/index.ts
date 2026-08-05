/**
 * `@art-pollinator/transport-ble` — `TransportPort` over BLE GATT (issue
 * #33). See `./ble-transport-adapter.ts`'s doc comment for scope (Central
 * role only this batch) and README.md for the full picture including what
 * remains unverified pending real hardware.
 */
export * from "./ble-transport-adapter.js";
export * from "./ble-chunking.js";
export * from "./ble-central-library.js";
