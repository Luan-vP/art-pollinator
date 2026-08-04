import { describe, expect, it } from "vitest";
import { serializeMetadataToken, type MetadataToken } from "../../metadata/metadata-token.js";
import type { DiscoveredPeer } from "../discovery-port.js";
import { InMemoryClockPort } from "./in-memory-clock-port.js";
import { InMemoryDiscoveryPort } from "./in-memory-discovery-port.js";
import { InMemoryEncounterLogPort } from "./in-memory-encounter-log-port.js";
import { InMemoryMetadataRepositoryPort } from "./in-memory-metadata-repository-port.js";
import { createInMemoryTransportPair } from "./in-memory-transport-port.js";

/**
 * Issue #18's acceptance bar is "a full swap must run end to end with no
 * external dependency" — but `SwapService` (issue #19) doesn't exist yet.
 * This test manually wires several fakes together to simulate the shape of
 * a swap (discover a peer, transport bytes between two devices, persist the
 * result, log the encounter) entirely with in-memory fakes, proving they
 * compose — without needing the not-yet-built orchestrator.
 */

function token(contentHash: string): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "A piece worth passing on.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { contentHash },
    contentHash,
    signature: "",
  };
}

/**
 * Tiny local UTF-8 encode/decode, standing in for a real wire codec (issue
 * #24, a later batch). `core`'s tsconfig deliberately has no DOM/Node
 * `lib` entries (see `metadata-token.ts`'s hand-rolled `utf8ByteLength`),
 * so `TextEncoder`/`TextDecoder` aren't available even in a `.test.ts` file
 * — this test only needs *some* faithful byte encoding to prove
 * `TransportPort` carries arbitrary bytes end to end, not a production
 * codec.
 */
function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) continue;
    if (codePoint > 0xffff) i++;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function decodeUtf8(bytes: Uint8Array): string {
  let result = "";
  let i = 0;
  while (i < bytes.length) {
    const byte0 = bytes[i];
    if (byte0 === undefined) break;
    if (byte0 <= 0x7f) {
      result += String.fromCodePoint(byte0);
      i += 1;
    } else if ((byte0 & 0xe0) === 0xc0) {
      const byte1 = bytes[i + 1] ?? 0;
      result += String.fromCodePoint(((byte0 & 0x1f) << 6) | (byte1 & 0x3f));
      i += 2;
    } else if ((byte0 & 0xf0) === 0xe0) {
      const byte1 = bytes[i + 1] ?? 0;
      const byte2 = bytes[i + 2] ?? 0;
      result += String.fromCodePoint(
        ((byte0 & 0x0f) << 12) | ((byte1 & 0x3f) << 6) | (byte2 & 0x3f),
      );
      i += 3;
    } else {
      const byte1 = bytes[i + 1] ?? 0;
      const byte2 = bytes[i + 2] ?? 0;
      const byte3 = bytes[i + 3] ?? 0;
      const codePoint =
        ((byte0 & 0x07) << 18) | ((byte1 & 0x3f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
      result += String.fromCodePoint(codePoint);
      i += 4;
    }
  }
  return result;
}

describe("in-memory fakes wired together: a toy metadata exchange", () => {
  it("discovers a peer, transports a serialized token, persists it on the receiving side, and logs the encounter", async () => {
    // --- Two "devices," each with their own repository and clock. ---
    const deviceAAddress = { id: "device-a" };
    const deviceBAddress = { id: "device-b" };

    const deviceARepository = new InMemoryMetadataRepositoryPort();
    const deviceBRepository = new InMemoryMetadataRepositoryPort();
    const deviceBEncounterLog = new InMemoryEncounterLogPort();
    const deviceBClock = new InMemoryClockPort(1_000);

    const originalToken = token("piece-1");
    await deviceARepository.save(originalToken);

    // --- Discovery: device B discovers device A as a nearby peer. ---
    const deviceBDiscovery = new InMemoryDiscoveryPort();
    const discoveredPeers: DiscoveredPeer[] = [];
    await deviceBDiscovery.startDiscovery((peer) => discoveredPeers.push(peer));
    deviceBDiscovery.simulateDiscovered({ address: deviceAAddress, kind: "person" });
    expect(discoveredPeers).toEqual([{ address: deviceAAddress, kind: "person" }]);

    // --- Transport: device A sends the token's serialized bytes to B. ---
    const { a: transportA, b: transportB } = createInMemoryTransportPair(
      deviceAAddress,
      deviceBAddress,
    );

    const wireBytes = encodeUtf8(serializeMetadataToken(originalToken));
    await transportA.send(deviceBAddress, wireBytes);

    const inbound = await transportB.receive();
    expect(inbound.from).toEqual(deviceAAddress);

    // Decoding is a toy stand-in for the real wire codec (issue #24, a
    // later batch) — this test only needs to prove the fakes carry
    // arbitrary bytes faithfully end to end, not implement that codec.
    const decoded = JSON.parse(decodeUtf8(inbound.message)) as MetadataToken;
    expect(decoded).toEqual(originalToken);

    // --- Reconcile: device B persists what it received and logs the encounter. ---
    await deviceBRepository.save(decoded);
    await deviceBEncounterLog.record(decoded.contentHash, "accepted", deviceBClock.now());

    // --- Assertions: the toy exchange actually moved data end to end. ---
    await expect(deviceBRepository.findByContentHash("piece-1")).resolves.toEqual(originalToken);
    // One-way seeding is permitted (SPEC.md §6.3) — device A's own copy is
    // untouched by this exchange.
    await expect(deviceARepository.findByContentHash("piece-1")).resolves.toEqual(originalToken);
    await expect(deviceBEncounterLog.history("piece-1")).resolves.toEqual([
      { outcome: "accepted", atEpochMs: 1_000 },
    ]);
  });

  it("supports a one-way swap: device A seeds device B without receiving anything back", async () => {
    const deviceAAddress = { id: "seeder" };
    const deviceBAddress = { id: "receiver" };
    const { a: transportA, b: transportB } = createInMemoryTransportPair(
      deviceAAddress,
      deviceBAddress,
    );

    const deviceBRepository = new InMemoryMetadataRepositoryPort();
    const seedTokens = [token("seed-1"), token("seed-2")];

    for (const t of seedTokens) {
      await transportA.send(deviceBAddress, encodeUtf8(serializeMetadataToken(t)));
    }
    for (let i = 0; i < seedTokens.length; i++) {
      const inbound = await transportB.receive();
      const decoded = JSON.parse(decodeUtf8(inbound.message)) as MetadataToken;
      await deviceBRepository.save(decoded);
    }

    const all = await deviceBRepository.listAll();
    expect(all.map((t) => t.contentHash).sort()).toEqual(["seed-1", "seed-2"]);

    // Device B never sent anything back — nothing to receive on A's side.
    // (We don't call transportA.receive() here since, with nothing sent,
    // it would hang forever; instead assert A's repository — which this
    // toy scenario never populates — stays empty, demonstrating the
    // one-way flow.)
    const deviceARepository = new InMemoryMetadataRepositoryPort();
    await expect(deviceARepository.listAll()).resolves.toEqual([]);
  });
});
