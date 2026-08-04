/**
 * InMemoryEncounterLogPort — an `EncounterLogPort` fake backed by a plain
 * `Map` from content hash to its outcome history. Item-scoped throughout
 * (SPEC.md §6.4), never peer-scoped. Zero I/O (issue #18, IMPLEMENTATION.md
 * Phase 1a item 18).
 */
import type { EncounterLogPort, EncounterOutcome } from "../encounter-log-port.js";

interface RecordedOutcome {
  readonly outcome: EncounterOutcome;
  readonly atEpochMs: number;
}

export class InMemoryEncounterLogPort implements EncounterLogPort {
  private readonly byContentHash = new Map<string, RecordedOutcome[]>();

  record(contentHash: string, outcome: EncounterOutcome, atEpochMs: number): Promise<void> {
    const existing = this.byContentHash.get(contentHash) ?? [];
    existing.push({ outcome, atEpochMs });
    this.byContentHash.set(contentHash, existing);
    return Promise.resolve();
  }

  history(contentHash: string): Promise<readonly RecordedOutcome[]> {
    const existing = this.byContentHash.get(contentHash) ?? [];
    // Defensively sort oldest-first rather than relying solely on insertion
    // order, in case a caller records outcomes out of chronological order.
    const sorted = [...existing].sort((a, b) => a.atEpochMs - b.atEpochMs);
    return Promise.resolve(sorted);
  }
}
