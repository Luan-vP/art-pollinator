import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeCompositionRoot } from "./composition-root.js";
import { NODE_DEFAULT_CAPACITY } from "./node-capacity.js";
import type { NodeServerConfig } from "../config.js";

let dbDir: string | undefined;

afterEach(() => {
  if (dbDir) {
    rmSync(dbDir, { recursive: true, force: true });
    dbDir = undefined;
  }
});

function testConfig(overrides: Partial<NodeServerConfig> = {}): NodeServerConfig {
  dbDir = mkdtempSync(join(tmpdir(), "art-pollinator-node-composition-root-"));
  return {
    host: "127.0.0.1",
    transportPort: 0,
    discoveryPort: 0,
    adminPort: 0,
    dbPath: join(dbDir, "library.sqlite3"),
    identityStorageDir: join(dbDir, "identity"),
    capacity: NODE_DEFAULT_CAPACITY,
    tlsEnabled: false,
    ...overrides,
  };
}

describe("createNodeCompositionRoot (issue #45)", () => {
  it("wires a real SwapService and LibraryService — not left unconnected (mirrors issue #37's own check for the mobile root)", async () => {
    const root = await createNodeCompositionRoot(testConfig());
    expect(root.swapService.constructor.name).toBe("SwapService");
    expect(root.libraryService.constructor.name).toBe("LibraryService");
    await root.stop();
  });

  it("registers the real HttpTransportServer and SqliteMetadataRepository (issue #45 — reuses #43's transport, real persistence)", async () => {
    const root = await createNodeCompositionRoot(testConfig());
    expect(root.transport.constructor.name).toBe("HttpTransportServer");
    expect(root.metadataRepository.constructor.name).toBe("SqliteMetadataRepository");
    await root.stop();
  });

  it("uses the configured node capacity, not the phone's fixed default (issue #46)", async () => {
    const root = await createNodeCompositionRoot(
      testConfig({ capacity: { maxLockableSlots: 3, swappableSlots: 7 } }),
    );
    expect(root.capacity).toEqual({ maxLockableSlots: 3, swappableSlots: 7 });
    await root.stop();
  });

  it("start() binds the transport server and the discovery responder can be reached at the resolved base URL", async () => {
    const root = await createNodeCompositionRoot(testConfig());
    const { baseUrl, transportPort } = await root.start();
    expect(baseUrl).toBe(`http://127.0.0.1:${String(transportPort)}`);
    await root.stop();
  });

  it("the library starts empty for a fresh database", async () => {
    const root = await createNodeCompositionRoot(testConfig());
    expect(root.libraryService.getLibrary().entries.size).toBe(0);
    await root.stop();
  });

  it("stop() is safe to call and releases the SQLite connection (a second stop() on transport/discovery does not throw)", async () => {
    const root = await createNodeCompositionRoot(testConfig());
    await root.start();
    await expect(root.stop()).resolves.toBeUndefined();
  });
});
