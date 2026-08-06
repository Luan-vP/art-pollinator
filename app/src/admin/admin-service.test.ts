import { describe, expect, it } from "vitest";
import {
  InMemoryClockPort,
  InMemoryIdentityPort,
  InMemoryMetadataRepositoryPort,
  InMemoryRevocationLogPort,
  InMemorySecurityStatusPort,
  type MetadataToken,
} from "@art-pollinator/core";
import { LibraryService } from "../library/library-service.js";
import { AdminService } from "./admin-service.js";

function token(contentHash: string, overrides: Partial<MetadataToken> = {}): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "d",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
    ...overrides,
  };
}

async function makeLibraryService(tokens: readonly MetadataToken[] = []): Promise<LibraryService> {
  const repository = new InMemoryMetadataRepositoryPort();
  for (const t of tokens) await repository.save(t);
  return LibraryService.create(repository);
}

describe("AdminService (issue #50 — node operator experience)", () => {
  it("getLibrarySnapshot reports item counts and current capacity", async () => {
    const libraryService = await makeLibraryService([token("a"), token("b")]);
    libraryService.lock("a");
    const admin = new AdminService({
      libraryService,
      revocationLog: new InMemoryRevocationLogPort(),
      identity: new InMemoryIdentityPort("node-1"),
      clock: new InMemoryClockPort(0),
      maxTotalSlots: 2_000,
    });

    const snapshot = admin.getLibrarySnapshot();
    expect(snapshot.totalItems).toBe(2);
    expect(snapshot.lockedItems).toBe(1);
    expect(snapshot.swappableItems).toBe(1);
    expect(snapshot.capacity).toEqual({ maxLockableSlots: 5, swappableSlots: 5 });
  });

  it("listLibraryEntries returns a flat, readable view of every held item", async () => {
    const libraryService = await makeLibraryService([token("a", { title: "Alpha" })]);
    const admin = new AdminService({
      libraryService,
      revocationLog: new InMemoryRevocationLogPort(),
      identity: new InMemoryIdentityPort("node-1"),
      clock: new InMemoryClockPort(0),
      maxTotalSlots: 2_000,
    });
    const entries = admin.listLibraryEntries();
    expect(entries).toEqual([
      { contentHash: "a", title: "Alpha", creator: "Someone", locked: false, hopCount: 0 },
    ]);
  });

  it("setCapacity accepts a valid change and applies it to LibraryService immediately", async () => {
    const libraryService = LibraryService.createEmpty(new InMemoryMetadataRepositoryPort());
    const admin = new AdminService({
      libraryService,
      revocationLog: new InMemoryRevocationLogPort(),
      identity: new InMemoryIdentityPort("node-1"),
      clock: new InMemoryClockPort(0),
      maxTotalSlots: 2_000,
    });

    const result = admin.setCapacity({ maxLockableSlots: 10, swappableSlots: 190 });
    expect(result).toEqual({ ok: true });
    expect(libraryService.getCapacity()).toEqual({ maxLockableSlots: 10, swappableSlots: 190 });
  });

  it("setCapacity rejects a change exceeding maxTotalSlots, leaving the current capacity untouched", async () => {
    const libraryService = LibraryService.createEmpty(new InMemoryMetadataRepositoryPort());
    const admin = new AdminService({
      libraryService,
      revocationLog: new InMemoryRevocationLogPort(),
      identity: new InMemoryIdentityPort("node-1"),
      clock: new InMemoryClockPort(0),
      maxTotalSlots: 100,
    });
    const before = libraryService.getCapacity();

    const result = admin.setCapacity({ maxLockableSlots: 50, swappableSlots: 100 });
    expect(result.ok).toBe(false);
    expect(libraryService.getCapacity()).toEqual(before);
  });

  it("getSecurityStatus surfaces the wired SecurityStatusPort's snapshot", () => {
    const libraryService = LibraryService.createEmpty(new InMemoryMetadataRepositoryPort());
    const securityStatus = new InMemorySecurityStatusPort({
      activeConnections: 3,
      authenticatedPeerCount: 2,
      rateLimitRejectionCount: 1,
      authFailureCount: 0,
      tlsEnabled: true,
    });
    const admin = new AdminService({
      libraryService,
      revocationLog: new InMemoryRevocationLogPort(),
      identity: new InMemoryIdentityPort("node-1"),
      clock: new InMemoryClockPort(0),
      maxTotalSlots: 2_000,
      securityStatus,
    });
    expect(admin.getSecurityStatus()).toEqual({
      activeConnections: 3,
      authenticatedPeerCount: 2,
      rateLimitRejectionCount: 1,
      authFailureCount: 0,
      tlsEnabled: true,
    });
  });

  it("getSecurityStatus returns undefined when no SecurityStatusPort is wired", () => {
    const libraryService = LibraryService.createEmpty(new InMemoryMetadataRepositoryPort());
    const admin = new AdminService({
      libraryService,
      revocationLog: new InMemoryRevocationLogPort(),
      identity: new InMemoryIdentityPort("node-1"),
      clock: new InMemoryClockPort(0),
      maxTotalSlots: 2_000,
    });
    expect(admin.getSecurityStatus()).toBeUndefined();
  });

  it("revokeContent signs and records a revocation, and removes the item from the library immediately", async () => {
    const libraryService = await makeLibraryService([token("hash-1")]);
    const revocationLog = new InMemoryRevocationLogPort();
    const clock = new InMemoryClockPort(1_000);
    const admin = new AdminService({
      libraryService,
      revocationLog,
      identity: new InMemoryIdentityPort("node-1"),
      clock,
      maxTotalSlots: 2_000,
    });

    const entry = await admin.revokeContent("hash-1");
    expect(entry.contentHash).toBe("hash-1");
    expect(entry.revokedAtEpochMs).toBe(1_000);
    expect(entry.signature).not.toBe("");

    expect(libraryService.getLibrary().entries.has("hash-1")).toBe(false);
    expect(await revocationLog.has("hash-1")).toBe(true);
    expect(await admin.listRevocations()).toEqual([entry]);
  });

  it("revokeContent still records the revocation even if this node never held the content", async () => {
    const libraryService = LibraryService.createEmpty(new InMemoryMetadataRepositoryPort());
    const revocationLog = new InMemoryRevocationLogPort();
    const admin = new AdminService({
      libraryService,
      revocationLog,
      identity: new InMemoryIdentityPort("node-1"),
      clock: new InMemoryClockPort(0),
      maxTotalSlots: 2_000,
    });

    await admin.revokeContent("never-held");
    expect(await revocationLog.has("never-held")).toBe(true);
  });
});
