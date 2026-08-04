/**
 * EncounterLogPort — what has been offered, declined, accepted, or evicted.
 *
 * SPEC.md §6.4: "Encounter memory is item-scoped, not peer-scoped — it
 * remembers pieces by content hash, not who offered them." This is
 * required because people use rotating ephemeral identities (SPEC.md §7);
 * "I already declined this person" is unrepresentable, so the log is keyed
 * by content hash throughout, never by peer. Full behaviour (retention
 * windows, re-offer suppression policy) is issue #20, a later batch — this
 * is just the shape.
 */

export type EncounterOutcome = "offered" | "accepted" | "declined" | "evicted";

export interface EncounterLogPort {
  /** Record an outcome for an item, identified by content hash, at a given time (epoch ms — see `ClockPort`). */
  record(contentHash: string, outcome: EncounterOutcome, atEpochMs: number): Promise<void>;

  /** All recorded outcomes for a given item, oldest first. */
  history(
    contentHash: string,
  ): Promise<readonly { readonly outcome: EncounterOutcome; readonly atEpochMs: number }[]>;
}
