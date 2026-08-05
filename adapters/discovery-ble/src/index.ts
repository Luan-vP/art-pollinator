/**
 * `@art-pollinator/discovery-ble` — `DiscoveryPort` over BLE mutual
 * advertise-and-scan (issue #34). See `./ble-discovery-adapter.ts`'s doc
 * comment and README.md for the full picture, including the peripheral
 * library choice (ADR-0011) and what remains unverified pending real
 * hardware.
 */
export * from "./ble-discovery-adapter.js";
export * from "./ble-scan-library.js";
export * from "./ble-advertise-library.js";
