/**
 * PLACEHOLDER_METADATA_TOKENS — synthetic, obviously-fake `MetadataToken`s
 * for local development only (issue #42, IMPLEMENTATION.md Phase 1b item
 * 42).
 *
 * ⚠️ **These are NOT real artwork, NOT scraped, and NOT sourced from any
 * third party.** AGENTS.md §3 / SPEC.md §10: "Scraped third-party artwork
 * is permitted only as a local development fixture. It must never reach a
 * public node, a shipped build, or any environment where it circulates to
 * real users." Every title, creator, and description below is invented
 * specifically to be unmistakably placeholder ("Untitled Study", "Field
 * Notes", "Placeholder Artist", "Studio Fixture Co.") — deliberately not
 * even plausible as a real artist's byline, so nobody could mistake this
 * for content requiring a rights/consent decision (SPEC.md §10's still-open
 * question, gating Phase 3). This sandbox also has no internet access to
 * scrape anything, and even if it did, AGENTS.md's hard boundary means this
 * would not be the place to do it.
 *
 * Each entry's `contentHash` is `sha256Hex` of its own placeholder text
 * (deterministic, so re-running this module always produces the same
 * fixture set — useful for tests) via `@art-pollinator/core`'s existing
 * hashing primitive, not a hand-picked string. `blobPointer` uses the
 * `"local-filesystem"` scheme (issue #39) but does not point at any real
 * file on disk — there is no backing image; a real blob fetch for these
 * hashes will simply find nothing (`BlobStorePort.get` returns `undefined`,
 * exactly the ordinary "not held locally, not yet fetched" case SPEC.md
 * §3.1 already models for a deferred blob). Signed with nothing
 * (`signature: ""`): placeholder fixtures have no identity to sign with,
 * matching `isTokenSigned`'s "unsigned" convention
 * (`@art-pollinator/core`'s `metadata-token.js`).
 */
import { sha256HexOfText, type MetadataToken } from "@art-pollinator/core";

function placeholderToken(input: {
  readonly title: string;
  readonly creator: string;
  readonly description: string;
  readonly contentType: string;
}): MetadataToken {
  const contentHash = sha256HexOfText(
    `art-pollinator-placeholder-fixture:${input.title}:${input.creator}`,
  );
  return {
    title: input.title,
    creator: input.creator,
    description: input.description,
    provenance: { hopCount: 0 },
    contentType: input.contentType,
    blobPointer: { scheme: "local-filesystem", contentHash },
    contentHash,
    signature: "",
  };
}

/**
 * A handful of unmistakably-synthetic placeholder tokens — enough to
 * exercise a library screen's layout (a few swappable items) without
 * exceeding `SWAPPABLE_SLOTS` on its own. Dev-only; gated by
 * {@link isPlaceholderSeedEnabled} — see `./placeholder-seed-gate.js`.
 */
export const PLACEHOLDER_METADATA_TOKENS: readonly MetadataToken[] = [
  placeholderToken({
    title: "Untitled Study #1",
    creator: "Placeholder Artist",
    description: "A synthetic development fixture — not a real artwork. See AGENTS.md §3.",
    contentType: "image/jpeg",
  }),
  placeholderToken({
    title: "Field Notes, Fictional Sketch",
    creator: "Studio Fixture Co.",
    description: "A synthetic development fixture — not a real artwork. See AGENTS.md §3.",
    contentType: "image/png",
  }),
  placeholderToken({
    title: "Sample Composition No. 7 (placeholder)",
    creator: "Dev Seed Collective",
    description: "A synthetic development fixture — not a real artwork. See AGENTS.md §3.",
    contentType: "audio/mpeg",
  }),
];
