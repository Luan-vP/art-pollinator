/**
 * `NodeServerConfig` — the node's runtime configuration (issue #45/#46),
 * read from environment variables by {@link readConfigFromEnv} so the
 * process can actually be configured without editing code (SPEC.md §6.1:
 * "all scan frequencies configurable"; this extends the same "configurable,
 * not hardcoded" spirit to a node's network/storage/capacity settings).
 *
 * Every field has a sane default so `npm run start --workspace=clients/node`
 * works out of the box with zero environment variables set — matching how
 * every adapter in this codebase already defaults its own options (e.g.
 * `HttpTransportServer`'s `longPollTimeoutMs`, `LanDiscoveryProber`'s
 * `probeIntervalMs`).
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LAN_DISCOVERY_PORT } from "@art-pollinator/discovery-lan";
import { resolveNodeCapacity, type NodeCapacityOverrides } from "./composition/node-capacity.js";
import { type LibraryCapacity } from "@art-pollinator/core";

/**
 * The port this node's `HttpTransportServer` listens on for real swap
 * traffic — deliberately a *different* port from
 * {@link DEFAULT_LAN_DISCOVERY_PORT} (the "who are you" responder): the two
 * are separate concerns (SPEC.md §6.1's discovery step vs. §6.2's transfer
 * step) served by two independent `node:http` servers in this composition
 * root, and giving them distinct default ports means a firewall/operator can
 * tell the two apart.
 */
export const DEFAULT_TRANSPORT_PORT = 47822;

/** Port `AdminHttpServer` listens on, localhost-only (issue #50) — a third, distinct default so an operator/firewall can tell all three of this node's listeners apart at a glance. */
export const DEFAULT_ADMIN_PORT = 47824;

export interface NodeServerConfig {
  /** Interface both the transport server and the discovery responder bind to. `"0.0.0.0"` (every interface) is the real-deployment default; tests override to `"127.0.0.1"`. */
  readonly host: string;
  /** Port `HttpTransportServer` listens on. `0` requests an OS-assigned ephemeral port (tests only — a real deployment needs a fixed, known port so LAN probes can find it). */
  readonly transportPort: number;
  /** Port `LanDiscoveryResponder` listens on. */
  readonly discoveryPort: number;
  /** Port `AdminHttpServer` listens on — always bound to `127.0.0.1` regardless of `host` (issue #50; see `AdminHttpServer`'s doc comment). */
  readonly adminPort: number;
  /** Path to the SQLite database file. `":memory:"` is valid (ephemeral, does not survive restart — see `SqliteMetadataRepository`'s own doc comment) and is what tests use by default. */
  readonly dbPath: string;
  /** Directory this node's identity (issue #57's `NodeIdentityAdapter`, `mode: "node"`) and, when TLS is enabled, its self-signed certificate (issue #49) are persisted under. */
  readonly identityStorageDir: string;
  /** This node's configured `Library` capacity (issue #46). */
  readonly capacity: LibraryCapacity;
  /** How long a peer's long-poll `GET /messages` waits before a `204`. Passed straight through to `HttpTransportServer`. */
  readonly longPollTimeoutMs?: number;
  /**
   * Enables HTTPS on the public swap port, using a self-signed certificate
   * generated (and persisted) via `./composition/tls-cert.ts` (issue #49).
   * Defaults to `false`: this codebase's own cross-platform swap client
   * (`HttpTransportClient`, used by the browser and mobile targets via
   * plain `fetch`) cannot yet verify a self-signed certificate without an
   * operator additionally configuring their OS/browser to trust it — see
   * `docs/adr/0014-transport-tls-scope.md`. An operator who has arranged
   * client-side trust out of band (or is only ever dialled into by another
   * Node-based client, which *can* pin a fingerprint — see that ADR) may
   * set `ARTPOLLINATOR_NODE_TLS_ENABLED=true` today.
   */
  readonly tlsEnabled: boolean;
}

/**
 * Read a {@link NodeServerConfig} from `process.env`, falling back to
 * defaults for anything unset. Throws (via {@link resolveNodeCapacity},
 * `InvalidNodeCapacityError`) if `ARTPOLLINATOR_NODE_CAPACITY_TOTAL_SLOTS`/
 * `ARTPOLLINATOR_NODE_CAPACITY_LOCKABLE_SLOTS` request an out-of-bounds
 * capacity — fail loudly at startup rather than silently running with a
 * different capacity than the operator configured.
 */
export function readConfigFromEnv(env: NodeJS.ProcessEnv = process.env): NodeServerConfig {
  const totalSlots = envInt(env, "ARTPOLLINATOR_NODE_CAPACITY_TOTAL_SLOTS");
  const lockableSlots = envInt(env, "ARTPOLLINATOR_NODE_CAPACITY_LOCKABLE_SLOTS");
  // `exactOptionalPropertyTypes` (tsconfig.base.json) distinguishes "key
  // absent" from "key present with value `undefined`" — `NodeCapacityOverrides`'
  // optional fields mean the former, so each override is only spread in
  // when it actually parsed to a number, never set to a bare `undefined`.
  const capacityOverrides: NodeCapacityOverrides = {
    ...(totalSlots !== undefined ? { totalSlots } : {}),
    ...(lockableSlots !== undefined ? { lockableSlots } : {}),
  };

  return {
    host: env.ARTPOLLINATOR_NODE_HOST ?? "0.0.0.0",
    transportPort: envInt(env, "ARTPOLLINATOR_NODE_TRANSPORT_PORT") ?? DEFAULT_TRANSPORT_PORT,
    discoveryPort: envInt(env, "ARTPOLLINATOR_NODE_DISCOVERY_PORT") ?? DEFAULT_LAN_DISCOVERY_PORT,
    adminPort: envInt(env, "ARTPOLLINATOR_NODE_ADMIN_PORT") ?? DEFAULT_ADMIN_PORT,
    dbPath:
      env.ARTPOLLINATOR_NODE_DB_PATH ??
      join(homedir(), ".art-pollinator", "node", "library.sqlite3"),
    identityStorageDir:
      env.ARTPOLLINATOR_NODE_IDENTITY_DIR ?? join(homedir(), ".art-pollinator", "node", "identity"),
    capacity: resolveNodeCapacity(capacityOverrides),
    tlsEnabled: envBool(env, "ARTPOLLINATOR_NODE_TLS_ENABLED") ?? false,
  };
}

function envBool(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  return raw === "1" || raw.toLowerCase() === "true";
}

function envInt(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}: "${raw}" is not a number.`);
  }
  return parsed;
}
