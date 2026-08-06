import { describe, expect, it } from "vitest";
import { DEFAULT_LAN_DISCOVERY_PORT } from "@art-pollinator/discovery-lan";
import { DEFAULT_ADMIN_PORT, DEFAULT_TRANSPORT_PORT, readConfigFromEnv } from "./config.js";
import { NODE_DEFAULT_CAPACITY } from "./composition/node-capacity.js";

describe("readConfigFromEnv", () => {
  it("defaults every field when the environment sets none of them", () => {
    const config = readConfigFromEnv({});
    expect(config.host).toBe("0.0.0.0");
    expect(config.transportPort).toBe(DEFAULT_TRANSPORT_PORT);
    expect(config.discoveryPort).toBe(DEFAULT_LAN_DISCOVERY_PORT);
    expect(config.adminPort).toBe(DEFAULT_ADMIN_PORT);
    expect(config.capacity).toEqual(NODE_DEFAULT_CAPACITY);
    expect(config.dbPath).toMatch(/library\.sqlite3$/);
    expect(config.tlsEnabled).toBe(false);
  });

  it("reads every field from the environment when set", () => {
    const config = readConfigFromEnv({
      ARTPOLLINATOR_NODE_HOST: "127.0.0.1",
      ARTPOLLINATOR_NODE_TRANSPORT_PORT: "9001",
      ARTPOLLINATOR_NODE_DISCOVERY_PORT: "9002",
      ARTPOLLINATOR_NODE_ADMIN_PORT: "9003",
      ARTPOLLINATOR_NODE_DB_PATH: ":memory:",
      ARTPOLLINATOR_NODE_CAPACITY_TOTAL_SLOTS: "500",
      ARTPOLLINATOR_NODE_CAPACITY_LOCKABLE_SLOTS: "50",
      ARTPOLLINATOR_NODE_TLS_ENABLED: "true",
    });
    expect(config.host).toBe("127.0.0.1");
    expect(config.transportPort).toBe(9001);
    expect(config.discoveryPort).toBe(9002);
    expect(config.adminPort).toBe(9003);
    expect(config.dbPath).toBe(":memory:");
    expect(config.capacity).toEqual({ maxLockableSlots: 50, swappableSlots: 450 });
    expect(config.tlsEnabled).toBe(true);
  });

  it("propagates InvalidNodeCapacityError for an out-of-bounds capacity request", () => {
    expect(() => readConfigFromEnv({ ARTPOLLINATOR_NODE_CAPACITY_TOTAL_SLOTS: "999999" })).toThrow(
      /hard upper bound/,
    );
  });

  it("throws on a non-numeric port", () => {
    expect(() => readConfigFromEnv({ ARTPOLLINATOR_NODE_TRANSPORT_PORT: "not-a-number" })).toThrow(
      /not a number/,
    );
  });
});
