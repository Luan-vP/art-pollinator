import type { CompositionRoot } from "./types";

/**
 * Composition root for the web (React Native Web) build. Metro resolves
 * this file (over `composition-root.native.ts`) for the `web` platform by
 * filename convention alone — nothing in this codebase branches on
 * `typeof window` to make that choice (issue #30, AGENTS.md §2 rule 2).
 *
 * Per SPEC.md §8: Web Bluetooth exposes only the Central role — a browser
 * can never advertise — so the mutual advertise-and-scan pattern SPEC.md
 * §6.1 requires for person-to-person street swaps is architecturally
 * impossible here, for every browser, permanently. Firefox and every Safari
 * version lack Web Bluetooth entirely, and iOS forces every browser onto
 * WebKit, so this is not a vendor-support gap that closes with time.
 *
 * Unlike the native composition root's BLE fields, this is not a
 * placeholder awaiting an adapter: the web build registers NO BLE port
 * implementation of any kind, ever. `ble` is permanently `false` here.
 *
 * The browser is a first-class target with a reduced capability set, not a
 * degraded port (SPEC.md §8) — it still supports Wi-Fi node swaps once
 * #43/#44 (HTTP transport, LAN discovery) land, which is this platform's
 * acquisition path.
 */
export function createCompositionRoot(): CompositionRoot {
  return {
    capabilities: {
      ble: false,
      wifiNodeSwap: true,
    },
    ports: {
      // No transport/discovery adapter for BLE is registered, and none
      // ever will be on this platform. HTTP transport / LAN discovery
      // (#43/#44) are this platform's acquisition path and remain
      // placeholders here pending that batch.
    },
  };
}
