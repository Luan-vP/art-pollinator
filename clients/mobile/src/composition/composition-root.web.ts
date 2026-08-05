import type { CompositionRoot } from "./types";
import { placeholderSelfPeerId } from "./placeholder-peer-id";
import { TimerSchedulerPort } from "@art-pollinator/scheduler-timer";
import { HttpTransportClient } from "@art-pollinator/transport-http";
import { LanDiscoveryProber } from "@art-pollinator/discovery-lan";

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
 * degraded port (SPEC.md §8) — it still supports Wi-Fi node swaps, this
 * platform's acquisition path (#43/#44, now wired below):
 *
 * - **Transport**: `HttpTransportClient` (`@art-pollinator/transport-http`)
 *   — `fetch`-only, no listening socket, so it runs unchanged in a browser.
 * - **Discovery**: `LanDiscoveryProber` (`@art-pollinator/discovery-lan`)
 *   — `fetch`-only too. Deliberately **not**
 *   `HttpProbeLanDiscoveryAdapter` (the fuller adapter that also
 *   self-advertises via a real `node:http` server) — a browser can never
 *   accept an inbound connection, so it can never be the *responder* half
 *   of LAN discovery, only the *prober* half. See
 *   `@art-pollinator/discovery-lan`'s README ("Design history") for why
 *   this split exists — it was discovered by attempting exactly this
 *   wiring.
 *
 * `candidateHosts` starts empty: which LAN node(s) to probe isn't known at
 * composition-root construction time (no subnet enumeration API exists in
 * a browser, and no pairing/config UI supplies one yet) — a real, current
 * gap, not fabricated. A future pairing flow would populate this list
 * before calling `startDiscovery`.
 */
export function createCompositionRoot(): CompositionRoot {
  const scheduler = new TimerSchedulerPort();
  const selfAddress = { id: placeholderSelfPeerId() };

  return {
    capabilities: {
      ble: false,
      wifiNodeSwap: true,
    },
    ports: {
      transport: new HttpTransportClient({ selfAddress }),
      discovery: new LanDiscoveryProber({
        candidateHosts: [], // see doc comment above — populated by a future pairing flow
        scheduler,
      }),
    },
  };
}
