/**
 * Swap protocol message schema — issue #22.
 *
 * SPEC.md §6.2: "The message schema is transport-agnostic — identical over
 * BLE and HTTP." Nothing in this file (or `./swap-message-codec.ts`) ever
 * imports a transport, and nothing here is shaped around BLE's MTU or
 * HTTP's request/response semantics — that is exactly what keeps a single
 * schema usable over both (AGENTS.md §2 rule 2's "no platform conditionals"
 * extended to the protocol layer). `core/src/ports/transport-port.ts`'s
 * `send(peer, bytes)` / `receive()` shape is the only surface either
 * transport needs to implement; everything above that line is these types
 * plus `./swap-message-codec.ts`.
 *
 * ## The five message kinds (SPEC.md §6.2's flow)
 *
 * `discover-ack`, `offer`, `accept`, `transfer`, `reconcile-ack` — one per
 * step of "discover a peer → exchange tokens → negotiate → transfer →
 * reconcile." `SwapService` (`app/src/swap/swap-service.ts`) sends and
 * receives `offer` and `accept` today; see that file's own doc comment and
 * ADR-0006 for why the other three kinds are defined and round-trip-tested
 * here (issue #24) without yet being sent over the wire by this batch's
 * orchestration — `discover-ack` belongs to the discovery handshake
 * (`DiscoveryPort`/`SchedulerPort` territory, issues #34-35, not yet built),
 * and `transfer`/`reconcile-ack` would matter most once blob transfer and
 * cross-device eviction acknowledgement exist (issue #40+, Phase 1b). Adding
 * the message kind to the schema now, rather than only two of five, is what
 * lets issue #24's codec round-trip *all* of them today, so nothing about
 * the wire format needs revisiting when those later features start actually
 * sending them.
 *
 * ## Versioning and negotiation strategy
 *
 * Every message is wrapped in an envelope carrying a numeric `version`.
 * `SWAP_PROTOCOL_VERSION` is the only version this codebase currently
 * speaks. The negotiation strategy (this issue's explicit requirement) is
 * **reject on any version mismatch** — see {@link isSupportedVersion} and
 * {@link negotiateVersion}. This is the simplest safe default for a
 * single-version protocol: there is nothing to downgrade *to* yet. A future
 * version bump that needs to interoperate with older peers should replace
 * `isSupportedVersion`'s single equality check with an explicit supported
 * range (e.g. a minimum and maximum), and can use `negotiateVersion`'s
 * existing `{ ok, reason }` shape without changing its callers — that seam
 * is deliberately kept generic now so a downgrade path can be added later
 * without a breaking change to this module's API. See
 * `docs/adr/0009-swap-protocol-versioning.md`.
 */
import type { PeerKind } from "../ports/discovery-port.js";
import type { MetadataToken } from "../metadata/metadata-token.js";

/** The only protocol version this codebase currently speaks. */
export const SWAP_PROTOCOL_VERSION = 1;

/** A message envelope: every `SwapProtocolMessage` carries a `version` and a `kind` alongside its `body`. */
export interface SwapProtocolEnvelope<Kind extends string, Body> {
  readonly version: number;
  readonly kind: Kind;
  readonly body: Body;
}

/** Step 1 (SPEC.md §6.2): confirms discovery and advertises the discovering side's `PeerKind` before negotiation begins. */
export interface DiscoverAckBody {
  readonly peerKind: PeerKind;
}
export type DiscoverAckMessage = SwapProtocolEnvelope<"discover-ack", DiscoverAckBody>;

/** Step 2 (SPEC.md §6.2): the sender's `OfferPolicy`-selected, encounter-memory-filtered candidate items. */
export interface OfferBody {
  readonly items: readonly MetadataToken[];
}
export type OfferMessage = SwapProtocolEnvelope<"offer", OfferBody>;

/** Step 3 (SPEC.md §6.2): which of the peer's offered content hashes this side's `AcceptPolicy` accepted. */
export interface AcceptBody {
  readonly acceptedContentHashes: readonly string[];
}
export type AcceptMessage = SwapProtocolEnvelope<"accept", AcceptBody>;

/** Step 4 (SPEC.md §6.2): the actual accepted tokens as transferred (post hop-count increment, issue #21). */
export interface TransferBody {
  readonly items: readonly MetadataToken[];
}
export type TransferMessage = SwapProtocolEnvelope<"transfer", TransferBody>;

/** Step 5 (SPEC.md §6.2): acknowledges which content hashes `EvictionPolicy` evicted to reconcile slot limits. */
export interface ReconcileAckBody {
  readonly evictedContentHashes: readonly string[];
}
export type ReconcileAckMessage = SwapProtocolEnvelope<"reconcile-ack", ReconcileAckBody>;

export type SwapProtocolMessage =
  DiscoverAckMessage | OfferMessage | AcceptMessage | TransferMessage | ReconcileAckMessage;

/** `true` if `version` is one this build of the codec can decode. See this module's doc comment for the negotiation strategy. */
export function isSupportedVersion(version: number): boolean {
  return version === SWAP_PROTOCOL_VERSION;
}

export type VersionNegotiationResult =
  { readonly ok: true; readonly version: number } | { readonly ok: false; readonly reason: string };

/**
 * Negotiate a protocol version against a peer's advertised version.
 * Reject-on-mismatch (this module's doc comment): the only version that
 * negotiates successfully today is an exact match on
 * {@link SWAP_PROTOCOL_VERSION}. Exposed as its own function (rather than
 * inlined into the codec) so a composition root can negotiate a version
 * up front — e.g. during the `discover-ack` step — before committing to a
 * full swap.
 */
export function negotiateVersion(peerVersion: number): VersionNegotiationResult {
  if (isSupportedVersion(peerVersion)) {
    return { ok: true, version: SWAP_PROTOCOL_VERSION };
  }
  return {
    ok: false,
    reason: `Unsupported swap protocol version ${String(peerVersion)}: this build only speaks version ${String(SWAP_PROTOCOL_VERSION)}.`,
  };
}

function envelope<Kind extends string, Body>(
  kind: Kind,
  body: Body,
): SwapProtocolEnvelope<Kind, Body> {
  return { version: SWAP_PROTOCOL_VERSION, kind, body };
}

export function createDiscoverAckMessage(peerKind: PeerKind): DiscoverAckMessage {
  return envelope("discover-ack", { peerKind });
}

export function createOfferMessage(items: readonly MetadataToken[]): OfferMessage {
  return envelope("offer", { items });
}

export function createAcceptMessage(acceptedContentHashes: readonly string[]): AcceptMessage {
  return envelope("accept", { acceptedContentHashes });
}

export function createTransferMessage(items: readonly MetadataToken[]): TransferMessage {
  return envelope("transfer", { items });
}

export function createReconcileAckMessage(
  evictedContentHashes: readonly string[],
): ReconcileAckMessage {
  return envelope("reconcile-ack", { evictedContentHashes });
}
