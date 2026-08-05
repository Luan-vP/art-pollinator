import type { CompositionRoot } from "./types";
import { placeholderSelfPeerId } from "./placeholder-peer-id";
import { TimerSchedulerPort } from "@art-pollinator/scheduler-timer";
import { HttpTransportClient } from "@art-pollinator/transport-http";
import { HttpProbeLanDiscoveryAdapter } from "@art-pollinator/discovery-lan";
import { BleTransportAdapter } from "@art-pollinator/transport-ble";
import { BleDiscoveryAdapter } from "@art-pollinator/discovery-ble";
import {
  createRealBleCentralLibrary,
  createRealBleScanLibrary,
  createSharedBleManager,
} from "../ble/real-ble-scan-and-central-library";
import { createRealBleAdvertiseLibrary } from "../ble/real-ble-advertise-library";

/**
 * Composition root for the native (iOS/Android) build. Metro resolves this
 * file (over `composition-root.web.ts`) for the `ios` and `android`
 * platforms by filename convention alone — nothing in this codebase
 * branches on `Platform.OS` to make that choice (issue #30, AGENTS.md §2
 * rule 2).
 *
 * BLE wiring here follows `docs/spikes/0028-background-ble-feasibility.md`
 * and `docs/adr/0010-hybrid-foreground-first-ble-swap-model.md` /
 * `docs/adr/0011-ble-peripheral-advertising-library.md`:
 * `react-native-ble-plx` for the Central/scan role,
 * `munim-bluetooth` for the Peripheral/advertise role, composed inside
 * `BleDiscoveryAdapter`. `BleTransportAdapter` (issue #33) is Central-role
 * only this batch — see `@art-pollinator/transport-ble`'s README for the
 * disclosed scope gap (the symmetric Peripheral-role GATT-server data path
 * is not implemented). **None of this BLE wiring has been run against real
 * hardware** (no BLE radio, no iOS/Android device/simulator in this
 * environment) — see `@art-pollinator/transport-ble` and
 * `@art-pollinator/discovery-ble`'s own READMEs for exactly what remains
 * unverified.
 *
 * HTTP transport / LAN discovery (#43/#44) are shared with the web
 * composition root (not BLE-specific) — see `composition-root.web.ts`'s
 * doc comment for why `LanDiscoveryProber` there differs from
 * `HttpProbeLanDiscoveryAdapter` here (this platform can run a real
 * `node:http` responder via React Native's Node polyfills at the native
 * layer where the Expo/Metro toolchain provides one; a browser never can).
 *
 * `ports.transport`/`ports.discovery` here register only the BLE halves —
 * a real composition root wanting *both* BLE (person-to-person) and Wi-Fi
 * node-swap acquisition simultaneously would need to route by discovered
 * `PeerKind` (`"person"` → BLE, `"node"` → HTTP/LAN) rather than a single
 * static port field; that routing layer is `SwapService`-orchestration
 * scope, not this composition root's (this file only constructs and
 * exposes the adapters — see `types.ts`'s `CompositionRootPorts` doc
 * comment on why every field here is a single instance, not a router).
 */
export function createCompositionRoot(): CompositionRoot {
  const bleManager = createSharedBleManager();

  return {
    capabilities: {
      ble: true,
      wifiNodeSwap: true,
    },
    ports: {
      transport: new BleTransportAdapter({ central: createRealBleCentralLibrary(bleManager) }),
      discovery: new BleDiscoveryAdapter({
        selfKind: "person",
        scanner: createRealBleScanLibrary(bleManager),
        advertiser: createRealBleAdvertiseLibrary(),
      }),
    },
  };
}

/**
 * HTTP transport / LAN discovery (#43/#44), constructed but not registered
 * as this composition root's default `ports.transport`/`ports.discovery`
 * (BLE is this file's primary path — see the doc comment above). Exposed
 * as a named export for whatever Wi-Fi-node-swap call site needs it (a
 * later, separate wiring task once discovered-peer routing exists).
 */
export function createWifiNodeSwapAdapters(): {
  readonly transport: HttpTransportClient;
  readonly discovery: HttpProbeLanDiscoveryAdapter;
} {
  const scheduler = new TimerSchedulerPort();
  const selfAddress = { id: placeholderSelfPeerId() };
  return {
    transport: new HttpTransportClient({ selfAddress }),
    discovery: new HttpProbeLanDiscoveryAdapter({
      selfAddress,
      selfKind: "person",
      host: "0.0.0.0",
      candidateHosts: [], // see composition-root.web.ts's doc comment — populated by a future pairing flow
      scheduler,
    }),
  };
}
