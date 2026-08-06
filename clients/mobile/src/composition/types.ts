/**
 * Composition-root contracts shared by every platform variant
 * (`composition-root.web.ts` / `composition-root.native.ts`, issue #30).
 *
 * This file has no platform-specific code at all — only the two variants
 * below do, and it is Metro's platform-extension resolution (a bundle-time
 * mechanism, not a runtime `Platform.OS` check) that picks between them.
 * See AGENTS.md §2 rule 2: "no platform conditionals in core or app" — this
 * is the client-side analogue of that rule, applied at the one place
 * (`clients/`) where platform-specific code is expected to live.
 */
import type { DiscoveryPort, TransportPort } from "@art-pollinator/core";
import type {
  IngestionService,
  LibraryService,
  SwapActivityLog,
  SwapService,
} from "@art-pollinator/app";

/**
 * What this platform build can do, decided once here and threaded down to
 * the UI (issue #32, `useCapabilities()`) so BLE affordances can be omitted
 * entirely on web rather than rendered and disabled. SPEC.md §8's
 * capability-tiers table is the source of truth for these values.
 */
export interface ClientCapabilities {
  /**
   * BLE peer discovery and gossip. Always `false` on web: Web Bluetooth
   * exposes only the Central role, a browser can never advertise, so the
   * mutual advertise-and-scan pattern SPEC.md §6.1 requires for
   * person-to-person street swaps is architecturally impossible in any
   * browser — this is a permanent capability-tier boundary, not a stand-in
   * for an adapter that hasn't landed yet.
   */
  readonly ble: boolean;
  /**
   * Swap with a stationary node over Wi-Fi/LAN (HTTP transport + LAN
   * discovery, issues #43/#44, pulled forward from Phase 2). `true` on
   * every platform per SPEC.md §8's capability table — the adapter itself
   * is not implemented in this batch; this flag reflects the tier, not
   * adapter completion.
   */
  readonly wifiNodeSwap: boolean;
}

/**
 * The driven-port adapters this platform registers. Every field is
 * optional and left `undefined` until its real adapter lands (#33 BLE
 * transport, #34 BLE discovery — HTTP transport/LAN discovery, #43/#44,
 * are not BLE-specific and are not modelled per-platform here). There is
 * deliberately no no-op/fake adapter substituted in their place: calling
 * `ports.transport?.send(...)` without checking for `undefined` fails
 * loudly at the call site, rather than a silently-inert fake pretending a
 * swap happened.
 */
export interface CompositionRootPorts {
  readonly transport?: TransportPort;
  readonly discovery?: DiscoveryPort;
}

/**
 * The `app/`-layer use cases this composition root wires up and actually
 * instantiates (issue #37's own DoD check: is `SwapService` "instantiated
 * somewhere in the composition root with the real adapters wired in as its
 * dependencies," not just constructible in principle?). Unlike
 * {@link CompositionRootPorts}, every field here is required — both
 * platforms register a real transport+discovery pair (BLE for native,
 * HTTP/LAN for web; see each `composition-root.*.ts`), so both can always
 * build a real `SwapService`.
 */
export interface CompositionRootServices {
  /** Orchestrates negotiate -> transfer -> reconcile against this platform's real transport/discovery adapters (issue #37). */
  readonly swapService: SwapService;
  /** Holds this device's current `Library` snapshot; issue #38's library screen reads and mutates through this. */
  readonly libraryService: LibraryService;
  /** Issue #38's swap screen subscribes to this for live incoming-swap activity. */
  readonly swapActivityLog: SwapActivityLog;
  /**
   * Issue #53/#55's authoring use case: `AuthoringScreen` calls
   * `ingest()` on this to add a user-authored (or venue-seeded) piece to
   * `libraryService`'s `Library`. See `composition-root-shared.ts`'s
   * `buildIngestionService` doc comment for the blob store this is wired
   * against on this platform.
   */
  readonly ingestionService: IngestionService;
}

export interface CompositionRoot {
  readonly capabilities: ClientCapabilities;
  readonly ports: CompositionRootPorts;
  readonly services: CompositionRootServices;
}
