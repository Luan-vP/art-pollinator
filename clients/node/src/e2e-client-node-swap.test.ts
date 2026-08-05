/**
 * End-to-end test: client ↔ node (issue #48).
 *
 * The node side runs as a **real, separate OS process** — this file spawns
 * `clients/node/src/index.ts` (this same package's real, runnable entry
 * point, issue #45) as an actual child process via `node:child_process`,
 * exactly the "strongest proof" option this task's brief calls out, rather
 * than falling back to two in-process instances. See "Why a real child
 * process, and how" below for exactly what makes that possible in a
 * monorepo that ships no build step.
 *
 * The client side is built inline in this test from the same building
 * blocks `clients/mobile`'s web composition root uses for its Wi-Fi
 * node-swap path (`HttpTransportClient` + `LanDiscoveryProber` from
 * `@art-pollinator/transport-http`/`@art-pollinator/discovery-lan`, plus
 * `app`'s real `SwapService`) — not a literal import of
 * `@art-pollinator/mobile` itself, which would pull `expo`/`react-native`/
 * `react-native-ble-plx` into this process for zero benefit (and would
 * violate the same "native-only imports must never reach [a build that
 * shouldn't need them]" boundary AGENTS.md §5 already states for the web
 * bundle and the node server build alike). Every class actually
 * constructed below is the identical one `composition-root.web.ts` wires
 * up; only the wiring call site differs.
 *
 * ## Why a real child process, and how
 *
 * No package in this monorepo has ever had a build step before this batch
 * (every `package.json`'s `"main"` points straight at `.ts` source, run via
 * vitest/esbuild or Metro) — plain `node` cannot execute this codebase's
 * relative `./foo.js`-suffixed imports (`NodeNext` module resolution)
 * against sibling `.ts` files without something that both strips types
 * *and* remaps that extension, which Node's own
 * `--experimental-strip-types` does not do (verified directly against this
 * exact codebase while building this batch — see
 * `clients/node/src/index.ts`'s own doc comment for the exact failure).
 * `tsx` (a `clients/node`-only devDependency, chosen specifically so this
 * one package can be run without inventing a repo-wide bundling pipeline)
 * closes that gap. This test spawns `node <tsx's own CLI script>
 * src/index.ts` — i.e., the *exact* command `npm run start
 * --workspace=clients/node` runs — as a real child process, communicating
 * with it over nothing but a real loopback TCP socket, exactly as a second
 * physical machine on the same Wi-Fi network would (SPEC.md §4).
 *
 * ## Readiness and teardown
 *
 * `index.ts` prints one structured JSON line to stdout the moment both
 * listeners are up (`{"event":"art-pollinator-node-listening", baseUrl,
 * ...}`), parsed below to learn the real (OS-assigned) transport port
 * before this test ever tries to reach it. Teardown sends `SIGTERM` (the
 * same signal `index.ts` installs a real handler for, so its own graceful
 * shutdown path — closing the transport, the discovery responder, and the
 * SQLite connection — is exercised too) and awaits the real process exit.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  InMemoryClockPort,
  InMemoryEncounterLogPort,
  InMemoryMetadataRepositoryPort,
  addItem,
  naiveAcceptPolicy,
  naiveEvictionPolicy,
  naiveOfferPolicy,
  toPriority,
  DEFAULT_LIBRARY_CAPACITY,
  type DiscoveredPeer,
  type Library,
  type MetadataToken,
} from "@art-pollinator/core";
import { SwapService, signMetadataToken } from "@art-pollinator/app";
import { HttpTransportClient } from "@art-pollinator/transport-http";
import { LanDiscoveryProber } from "@art-pollinator/discovery-lan";
import { TimerSchedulerPort } from "@art-pollinator/scheduler-timer";
import { SqliteMetadataRepository } from "@art-pollinator/metadata-repository-sqlite";
import { NodeIdentityAdapter } from "@art-pollinator/identity-node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const nodeEntryPoint = join(__dirname, "index.ts");

/** Resolve `tsx`'s CLI script path without relying on `npx`/PATH lookup at spawn time — see this file's doc comment. */
function resolveTsxCli(): string {
  const require = createRequire(import.meta.url);
  const tsxPackageJson = require.resolve("tsx/package.json");
  return join(dirname(tsxPackageJson), "dist", "cli.mjs");
}

interface NodeListeningEvent {
  readonly event: "art-pollinator-node-listening";
  readonly baseUrl: string;
  readonly transportPort: number;
  readonly discoveryPort: number;
}

function tryParseListeningEvent(line: string): NodeListeningEvent | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as { event?: unknown }).event === "art-pollinator-node-listening"
    ) {
      return parsed as NodeListeningEvent;
    }
  } catch {
    // not a JSON line (e.g. Node's own ExperimentalWarning banner) — ignore
  }
  return undefined;
}

/** Spawn the real node server as a real child process and wait for its readiness line. */
function spawnNodeServer(env: NodeJS.ProcessEnv): Promise<{
  child: ChildProcessByStdio<null, Readable, Readable>;
  listening: NodeListeningEvent;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [resolveTsxCli(), nodeEntryPoint], {
      cwd: __dirname,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    const onStartupFailure = (): void => {
      reject(
        new Error(
          `Node server child process exited before reporting readiness.\nstdout:\n${stdoutBuffer}\nstderr:\n${stderrBuffer}`,
        ),
      );
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      for (const line of stdoutBuffer.split("\n")) {
        const event = tryParseListeningEvent(line.trim());
        if (event) {
          child.stdout.removeAllListeners("data");
          child.removeListener("exit", onStartupFailure);
          resolve({ child, listening: event });
          return;
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
    });
    child.once("exit", onStartupFailure);
    child.once("error", reject);
  });
}

async function stopNodeServer(child: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
    child.kill("SIGTERM");
    // Belt-and-suspenders: force-kill if graceful shutdown hangs, so this
    // test never leaves a zombie process behind even if `index.ts`'s own
    // SIGTERM handler regresses.
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 5_000);
  });
}

function token(contentHash: string): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "A piece worth passing on.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
}

/** A distinctive, fixed discovery port for this test only — see this file's doc comment on port choice. */
const TEST_DISCOVERY_PORT = 47_919;

let child: ChildProcessByStdio<null, Readable, Readable> | undefined;
let dbDir: string | undefined;

afterEach(async () => {
  if (child) {
    await stopNodeServer(child);
    child = undefined;
  }
  if (dbDir) {
    rmSync(dbDir, { recursive: true, force: true });
    dbDir = undefined;
  }
});

describe("end-to-end: client ↔ node, over a real spawned OS process and real HTTP (issue #48)", () => {
  it("discovers the real node process over real LAN discovery, then completes a full swap with it over real HTTP", async () => {
    dbDir = mkdtempSync(join(tmpdir(), "art-pollinator-e2e-"));
    const nodeDbPath = join(dbDir, "node-library.sqlite3");

    // --- Start the real node process. ---
    const spawned = await spawnNodeServer({
      ...process.env,
      ARTPOLLINATOR_NODE_HOST: "127.0.0.1",
      ARTPOLLINATOR_NODE_TRANSPORT_PORT: "0", // ephemeral — learned from the readiness event below
      ARTPOLLINATOR_NODE_DISCOVERY_PORT: String(TEST_DISCOVERY_PORT),
      ARTPOLLINATOR_NODE_DB_PATH: nodeDbPath,
    });
    child = spawned.child;
    expect(spawned.listening.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    // --- The client side: real LAN discovery of the real node process,
    // exactly as `composition-root.web.ts` wires it (SPEC.md §6.1). ---
    const scheduler = new TimerSchedulerPort();
    const discovery = new LanDiscoveryProber({
      candidateHosts: ["127.0.0.1"],
      port: TEST_DISCOVERY_PORT,
      scheduler,
      probeIntervalMs: 100,
    });
    const discoveredPeer = await new Promise<DiscoveredPeer>((resolve) => {
      void discovery.startDiscovery((peer) => {
        resolve(peer);
      });
    });
    await discovery.stopDiscovery();

    expect(discoveredPeer.kind).toBe("node");
    expect(discoveredPeer.address.id).toBe(spawned.listening.baseUrl);

    // --- The client's real SwapService, wired the same way
    // `composition-root-shared.ts`'s `buildSwapService` wires the mobile
    // client's: real `HttpTransportClient`, naive policies, an in-memory
    // repository (matching the mobile composition root's own disclosed gap
    // — no RN-persistent repository exists yet either). ---
    const clientTransport = new HttpTransportClient({ selfAddress: { id: "e2e-test-client" } });

    // The node process was wired with a real `NodeSignatureVerifier`
    // (`composition/composition-root.ts`) — genuine reuse of already-shipped
    // issue #58 work, not new policy logic, per this task's "don't leave
    // the server trivially wide open where it costs nothing to avoid"
    // brief. That means an *unsigned* token is correctly rejected before
    // the node's `AcceptPolicy` ever sees it — proving this test's items
    // really cross that check (not skip it), they are signed here with a
    // real Ed25519 identity (`NodeIdentityAdapter`, the same adapter class
    // the node itself would use to sign its own content in a future
    // authoring flow), not `core`'s deterministic-but-fake
    // `InMemoryIdentityPort`, which a real Ed25519 verifier would reject.
    const clientIdentity = new NodeIdentityAdapter({
      mode: "person",
      storageDir: join(dbDir, "client-identity"),
    });
    const signedItems = await Promise.all(
      ["e2e-piece-one", "e2e-piece-two"].map((hash) =>
        signMetadataToken(token(hash), clientIdentity),
      ),
    );
    let clientLibrary: Library = { entries: new Map() };
    for (const item of signedItems) {
      const result = addItem(clientLibrary, item, toPriority(0), DEFAULT_LIBRARY_CAPACITY);
      if (!result.ok) throw new Error(`fixture setup failed: ${result.error}`);
      clientLibrary = result.library;
    }

    const clientSwapService = new SwapService({
      transport: clientTransport,
      metadataRepository: new InMemoryMetadataRepositoryPort(),
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: naiveOfferPolicy,
      acceptPolicy: naiveAcceptPolicy,
      evictionPolicy: naiveEvictionPolicy,
    });

    // --- The real swap, over the real socket, against the real separate
    // process. The node's own SwapService runs inside that other process,
    // reactively (its `HttpTransportServer`'s `onNewPeer` hook — see
    // `composition/composition-root.ts`'s doc comment) — nothing in this
    // test process calls into the node's code directly. ---
    const outcome = await clientSwapService.swap(discoveredPeer, clientLibrary);

    expect(outcome.state.phase).toBe("completed");
    expect(outcome.sent.map((item) => item.contentHash).sort()).toEqual([
      "e2e-piece-one",
      "e2e-piece-two",
    ]);

    // --- Proof the *other process* actually persisted what it received:
    // reopen the exact SQLite file the child process wrote to, from this
    // test process, after the child machinery has had a moment to finish
    // its own `metadataRepository.save()` calls. ---
    await waitFor(async () => {
      const verifyRepository = new SqliteMetadataRepository({ filePath: nodeDbPath });
      try {
        const persisted = await verifyRepository.listAll();
        return persisted.map((item) => item.contentHash).sort();
      } finally {
        verifyRepository.close();
      }
    }, ["e2e-piece-one", "e2e-piece-two"]);
  });
});

/** Poll `check` until it resolves to `expected` (deep-equal) or a bounded number of attempts is exhausted — the swap's own completion is awaited above; this only accounts for the other process's fire-and-forget `libraryService.adoptLibrary`/final log flush having a moment to settle. */
async function waitFor<T>(check: () => Promise<T>, expected: T, attempts = 20): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const actual = await check();
    if (JSON.stringify(actual) === JSON.stringify(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const finalActual = await check();
  expect(finalActual).toEqual(expected);
}
