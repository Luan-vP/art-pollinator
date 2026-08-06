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
 * - **A larger, configurable `Library` capacity (issue #46), now
 *   *runtime*-changeable (issue #50).** `capacity` (from `./node-capacity.js`,
 *   itself fed by `../config.js`) seeds `LibraryService`'s initial capacity.
 *   `SwapService`'s `libraryCapacity`/`acceptPolicy`/`evictionPolicy`
 *   dependencies below are supplied as **live getters reading
 *   `libraryService.getCapacity()` on every access**, not frozen values —
 *   so `AdminService.setCapacity` (issue #50), which calls
 *   `libraryService.setCapacity` internally, is immediately reflected in
 *   every subsequent swap's accept/evict/add behaviour too, with no need to
 *   reconstruct `SwapService`. See `docs/adr/0012-node-library-capacity-generalization.md`
 *   for why all three must agree on one capacity value, and
 *   `app/src/admin/admin-service.ts`'s doc comment for the one disclosed
 *   edge this doesn't cover (an *in-flight* swap keeps whatever capacity it
 *   already read at the moment each dependency was accessed).
 * - **A real `SignatureVerifierPort`, now doing double duty.**
 *   `NodeSignatureVerifier` (`@art-pollinator/identity-node`) verifies both
 *   `MetadataToken` signatures (issue #58, as before) and, new in this
 *   batch, the connection-level authentication handshake's challenge
 *   signatures (issue #49) — the same Ed25519 verification, two different
 *   messages being checked.
 * - **Connection-level authentication is always on (issue #49).** Every
 *   `HttpTransportServer` this composition root creates is constructed with
 *   `security` configured — see `docs/adr/0013-peer-connection-authentication.md`
 *   for the full trust-model reasoning. This is a deliberate choice *not*
 *   to make this optional the way TLS is: signing a challenge costs a peer
 *   nothing (SPEC.md §7's anonymous rotating identities remain fully
 *   supported — a fresh keypair authenticates exactly as well as an
 *   established one), so there is no compatibility reason to make it
 *   opt-out the way TLS's cross-platform client-trust gap forces it to be.
 * - **A swap-attempt rate limiter (issue #49) and an opportunistic
 *   revocation log (issue #51) are wired into `SwapService`.** See
 *   `app/src/swap/swap-service.ts`'s own doc comment for what each does.
 *   `revocationLog` uses `core`'s in-memory fake — the identical disclosed
 *   gap this composition root already carries for `encounterLog` (no
 *   SQLite-backed adapter exists yet for either).
 * - **Structured logging (issue #52)** via `JsonLinesLogger`
 *   (`../observability/json-lines-logger.js`), wired into both
 *   `HttpTransportServer` (security events) and `SwapService` (lifecycle
 *   events) — one writer, both event streams.
 * - **`AdminService` + `AdminHttpServer` (issue #50)**, a third, distinct,
 *   localhost-only listener alongside the public swap port and the LAN
 *   discovery responder — see `../admin/admin-http-server.js`'s doc comment
 *   for why it is a separate server with a hard-coded loopback bind rather
 *   than a route on the public port.
 * - **Optional TLS (issue #49)**, generated and persisted via
 *   `./tls-cert.js` when `config.tlsEnabled` — see that file's doc comment
 *   for the trust model and why this one remains opt-in rather than
 *   defaulted on.
 * - **A reactive swap-on-connect loop, via `HttpTransportServer`'s
 *   `onNewPeer` hook.** The mobile composition root's `wireAutomaticSwap`
 *   (`composition-root-shared.ts`) reacts to `DiscoveryPort.startDiscovery`
 *   finding a peer. A node never calls `startDiscovery` — it is the thing
 *   being discovered — so it has no symmetric event to react to. This
 *   batch adds a small, purely additive `onNewPeer` option to
 *   `HttpTransportServer` (see that file's doc comment) that fires the
 *   first time a given peer's `x-peer-id` shows up *and has authenticated*;
 *   {@link handleNewPeer} below is this root's equivalent of
 *   `wireAutomaticSwap` — same shape (call `swapService.swap`, adopt the
 *   result into `libraryService`, swallow failures so one bad peer never
 *   crashes the process), just triggered by an inbound connection instead
 *   of a discovery callback. **Disclosed simplification:** the peer's
 *   `PeerKind` is not actually knowable from a bare HTTP connection
 *   (nothing in the wire protocol or `x-peer-id` carries it), so every
 *   inbound peer is treated as `"person"` — the more permissive
 *   `OfferPolicy`/`AcceptPolicy` case (SPEC.md §6.3: a node may seed
 *   generously either way, so this only affects `OfferPolicy` branches that
 *   key off `peerKind`, and the naive default used here does not). A real
 *   per-connection `PeerKind` signal would need a protocol change (e.g. LAN
 *   discovery's probe carrying the prober's own kind) — out of scope for
 *   this batch, noted rather than silently assumed away.
 */
import {
  InMemoryEncounterLogPort,
  InMemoryRevocationLogPort,
  SlidingWindowRateLimiter,
  createNaiveAcceptPolicy,
  createNaiveEvictionPolicy,
  naiveOfferPolicy,
  type AcceptPolicy,
  type EvictionPolicy,
  type LibraryCapacity,
  type PeerAddress,
} from "@art-pollinator/core";
import { AdminService, LibraryService, SwapService } from "@art-pollinator/app";
import { HttpTransportServer } from "@art-pollinator/transport-http";
import { LanDiscoveryResponder } from "@art-pollinator/discovery-lan";
import { SqliteMetadataRepository } from "@art-pollinator/metadata-repository-sqlite";
import { NodeIdentityAdapter, NodeSignatureVerifier } from "@art-pollinator/identity-node";
import type { NodeServerConfig } from "../config.js";
import { NODE_MAX_TOTAL_SLOTS } from "./node-capacity.js";
import { ensureSelfSignedCert } from "./tls-cert.js";
import { JsonLinesLogger } from "../observability/json-lines-logger.js";
import { AdminHttpServer } from "../admin/admin-http-server.js";

/** A real (`Date.now()`-backed) `ClockPort` — the Node analogue of `clients/mobile`'s `SystemClockPort`. Trivial platform wiring, not domain logic (AGENTS.md §2 rule 4 is about business logic, not this one-line pass-through every composition root needs its own copy of). */
export class SystemClockPort {
  now(): number {
    return Date.now();
  }
}

/**
 * Swap-attempt rate limiting defaults (issue #49). Generous enough that a
 * genuinely busy venue's ordinary traffic never trips it, while still
 * bounding a flooding peer's cost to this device — see
 * `docs/security/threat-model.md` for the reasoning behind these specific
 * numbers (a considered starting point, not a load-tested one, exactly the
 * same honesty `node-capacity.ts`'s own numbers are documented with).
 */
const SWAP_RATE_LIMIT_MAX_ATTEMPTS = 30;
const SWAP_RATE_LIMIT_WINDOW_MS = 60_000;

export interface NodeCompositionRootHandle {
  readonly swapService: SwapService;
  readonly libraryService: LibraryService;
  readonly adminService: AdminService;
  readonly metadataRepository: SqliteMetadataRepository;
  readonly transport: HttpTransportServer;
  readonly capacity: LibraryCapacity;
  /**
   * Starts all three listeners — `HttpTransportServer` first (so this
   * node's own dial-in address is known before `LanDiscoveryResponder`
   * advertises it — see this file's doc comment), then discovery, then the
   * localhost-only `AdminHttpServer` — and returns the resolved addresses
   * other devices (and this node's own operator) reach it at.
   */
  start(): Promise<{
    readonly baseUrl: string;
    readonly transportPort: number;
    readonly adminBaseUrl: string;
  }>;
  /** Stops all three listeners and closes the SQLite connection. Safe to call once, after {@link start}. */
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
  const metadataRepository = new SqliteMetadataRepository({ filePath: config.dbPath });
  const libraryService = await LibraryService.create(metadataRepository, config.capacity);

  const identity = new NodeIdentityAdapter({ mode: "node", storageDir: config.identityStorageDir });
  const signatureVerifier = new NodeSignatureVerifier();
  const logger = new JsonLinesLogger();
  const revocationLog = new InMemoryRevocationLogPort();
  const swapRateLimiter = new SlidingWindowRateLimiter({
    maxEvents: SWAP_RATE_LIMIT_MAX_ATTEMPTS,
    windowMs: SWAP_RATE_LIMIT_WINDOW_MS,
  });

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
        // that vanishes mid-exchange lands here as a rejected promise, and
        // now also issue #49 — a rate-limited or unauthenticated peer lands
        // here the same way) must never crash this long-lived process.
      });
  };

  const tlsMaterial = config.tlsEnabled
    ? ensureSelfSignedCert(config.identityStorageDir, config.host)
    : undefined;

  const transport = new HttpTransportServer({
    ...(config.longPollTimeoutMs !== undefined
      ? { longPollTimeoutMs: config.longPollTimeoutMs }
      : {}),
    ...(tlsMaterial ? { tls: { cert: tlsMaterial.cert, key: tlsMaterial.key } } : {}),
    onNewPeer: handleNewPeer,
    security: { signatureVerifier, logger },
  });

  // Live-reading policy/capacity dependencies (issue #50's runtime capacity
  // change) — see this file's doc comment on why these are getters reading
  // `libraryService.getCapacity()` on every access rather than values
  // frozen at construction time.
  swapService = new SwapService({
    transport,
    metadataRepository,
    // Disclosed gap, same category as `composition-root-shared.ts`'s own
    // note on this port: no SQLite-backed `EncounterLogPort`/
    // `RevocationLogPort` exists yet, so this node's encounter memory
    // (SPEC.md §6.4) and revocation knowledge (issue #51) do not survive a
    // process restart. Real persistent adapters are separate future work.
    encounterLog: new InMemoryEncounterLogPort(),
    clock: new SystemClockPort(),
    offerPolicy: naiveOfferPolicy,
    get acceptPolicy(): AcceptPolicy {
      return createNaiveAcceptPolicy(libraryService.getCapacity().swappableSlots);
    },
    get evictionPolicy(): EvictionPolicy {
      return createNaiveEvictionPolicy(libraryService.getCapacity().swappableSlots);
    },
    signatureVerifier,
    get libraryCapacity(): LibraryCapacity {
      return libraryService.getCapacity();
    },
    swapRateLimiter,
    revocationLog,
    logger,
  });

  const adminService = new AdminService({
    libraryService,
    revocationLog,
    identity,
    clock: new SystemClockPort(),
    maxTotalSlots: NODE_MAX_TOTAL_SLOTS,
    securityStatus: { getStatus: () => transport.getSecurityStats() },
  });

  let discovery: LanDiscoveryResponder | undefined;
  let started = false;
  const processStartedAtEpochMs = Date.now();
  const adminHttpServer = new AdminHttpServer({
    admin: adminService,
    processStartedAtEpochMs,
    isTransportListening: () => started,
  });

  return {
    swapService,
    libraryService,
    adminService,
    metadataRepository,
    transport,
    capacity: config.capacity,
    async start() {
      const { port, baseUrl } = await transport.listen(config.transportPort, config.host);
      discovery = new LanDiscoveryResponder({ selfPeerId: baseUrl, selfKind: "node" });
      await discovery.listen(config.discoveryPort, config.host);
      const { baseUrl: adminBaseUrl } = await adminHttpServer.listen(config.adminPort);
      started = true;
      return { baseUrl, transportPort: port, adminBaseUrl };
    },
    /**
     * Stops all three listeners and closes the SQLite connection. Safe to
     * call even if `start()` was never called (e.g. a composition root
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
        await adminHttpServer.close();
      }
      metadataRepository.close();
    },
  };
}
