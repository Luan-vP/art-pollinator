/**
 * HttpProbeLanDiscoveryAdapter — `DiscoveryPort` over Wi-Fi/LAN (issue #44,
 * pulled forward from Phase 2) for a device that wants to be BOTH
 * discoverable (`./lan-discovery-responder.ts`, real `node:http`) AND
 * discovering (`./lan-discovery-prober.ts`, `fetch`-only) — a Node/native
 * use case (e.g. a stationary node, or a native mobile client that also
 * wants to seed others). Composes those two pieces rather than
 * duplicating either's logic; see README.md for the full design rationale
 * (HTTP probe-and-respond, not mDNS/UDP) and `./lan-discovery-prober.ts`'s
 * doc comment for **why this class must never be imported from a browser
 * bundle** — it constructs a real `node:http` server, unlike
 * `LanDiscoveryProber`, which `clients/mobile`'s web composition root uses
 * directly instead.
 */
import type {
  DiscoveredPeer,
  DiscoveryPort,
  PeerAddress,
  PeerKind,
  SchedulerPort,
} from "@art-pollinator/core";
import { LanDiscoveryResponder } from "./lan-discovery-responder.js";
import { DEFAULT_LAN_DISCOVERY_PORT, LanDiscoveryProber } from "./lan-discovery-prober.js";

export interface HttpProbeLanDiscoveryAdapterOptions {
  /** This device's own address, as it should be given out to peers that discover it (typically `http://<this-host>:<port>`). */
  readonly selfAddress: PeerAddress;
  readonly selfKind: PeerKind;
  /** The host/interface this device's own responder binds to (e.g. "127.0.0.1", "0.0.0.0", or a LAN IP). */
  readonly host: string;
  /** The known port both this device's responder and its probes use. Defaults to {@link DEFAULT_LAN_DISCOVERY_PORT}. */
  readonly port?: number;
  /** Other hosts (bare hostname/IP, no scheme or port) to probe on `port` — see `./lan-discovery-prober.ts`'s doc comment for why this can't be auto-enumerated here. */
  readonly candidateHosts: readonly string[];
  readonly scheduler: SchedulerPort;
  /** How often to re-probe every not-yet-discovered candidate. */
  readonly probeIntervalMs?: number;
  /** Per-probe request timeout, so an unreachable/firewalled host doesn't stall a probe cycle. */
  readonly probeTimeoutMs?: number;
}

export class HttpProbeLanDiscoveryAdapter implements DiscoveryPort {
  private readonly host: string;
  private readonly port: number;
  private readonly responder: LanDiscoveryResponder;
  private readonly prober: LanDiscoveryProber;
  private discovering = false;

  constructor(options: HttpProbeLanDiscoveryAdapterOptions) {
    this.host = options.host;
    this.port = options.port ?? DEFAULT_LAN_DISCOVERY_PORT;
    this.responder = new LanDiscoveryResponder({
      selfPeerId: options.selfAddress.id,
      selfKind: options.selfKind,
    });
    this.prober = new LanDiscoveryProber({
      port: this.port,
      candidateHosts: options.candidateHosts,
      scheduler: options.scheduler,
      ...(options.probeIntervalMs !== undefined
        ? { probeIntervalMs: options.probeIntervalMs }
        : {}),
      ...(options.probeTimeoutMs !== undefined ? { probeTimeoutMs: options.probeTimeoutMs } : {}),
    });
  }

  async startDiscovery(onPeerFound: (peer: DiscoveredPeer) => void): Promise<void> {
    if (this.discovering) return;
    this.discovering = true;
    await this.responder.listen(this.port, this.host);
    await this.prober.startDiscovery(onPeerFound);
  }

  async stopDiscovery(): Promise<void> {
    if (!this.discovering) return;
    this.discovering = false;
    await this.prober.stopDiscovery();
    await this.responder.close();
  }

  get isDiscovering(): boolean {
    return this.discovering;
  }
}
