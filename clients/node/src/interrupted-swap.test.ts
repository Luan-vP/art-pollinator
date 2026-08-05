/**
 * Interrupted-swap handling (issue #47): an abrupt mid-swap disconnect must
 * leave no partial/corrupt library or repository state, and the swap state
 * machine must land in a defined aborted state rather than hanging forever.
 *
 * Real components throughout — a real `HttpTransportServer` (the node
 * side, force-closed mid-negotiation to simulate the drop) and a real
 * `HttpTransportClient` talking to it over an actual loopback socket, a
 * real `SqliteMetadataRepository` (`:memory:`) whose contents this test
 * inspects directly afterwards, and the real `SwapService` from `app`
 * (unmodified except for this batch's own `receiveWithTimeout`/
 * `SwapAbortedError` additions — see `app/src/swap/swap-service.ts`'s doc
 * comment). Nothing here is a fake standing in for the failure.
 *
 * ## Why the disconnect can only ever land before any repository write
 *
 * `SwapService.swap()` only calls `metadataRepository.save()` after BOTH
 * negotiation round trips (`offer`, then `accept`) have fully resolved —
 * every network call happens strictly before that loop starts, and no
 * further network call happens after it (see `swap-service.ts`'s own doc
 * comment). This test forces the drop during the very first round trip
 * (after the client's `offer` has demonstrably reached the server, before
 * the server ever replies), which is the realistic "connection drops
 * mid-transfer" scenario — and proves the repository is left completely
 * untouched as a direct consequence of that ordering, not by any special
 * rollback logic.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_LIBRARY_CAPACITY,
  InMemoryClockPort,
  InMemoryEncounterLogPort,
  addItem,
  naiveAcceptPolicy,
  naiveEvictionPolicy,
  naiveOfferPolicy,
  toPriority,
  type DiscoveredPeer,
  type Library,
  type MetadataToken,
} from "@art-pollinator/core";
import { SwapAbortedError, SwapService } from "@art-pollinator/app";
import { HttpTransportClient, HttpTransportServer } from "@art-pollinator/transport-http";
import { SqliteMetadataRepository } from "@art-pollinator/metadata-repository-sqlite";

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

function buildLibrary(hashes: readonly string[]): Library {
  let library: Library = { entries: new Map() };
  for (const hash of hashes) {
    const result = addItem(library, token(hash), toPriority(0), DEFAULT_LIBRARY_CAPACITY);
    if (!result.ok) throw new Error(`fixture setup failed: ${result.error}`);
    library = result.library;
  }
  return library;
}

let dbDir: string | undefined;
let server: HttpTransportServer | undefined;

afterEach(async () => {
  if (server) {
    await server.close().catch(() => undefined);
    server = undefined;
  }
  if (dbDir) {
    rmSync(dbDir, { recursive: true, force: true });
    dbDir = undefined;
  }
});

describe("interrupted swap (issue #47): the peer's connection drops mid-negotiation", () => {
  it("aborts into a defined { phase: 'aborted' } state instead of hanging forever, with no repository write and an unchanged library", async () => {
    // --- A real node-side HttpTransportServer, playing "the peer that vanishes." ---
    const nodeTransport = new HttpTransportServer({ longPollTimeoutMs: 5_000 });
    server = nodeTransport;
    const { baseUrl } = await nodeTransport.listen(0, "127.0.0.1");

    // --- The device under test: a real SqliteMetadataRepository we can
    // inspect afterwards, proving no half-written token landed in it. ---
    dbDir = mkdtempSync(join(tmpdir(), "art-pollinator-interrupted-swap-"));
    const metadataRepository = new SqliteMetadataRepository({
      filePath: join(dbDir, "library.sqlite3"),
    });

    const clientLibrary = buildLibrary(["alpha", "beta"]);
    const clientTransport = new HttpTransportClient({ selfAddress: { id: "device-under-test" } });

    const swapService = new SwapService({
      transport: clientTransport,
      metadataRepository,
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: naiveOfferPolicy,
      acceptPolicy: naiveAcceptPolicy,
      evictionPolicy: naiveEvictionPolicy,
      // Short on purpose: this test simulates the peer vanishing, so it
      // should not have to wait anywhere near a production timeout to
      // observe the resulting abort.
      receiveTimeoutMs: 300,
    });

    const nodePeer: DiscoveredPeer = { address: { id: baseUrl }, kind: "node" };

    const swapPromise = swapService.swap(nodePeer, clientLibrary);

    // Confirm the client's offer genuinely reached the server (the
    // "mid-transfer" part of "connection drops mid-transfer") before
    // killing it — this is not a drop before anything was ever sent.
    const receivedOnServer = await nodeTransport.receive();
    expect(receivedOnServer.from).toEqual({ id: "device-under-test" });

    // Simulate an abrupt disconnect: the server vanishes without ever
    // replying. `closeAllConnections()` (inside `close()`) forcibly ends
    // the TCP connection carrying the client's in-flight long-poll, the
    // real-world shape of "the peer's connection drops."
    await nodeTransport.close();
    server = undefined;

    // The swap must settle (not hang) within the configured timeout, and
    // must do so via a defined aborted state, not a bare rejected promise.
    await expect(swapPromise).rejects.toBeInstanceOf(SwapAbortedError);
    const error = await swapPromise.catch((e: unknown) => e as SwapAbortedError);
    expect(error.state.phase).toBe("aborted");
    if (error.state.phase === "aborted") {
      expect(error.state.reason).toMatch(/timed out|disconnected/i);
    }

    // No partial/corrupt repository state: the drop happened before the
    // negotiation round trip ever completed, so `metadataRepository.save()`
    // was never called for anything.
    const persisted = await metadataRepository.listAll();
    expect(persisted).toEqual([]);
    metadataRepository.close();

    // The library passed in is untouched — `Library` is an immutable
    // value and `swap()` never mutates its input, aborted or not.
    expect(clientLibrary.entries.size).toBe(2);
    expect([...clientLibrary.entries.keys()].sort()).toEqual(["alpha", "beta"]);
  });

  it("a second swap attempt against a healthy peer succeeds afterwards — the device is left in a fully recoverable state", async () => {
    // Proves the aborted attempt didn't leave the client's own SwapService/
    // repository/library in some wedged state that would prevent a later,
    // successful swap — "recoverable," not just "doesn't crash."
    const deadServer = new HttpTransportServer({ longPollTimeoutMs: 5_000 });
    const { baseUrl: deadBaseUrl } = await deadServer.listen(0, "127.0.0.1");

    dbDir = mkdtempSync(join(tmpdir(), "art-pollinator-interrupted-swap-recovery-"));
    // The SAME repository is reused across both attempts below — that's
    // exactly the state issue #47 cares about being left clean/recoverable.
    const metadataRepository = new SqliteMetadataRepository({
      filePath: join(dbDir, "library.sqlite3"),
    });

    function newSwapService(transport: HttpTransportClient | HttpTransportServer): SwapService {
      return new SwapService({
        transport,
        metadataRepository,
        encounterLog: new InMemoryEncounterLogPort(),
        clock: new InMemoryClockPort(0),
        offerPolicy: naiveOfferPolicy,
        acceptPolicy: naiveAcceptPolicy,
        evictionPolicy: naiveEvictionPolicy,
        receiveTimeoutMs: 300,
      });
    }

    let library = buildLibrary(["alpha"]);

    // --- Attempt 1: interrupted, as above. ---
    const firstAttemptTransport = new HttpTransportClient({
      selfAddress: { id: "device-under-test" },
    });
    const firstAttempt = newSwapService(firstAttemptTransport).swap(
      { address: { id: deadBaseUrl }, kind: "node" },
      library,
    );
    await deadServer.receive();
    await deadServer.close();
    await expect(firstAttempt).rejects.toBeInstanceOf(SwapAbortedError);

    // --- Attempt 2: a real, healthy peer, over a *fresh*
    // `HttpTransportClient` instance. `SwapService.swap()`'s own
    // doc comment discloses why: `HttpTransportClient`/`HttpTransportServer`
    // aggregate "the next message from any connected peer" through one
    // shared, peer-unscoped delivery queue, and `TransportPort` has no
    // cancellation primitive to retract attempt 1's abandoned `receive()`
    // call from it — reusing the exact same transport *instance*
    // immediately afterwards risks a healthy peer's very next message being
    // misdelivered to that stale call. A fresh transport instance per
    // *connection attempt* is exactly what a real composition root already
    // does for every newly-discovered peer (`HttpTransportClient` is
    // logically "this device's dial-out capability," not "a single
    // permanent wire to one specific peer"), and is what this test does too
    // — the repository (this device's actual persisted state) is what
    // carries over between attempts, proving the recovery issue #47 cares
    // about: the *device*, not one specific socket, is left clean and
    // usable. ---
    const healthyServer = new HttpTransportServer({ longPollTimeoutMs: 5_000 });
    server = healthyServer;
    const { baseUrl: healthyBaseUrl } = await healthyServer.listen(0, "127.0.0.1");
    const healthyPeerRepository = new SqliteMetadataRepository({
      filePath: join(dbDir, "healthy-peer.sqlite3"),
    });
    const healthyService = new SwapService({
      // The "healthy peer" side of this exchange is the server itself —
      // `HttpTransportServer` implements `TransportPort` directly, so it
      // can be a real swap participant, not just a listener.
      transport: healthyServer,
      metadataRepository: healthyPeerRepository,
      encounterLog: new InMemoryEncounterLogPort(),
      clock: new InMemoryClockPort(0),
      offerPolicy: naiveOfferPolicy,
      acceptPolicy: naiveAcceptPolicy,
      evictionPolicy: naiveEvictionPolicy,
    });

    const secondAttemptTransport = new HttpTransportClient({
      selfAddress: { id: "device-under-test" },
    });
    const [outcomeUnderTest] = await Promise.all([
      newSwapService(secondAttemptTransport).swap(
        { address: { id: healthyBaseUrl }, kind: "node" },
        library,
      ),
      healthyService.swap(
        { address: { id: "device-under-test" }, kind: "person" },
        { entries: new Map() },
      ),
    ]);
    healthyPeerRepository.close();

    expect(outcomeUnderTest.state.phase).toBe("completed");
    library = outcomeUnderTest.library;
    expect(library.entries.has("alpha")).toBe(true);

    metadataRepository.close();
  });
});
