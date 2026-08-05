/**
 * NodeCompositionRoot — the stationary-node composition root (issue #45).
 *
 * Follows the exact same shape `clients/mobile/src/composition/
 * composition-root-shared.ts` already established for the mobile targets:
 * construct the real driven-port adapters, then construct `app`'s
 * `SwapService`/`LibraryService` against them — nothing here reimplements
 * negotiate/transfer/reconcile, encounter-memory suppression, provenance
 * hop-count increment, or signature verification; all of that is `app`'s
 * `SwapService` (`@art-pollinator/app`) and `core`'s policies, used exactly
 * as the mobile composition root uses them (AGENTS.md §2 rule 4: "no
 * domain logic duplicated between composition roots").
 *
 * ## What's different from the mobile composition root, and why
 *
 * - **Transport/discovery direction is reversed.** A phone *dials out*
 *   (`HttpTransportClient`) and *probes* (`LanDiscoveryProber`) — see
 *   `composition-root.web.ts`. A stationary node is the thing being dialled
 *   into and probed (SPEC.md §4/§6.1), so this root uses the listening
 *   halves instead: `HttpTransportServer` (`@art-pollinator/transport-http`)
 *   and `LanDiscoveryResponder` (`@art-pollinator/discovery-lan`) — the
 *   latter is Node-only by that package's own design (real `node:http`),
 *   which is exactly this target, unlike the browser build that can never
 *   run it (see `@art-pollinator/discovery-lan`'s
 *   `lan-discovery-prober.ts` doc comment for why the split exists at all).
 * - **Persistent storage, not an in-memory fake.** `clients/mobile`
 *   discloses (in its own `composition-root-shared.ts` doc comment) that no
 *   RN-persistent `MetadataRepositoryPort` exists yet, so it uses `core`'s
 *   in-memory fake. This target is exactly where
 *   `@art-pollinator/metadata-repository-sqlite` was built for (its own
 *   README: "the node-server target runs on plain Node — exactly where
 *   `node:sqlite` lives") — so this root uses the real one.
 * - **A larger, configurable `Library` capacity (issue #46).** `capacity`
 *   (from `./node-capacity.js`, itself fed by `../config.js`) is threaded
 *   into `LibraryService`, `SwapService`, and the naive accept/eviction
 *   policy factories consistently — see
 *   `docs/adr/0012-node-library-capacity-generalization.md` for why all
 *   three need the *same* value to agree on what "full" means.
 * - **A real `SignatureVerifierPort`.** `NodeSignatureVerifier`
 *   (`@art-pollinator/identity-node`) is wired in — unlike the mobile
 *   composition root, which discloses no RN/browser identity adapter
 *   exists yet. This is a direct reuse of already-shipped issue #58 work,
 *   not new policy logic, and is exactly the kind of "don't leave the
 *   server trivially wide open where it costs nothing to avoid" input
 *   validation this task's brief calls out — full authentication/pairing
 *   (issue #49) is still out of scope.
 * - **A reactive swap-on-connect loop, via `HttpTransportServer`'s
 *   `onNewPeer` hook.** The mobile composition root's `wireAutomaticSwap`
 *   (`composition-root-shared.ts`) reacts to `DiscoveryPort.startDiscovery`
 *   finding a peer. A node never calls `startDiscovery` — it is the thing
 *   being discovered — so it has no symmetric event to react to. This
 *   batch adds a small, purely additive `onNewPeer` option to
 *   `HttpTransportServer` (see that file's doc comment) that fires the
 *   first time a given peer's `x-peer-id` shows up; {@link handleNewPeer}
 *   below is this root's equivalent of `wireAutomaticSwap` — same shape
 *   (call `swapService.swap`, adopt the result into `libraryService`,
 *   swallow failures so one bad peer never crashes the process), just
 *   triggered by an inbound connection instead of a discovery callback.
 *   **Disclosed simplification:** the peer's `PeerKind` is not actually
 *   knowable from a bare HTTP connection (nothing in the wire protocol or
 *   `x-peer-id` carries it), so every inbound peer is treated as `"person"`
 *   — the more permissive `OfferPolicy`/`AcceptPolicy` case (SPEC.md §6.3:
 *   a node may seed generously either way, so this only affects `OfferPolicy`
 *   branches that key off `peerKind`, and the naive default used here does
 *   not). A real per-connection `PeerKind` signal would need a protocol
 *   change (e.g. LAN discovery's probe carrying the prober's own kind) —
 *   out of scope for this batch, noted rather than silently assumed away.
 */
import {
  InMemoryEncounterLogPort,
  createNaiveAcceptPolicy,
  createNaiveEvictionPolicy,
  naiveOfferPolicy,
  type LibraryCapacity,
  type PeerAddress,
} from "@art-pollinator/core";
import { LibraryService, SwapService } from "@art-pollinator/app";
import { HttpTransportServer } from "@art-pollinator/transport-http";
import { LanDiscoveryResponder } from "@art-pollinator/discovery-lan";
import { SqliteMetadataRepository } from "@art-pollinator/metadata-repository-sqlite";
import { NodeSignatureVerifier } from "@art-pollinator/identity-node";
import type { NodeServerConfig } from "../config.js";

/** A real (`Date.now()`-backed) `ClockPort` — the Node analogue of `clients/mobile`'s `SystemClockPort`. Trivial platform wiring, not domain logic (AGENTS.md §2 rule 4 is about business logic, not this one-line pass-through every composition root needs its own copy of). */
export class SystemClockPort {
  now(): number {
    return Date.now();
  }
}

export interface NodeCompositionRootHandle {
  readonly swapService: SwapService;
  readonly libraryService: LibraryService;
  readonly metadataRepository: SqliteMetadataRepository;
  readonly transport: HttpTransportServer;
  readonly capacity: LibraryCapacity;
  /**
   * Starts both listeners (`HttpTransportServer` first, so this node's own
   * dial-in address is known before `LanDiscoveryResponder` advertises it —
   * see this file's doc comment) and returns the resolved base URL other
   * devices dial this node at.
   */
  start(): Promise<{ readonly baseUrl: string; readonly transportPort: number }>;
  /** Stops both listeners and closes the SQLite connection. Safe to call once, after {@link start}. */
  stop(): Promise<void>;
}

/**
 * Build (but do not yet start) a node composition root from `config`. Split
 * from `start()` so a test can construct one, inspect its
 * `swapService`/`libraryService`/`metadataRepository` directly, and choose
 * whether to actually bind sockets at all.
 */
export async function createNodeCompositionRoot(
  config: NodeServerConfig,
): Promise<NodeCompositionRootHandle> {
  const capacity = config.capacity;
  const metadataRepository = new SqliteMetadataRepository({ filePath: config.dbPath });
  const libraryService = await LibraryService.create(metadataRepository, capacity);

  // `swapService` is assigned after `transport` below, but `handleNewPeer`
  // (passed to `transport`'s constructor) only ever *runs* later, once a
  // real peer connects — by then this closure's `swapService` reference is
  // populated. See this file's doc comment on the reactive swap-on-connect
  // loop.
  let swapService: SwapService;
  const handleNewPeer = (peer: PeerAddress): void => {
    void swapService
      .swap({ address: peer, kind: "person" }, libraryService.getLibrary())
      .then((outcome) => {
        libraryService.adoptLibrary(outcome.library);
      })
      .catch(() => {
        // Swallowed deliberately, mirroring `composition-root-shared.ts`'s
        // `wireAutomaticSwap`: one failed/aborted swap (issue #47 — a peer
        // that vanishes mid-exchange lands here as a rejected promise) must
        // never crash this long-lived process.
      });
  };

  const transport = new HttpTransportServer({
    ...(config.longPollTimeoutMs !== undefined
      ? { longPollTimeoutMs: config.longPollTimeoutMs }
      : {}),
    onNewPeer: handleNewPeer,
  });

  swapService = new SwapService({
    transport,
    metadataRepository,
    // Disclosed gap, same category as `composition-root-shared.ts`'s own
    // note on this port: no SQLite-backed `EncounterLogPort` exists yet, so
    // this node's encounter memory (SPEC.md §6.4 — suppressing re-offers of
    // declined/evicted items) does not survive a process restart. A real
    // persistent adapter is separate future work, not required by issues
    // #45-#48.
    encounterLog: new InMemoryEncounterLogPort(),
    clock: new SystemClockPort(),
    offerPolicy: naiveOfferPolicy,
    acceptPolicy: createNaiveAcceptPolicy(capacity.swappableSlots),
    evictionPolicy: createNaiveEvictionPolicy(capacity.swappableSlots),
    signatureVerifier: new NodeSignatureVerifier(),
    libraryCapacity: capacity,
  });

  let discovery: LanDiscoveryResponder | undefined;
  let started = false;

  return {
    swapService,
    libraryService,
    metadataRepository,
    transport,
    capacity,
    async start() {
      const { port, baseUrl } = await transport.listen(config.transportPort, config.host);
      discovery = new LanDiscoveryResponder({ selfPeerId: baseUrl, selfKind: "node" });
      await discovery.listen(config.discoveryPort, config.host);
      started = true;
      return { baseUrl, transportPort: port };
    },
    /**
     * Stops both listeners and closes the SQLite connection. Safe to call
     * even if `start()` was never called (e.g. a composition root
     * constructed only to inspect `swapService`/`libraryService` directly
     * in a test, or a startup failure between `create` and `start`) — Node's
     * `http.Server.close()` throws "Server is not running" on a socket that
     * was never `.listen()`ed, which this method deliberately never
     * surfaces as a shutdown failure.
     */
    async stop() {
      if (started) {
        await transport.close();
        await discovery?.close();
      }
      metadataRepository.close();
    },
  };
}
