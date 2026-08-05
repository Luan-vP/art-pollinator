import { describe, expect, it } from "vitest";
import { InMemoryNetworkStatusPort } from "./in-memory-network-status-port.js";

describe("InMemoryNetworkStatusPort", () => {
  it("defaults to no connectivity, unmetered", async () => {
    const port = new InMemoryNetworkStatusPort();
    await expect(port.current()).resolves.toEqual({ kind: "none", isMetered: false });
  });

  it("reports whatever the constructor was given", async () => {
    const port = new InMemoryNetworkStatusPort({ kind: "wifi", isMetered: false });
    await expect(port.current()).resolves.toEqual({ kind: "wifi", isMetered: false });
  });

  it("set() changes what subsequent current() calls report", async () => {
    const port = new InMemoryNetworkStatusPort({ kind: "cellular", isMetered: true });
    port.set({ kind: "wifi", isMetered: false });
    await expect(port.current()).resolves.toEqual({ kind: "wifi", isMetered: false });
  });
});
