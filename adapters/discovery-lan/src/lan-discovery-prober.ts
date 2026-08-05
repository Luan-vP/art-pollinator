/**
 * LanDiscoveryProber — the scanning half of LAN discovery (issue #44):
 * probes known candidate hosts on a known port for the ArtPollinator LAN
 * service (`./lan-discovery-responder.ts`'s `GET /art-pollinator-node`),
 * using only `fetch` and `SchedulerPort` — no `node:http`, no other
 * Node-only import.
 *
 * ## Why this is its own class, separate from `HttpProbeLanDiscoveryAdapter`
 *
 * Issue #44's own acceptance criteria requires LAN discovery to "work from
 * the browser target (no BLE dependency)." A browser can probe (it has
 * `fetch`), but it can **never** be probed — there is no browser API to
 * accept an inbound TCP connection, so a browser can never run
 * `LanDiscoveryResponder`'s `node:http` server. If probing and responding
 * were fused into one class (as an earlier version of this adapter did),
 * simply *importing* that class would pull in `node:http` — unresolvable
 * in a browser bundle — even on a code path that never calls `.listen()`.
 * That would make the class itself unsafe to import from
 * `clients/mobile`'s web composition root, silently violating this
 * package's own "works from the browser target" requirement the moment it
 * was actually wired up (caught while doing exactly that wiring — see this
 * package's README "Design history" note).
 *
 * `LanDiscoveryProber` is the fix: a `DiscoveryPort` implementation with
 * zero Node-only imports, safe for `clients/mobile`'s web build to
 * construct directly. `HttpProbeLanDiscoveryAdapter` (Node/native use —
 * a device that also wants to be discoverable) composes this class with
 * `LanDiscoveryResponder` rather than duplicating the probing logic.
 */
import type {
  DiscoveredPeer,
  DiscoveryPort,
  PeerKind,
  SchedulerHandle,
  SchedulerPort,
} from "@art-pollinator/core";

/** The port every ArtPollinator LAN node listens on unless configured otherwise — SPEC.md §6.1's "known port(s)." */
export const DEFAULT_LAN_DISCOVERY_PORT = 47821;
const DEFAULT_PROBE_INTERVAL_MS = 3_000;
const DEFAULT_PROBE_TIMEOUT_MS = 1_000;

interface ProbeResponseBody {
  readonly peerId: string;
  readonly kind: PeerKind;
}

export interface LanDiscoveryProberOptions {
  /** The known port to probe candidates on. Defaults to {@link DEFAULT_LAN_DISCOVERY_PORT}. */
  readonly port?: number;
  /** Other hosts (bare hostname/IP, no scheme or port) to probe on `port` — see `./http-probe-lan-discovery-adapter.ts`'s doc comment for why this can't be auto-enumerated here. */
  readonly candidateHosts: readonly string[];
  readonly scheduler: SchedulerPort;
  /** How often to re-probe every not-yet-discovered candidate. Defaults to {@link DEFAULT_PROBE_INTERVAL_MS}. */
  readonly probeIntervalMs?: number;
  /** Per-probe request timeout, so an unreachable/firewalled host doesn't stall a probe cycle. Defaults to {@link DEFAULT_PROBE_TIMEOUT_MS}. */
  readonly probeTimeoutMs?: number;
}

export class LanDiscoveryProber implements DiscoveryPort {
  private readonly options: LanDiscoveryProberOptions;
  private readonly port: number;
  private readonly probeIntervalMs: number;
  private readonly probeTimeoutMs: number;

  private onPeerFound: ((peer: DiscoveredPeer) => void) | undefined;
  private readonly discoveredPeerIds = new Set<string>();
  private recurringHandle: SchedulerHandle | undefined;
  private discovering = false;

  constructor(options: LanDiscoveryProberOptions) {
    this.options = options;
    this.port = options.port ?? DEFAULT_LAN_DISCOVERY_PORT;
    this.probeIntervalMs = options.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  }

  startDiscovery(onPeerFound: (peer: DiscoveredPeer) => void): Promise<void> {
    if (this.discovering) return Promise.resolve();
    this.onPeerFound = onPeerFound;
    this.discoveredPeerIds.clear();
    this.discovering = true;
    const firstProbe = this.probeOnce(); // probe immediately, don't wait a full interval for the first attempt
    this.recurringHandle = this.options.scheduler.scheduleRecurring(this.probeIntervalMs, () => {
      void this.probeOnce();
    });
    return firstProbe;
  }

  stopDiscovery(): Promise<void> {
    if (!this.discovering) return Promise.resolve();
    this.discovering = false;
    if (this.recurringHandle) {
      this.options.scheduler.cancel(this.recurringHandle);
      this.recurringHandle = undefined;
    }
    this.onPeerFound = undefined;
    return Promise.resolve();
  }

  get isDiscovering(): boolean {
    return this.discovering;
  }

  private async probeOnce(): Promise<void> {
    await Promise.all(
      this.options.candidateHosts.map(async (host) => {
        const result = await this.probeHost(host);
        if (result && !this.discoveredPeerIds.has(result.peerId)) {
          this.discoveredPeerIds.add(result.peerId);
          this.onPeerFound?.({ address: { id: result.peerId }, kind: result.kind });
        }
      }),
    );
  }

  private async probeHost(host: string): Promise<ProbeResponseBody | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.probeTimeoutMs);
    try {
      const response = await fetch(`http://${host}:${String(this.port)}/art-pollinator-node`, {
        method: "GET",
        signal: controller.signal,
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as ProbeResponseBody;
      if (typeof body.peerId !== "string" || (body.kind !== "node" && body.kind !== "person")) {
        return undefined;
      }
      return body;
    } catch {
      return undefined; // unreachable, refused, timed out, or malformed — just not found this round
    } finally {
      clearTimeout(timer);
    }
  }
}
