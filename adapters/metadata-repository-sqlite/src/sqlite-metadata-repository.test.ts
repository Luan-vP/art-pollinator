import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { metadataRepositoryContractCases, type MetadataToken } from "@art-pollinator/core";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteMetadataRepository } from "./sqlite-metadata-repository.js";

function token(contentHash: string): MetadataToken {
  return {
    title: `Piece ${contentHash}`,
    creator: "Someone",
    description: "A piece.",
    provenance: { hopCount: 0 },
    contentType: "image/jpeg",
    blobPointer: { contentHash },
    contentHash,
    signature: "",
  };
}

describe("SqliteMetadataRepository", () => {
  let dir: string;
  let fileCounter = 0;
  const openRepos: SqliteMetadataRepository[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "art-pollinator-sqlite-repo-"));
    fileCounter = 0;
  });

  afterEach(() => {
    for (const repo of openRepos.splice(0)) {
      repo.close();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function freshFilePath(): string {
    fileCounter += 1;
    return join(dir, `db-${String(fileCounter)}.sqlite`);
  }

  function openFresh(): SqliteMetadataRepository {
    const repo = new SqliteMetadataRepository({ filePath: freshFilePath() });
    openRepos.push(repo);
    return repo;
  }

  // Issue #26: the exact same contract suite the in-memory fake passes
  // (core/src/ports/metadata-repository-contract-suite.test.ts), run here
  // against the real SQLite adapter — the actual proof of interchangeability,
  // not just structural similarity.
  describe("contract suite (issue #26) — identical to the in-memory fake", () => {
    const cases = metadataRepositoryContractCases(() => openFresh());
    for (const contractCase of cases) {
      it(contractCase.name, contractCase.run);
    }
  });

  describe("persistence across process restart (issue #25)", () => {
    it("data written by one instance is readable by a fresh instance opened against the same file path", async () => {
      const filePath = freshFilePath();

      const first = new SqliteMetadataRepository({ filePath });
      await first.save(token("survives-restart"));
      first.close(); // simulates the process ending — no shared in-memory state left behind

      // A brand-new instance, as a fresh process would create on startup,
      // pointed at the same on-disk file.
      const second = new SqliteMetadataRepository({ filePath });
      openRepos.push(second);
      await expect(second.findByContentHash("survives-restart")).resolves.toEqual(
        token("survives-restart"),
      );
    });

    it("multiple tokens and a subsequent delete both survive a restart", async () => {
      const filePath = freshFilePath();

      const first = new SqliteMetadataRepository({ filePath });
      await first.save(token("a"));
      await first.save(token("b"));
      await first.delete("a");
      first.close();

      const second = new SqliteMetadataRepository({ filePath });
      openRepos.push(second);
      const all = await second.listAll();
      expect(all.map((t) => t.contentHash)).toEqual(["b"]);
    });

    it("re-opening the same file path twice in a row is itself a no-op migration (idempotent open)", async () => {
      const filePath = freshFilePath();
      const first = new SqliteMetadataRepository({ filePath });
      await first.save(token("x"));
      first.close();

      // Opening again should not fail, wipe data, or re-run migrations
      // destructively.
      const second = new SqliteMetadataRepository({ filePath });
      openRepos.push(second);
      await expect(second.findByContentHash("x")).resolves.toEqual(token("x"));

      const third = new SqliteMetadataRepository({ filePath });
      openRepos.push(third);
      await expect(third.findByContentHash("x")).resolves.toEqual(token("x"));
    });
  });

  afterAll(() => {
    // Best-effort: individual afterEach already closes/removes everything;
    // this guards against a future test that forgets to register its repo.
    for (const repo of openRepos.splice(0)) {
      try {
        repo.close();
      } catch {
        // already closed
      }
    }
  });
});
