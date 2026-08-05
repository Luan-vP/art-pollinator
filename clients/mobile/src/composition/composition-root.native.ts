import type { CompositionRoot } from "./types";

/**
 * Composition root for the native (iOS/Android) build. Metro resolves this
 * file (over `composition-root.web.ts`) for the `ios` and `android`
 * platforms by filename convention alone — nothing in this codebase branches
 * on `Platform.OS` to make that choice (issue #30, AGENTS.md §2 rule 2).
 *
 * Real BLE adapters are not implemented yet: `TransportPort` (issue #33)
 * and `DiscoveryPort` (issue #34) are both documented placeholders here,
 * left unregistered rather than backed by a no-op stub. Before implementing
 * them, read:
 *
 *   - docs/spikes/0028-background-ble-feasibility.md
 *   - docs/adr/0010-hybrid-foreground-first-ble-swap-model.md
 *
 * Headline findings from those documents that shape #33/#34: (1)
 * `react-native-ble-plx` only implements the Central/scan role — the
 * Peripheral/advertising role needs a second, separately-evaluated
 * dependency; (2) the reliable swap model is foreground-first, with
 * background operation as a best-effort, platform-asymmetric enhancement,
 * not the baseline.
 *
 * Once real adapters exist, register them here, e.g.:
 *
 *   import { BleTransportAdapter } from "../ble/ble-transport-adapter";
 *   import { BleDiscoveryAdapter } from "../ble/ble-discovery-adapter";
 *   ...
 *   ports: {
 *     transport: new BleTransportAdapter(...),
 *     discovery: new BleDiscoveryAdapter(...),
 *   }
 *
 * HTTP transport / LAN discovery (#43/#44) are not BLE-specific and are not
 * decided by this file — they are placeholders on every platform alike.
 */
export function createCompositionRoot(): CompositionRoot {
  return {
    capabilities: {
      ble: true,
      wifiNodeSwap: true,
    },
    ports: {
      // transport: BLE transport adapter — issue #33, not yet implemented.
      // discovery: BLE discovery adapter — issue #34, not yet implemented.
    },
  };
}
