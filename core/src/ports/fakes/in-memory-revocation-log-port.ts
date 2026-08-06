/**
 * InMemoryRevocationLogPort — the in-memory fake for `RevocationLogPort`
 * (issue #51). Every port ships with one (AGENTS.md §2 rule 4); this is the
 * one every existing test and the mobile composition root use, and what the
 * node composition root uses too pending a persistent adapter (see
 * `clients/node/src/composition/composition-root.ts`'s doc comment, which
 * already discloses the identical gap for `EncounterLogPort`).
 */
import type { RevocationEntry } from "../../security/revocation.js";
import type { RevocationLogPort } from "../revocation-log-port.js";

export class InMemoryRevocationLogPort implements RevocationLogPort {
  private readonly entries = new Map<string, RevocationEntry>();

  record(entry: RevocationEntry): Promise<void> {
    if (!this.entries.has(entry.contentHash)) {
      this.entries.set(entry.contentHash, entry);
    }
    return Promise.resolve();
  }

  has(contentHash: string): Promise<boolean> {
    return Promise.resolve(this.entries.has(contentHash));
  }

  listAll(): Promise<readonly RevocationEntry[]> {
    return Promise.resolve([...this.entries.values()]);
  }
}
