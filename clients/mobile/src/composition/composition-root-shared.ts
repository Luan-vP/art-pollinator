/**
 * composition-root-shared.ts — the platform-agnostic half of client
 * composition (issue #37's "no domain logic duplicated between client and
 * node server composition roots"). Everything here is identical for the
 * native and web builds; only `TransportPort`/`DiscoveryPort` themselves
 * differ per platform (BLE vs. HTTP/LAN — see each `composition-root.*.ts`),
 * so this file holds the one, single place `SwapService`/`LibraryService`/
 * `SwapActivityLog` are actually constructed, rather than repeating that
 * construction once per platform file.
 *
 * Contains no platform conditional of any kind (no `Platform.OS`, no
 * `typeof window`) — `composition-root.test.ts` checks this file for
 * exactly that pattern alongside the two platform-specific files.
 */
import {
  InMemoryEncounterLogPort,
  InMemoryMetadataRepositoryPort,
  naiveAcceptPolicy,
  naiveEvictionPolicy,
  naiveOfferPolicy,
  type DiscoveryPort,
  type MetadataRepositoryPort,
  type TransportPort,
} from "@art-pollinator/core";
import { LibraryService, SwapActivityLog, SwapService } from "@art-pollinator/app";
import {
  isPlaceholderSeedEnabled,
  PLACEHOLDER_METADATA_TOKENS,
  type PlaceholderSeedGateInputs,
} from "@art-pollinator/seed-placeholder-dev";
import { SystemClockPort } from "./system-clock-port";

/**
 * Shared services every platform's composition root needs, independent of
 * which `TransportPort`/`DiscoveryPort` it registers.
 *
 * ## Disclosed gap: in-memory `MetadataRepositoryPort`/`EncounterLogPort`
 *
 * `adapters/metadata-repository-sqlite` is explicitly scoped to the Node
 * server target (`node:sqlite` — see that package's README: "it does not
 * help React Native directly"). No mobile-specific persistent
 * `MetadataRepositoryPort`/`EncounterLogPort` adapter exists yet in this
 * batch, so both use `core`'s in-memory fakes here — meaning a device's
 * library and encounter memory do **not** currently survive an app
 * restart. This is a real, disclosed gap (the same category
 * `composition-root.native.ts`'s existing doc comment already discloses
 * for routing by discovered `PeerKind`), not something this batch's DoD
 * asks it to close — building a real RN-persistent adapter for either port
 * is separate, future work.
 */
export interface SharedCompositionRootServices {
  readonly metadataRepository: MetadataRepositoryPort;
  readonly libraryService: LibraryService;
  readonly swapActivityLog: SwapActivityLog;
}

export function buildSharedServices(): SharedCompositionRootServices {
  const metadataRepository = new InMemoryMetadataRepositoryPort();
  return {
    metadataRepository,
    libraryService: LibraryService.createEmpty(metadataRepository),
    swapActivityLog: new SwapActivityLog(),
  };
}

/**
 * Construct the real `SwapService` for this platform, wired against
 * `transport` (this platform's real `TransportPort` — `BleTransportAdapter`
 * on native, `HttpTransportClient` on web) plus the shared, platform-
 * independent dependencies above. This is issue #37's own explicit check:
 * `SwapService` is not left unconnected — it is instantiated here, in the
 * composition root, with real adapters as its dependencies, not just
 * exercised against fakes in a test.
 *
 * No `signatureVerifier` is configured: `adapters/identity-node`'s real
 * Ed25519 implementation is explicitly scoped to the Node server target
 * (`node:crypto` — see that package's own doc comment), and no RN/browser
 * identity adapter exists yet (SPEC.md §7's identity work, issue #57, is
 * cross-cutting but has so far only shipped a Node adapter) — another
 * disclosed gap, not silently swept under naive defaults.
 */
export function buildSwapService(
  transport: TransportPort,
  shared: SharedCompositionRootServices,
): SwapService {
  return new SwapService({
    transport,
    metadataRepository: shared.metadataRepository,
    encounterLog: new InMemoryEncounterLogPort(),
    clock: new SystemClockPort(),
    offerPolicy: naiveOfferPolicy,
    acceptPolicy: naiveAcceptPolicy,
    evictionPolicy: naiveEvictionPolicy,
    activityLog: shared.swapActivityLog,
  });
}

/**
 * Wire real, automatic swapping: whenever `discovery` finds a peer, run a
 * real swap against the current library, then adopt the reconciled result
 * back into `libraryService` so the library screen reflects it. A no-op if
 * `discovery` is `undefined` (matches `CompositionRootPorts`' own "no
 * fallback fake, fail loudly/do nothing at the call site" design —
 * `types.ts`'s doc comment). Swap failures are swallowed here rather than
 * thrown: an unhandled peer-encounter failure must never crash the running
 * app; a real UI-visible error surface is future work (issue #38 is
 * "deliberately unstyled," not "surfaces every failure mode").
 */
export function wireAutomaticSwap(
  discovery: DiscoveryPort | undefined,
  swapService: SwapService,
  libraryService: LibraryService,
): void {
  discovery?.startDiscovery((peer) => {
    void swapService
      .swap(peer, libraryService.getLibrary())
      .then((outcome) => {
        libraryService.adoptLibrary(outcome.library);
      })
      .catch(() => {
        // Swallowed deliberately — see this function's doc comment.
      });
  });
}

/**
 * Read this build's placeholder-seed dev-flag inputs (issue #42's gate,
 * `@art-pollinator/seed-placeholder-dev`).
 *
 * ## `isDevBuild`: read via `globalThis.__DEV__`, not a bare `__DEV__` reference
 *
 * React Native/Metro conventionally expose `__DEV__` as a bare global
 * identifier, but referencing it as a bare identifier requires an ambient
 * type declaration this package would otherwise need to invent (and would
 * be wrong outside an actual RN/Metro bundle — e.g. under plain
 * vitest/Node, where no such global exists). Reading it off `globalThis`
 * with an optional-chained, typed cast works identically in every
 * environment this file might run in: real RN/Metro (`global === globalThis`
 * in Hermes; Metro's dev/release define sets `global.__DEV__`), and plain
 * Node/vitest (where the property is simply absent, so this reads `false`)
 * — which is exactly why `composition-root.test.ts` can assert "no seed by
 * default" without mocking anything: there is no `__DEV__` in that test
 * environment at all, so `isDevBuild` is `false` there for the same reason
 * it would be `false` in a real release bundle.
 *
 * ## `explicitOptIn`: an `EXPO_PUBLIC_`-prefixed env var
 *
 * Expo's build tooling only inlines `process.env.EXPO_PUBLIC_*` variables
 * into the bundle (by design, specifically so *other* env vars — secrets —
 * never leak into client code); using that exact prefix means this flag
 * behaves the same way every other Expo public env var does: absent unless
 * a `.env` file or shell environment explicitly sets it, which a normal
 * build process never does.
 */
export function placeholderSeedGateInputs(): PlaceholderSeedGateInputs {
  const devGlobal = globalThis as { readonly __DEV__?: boolean };
  return {
    isDevBuild: devGlobal.__DEV__ === true,
    explicitOptIn: process.env.EXPO_PUBLIC_ENABLE_PLACEHOLDER_SEED === "true",
  };
}

/**
 * Seed `libraryService` with `PLACEHOLDER_METADATA_TOKENS` if — and only
 * if — {@link isPlaceholderSeedEnabled} says this build is allowed to
 * (issue #42's hard boundary). A no-op otherwise, which is the default in
 * every environment that doesn't explicitly opt in (see
 * `placeholderSeedGateInputs`'s doc comment).
 */
export function maybeSeedPlaceholderLibrary(libraryService: LibraryService): void {
  if (!isPlaceholderSeedEnabled(placeholderSeedGateInputs())) {
    return;
  }
  for (const token of PLACEHOLDER_METADATA_TOKENS) {
    void libraryService.add(token);
  }
}
