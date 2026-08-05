/**
 * LanDiscoveryResponder — the advertising half of LAN discovery (issue
 * #44): a real `node:http` server exposing a tiny "who are you" endpoint
 * on a known port, so another device probing that port can find this one.
 * SPEC.md §6.1 frames Wi-Fi discovery as "probe for the service on known
 * port(s)" — this is that service.
 *
 * Not itself a `DiscoveryPort` (a `DiscoveryPort` finds peers; this is
 * "make this device findable"). `HttpProbeLanDiscoveryAdapter` owns one of
 * these internally so a single device is simultaneously discoverable
 * (this class) and discovering (the adapter's own probing loop) — the
 * HTTP analogue of BLE's mutual advertise-and-scan (SPEC.md §6.1).
 */
import { createServer, type Server } from "node:http";
import type { PeerKind } from "@art-pollinator/core";

export interface LanDiscoveryResponderOptions {
  /** This device's own peer id, returned to whoever probes it (typically the base URL others should address it by, e.g. `http://192.168.1.42:47821`). */
  readonly selfPeerId: string;
  readonly selfKind: PeerKind;
}

const RESPONDER_PATH = "/art-pollinator-node";

export class LanDiscoveryResponder {
  private readonly server: Server;
  private readonly options: LanDiscoveryResponderOptions;

  constructor(options: LanDiscoveryResponderOptions) {
    this.options = options;
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === RESPONDER_PATH) {
        const body = JSON.stringify({
          peerId: this.options.selfPeerId,
          kind: this.options.selfKind,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
        return;
      }
      res.writeHead(404).end();
    });
  }

  listen(port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.removeListener("error", reject);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

export { RESPONDER_PATH };
