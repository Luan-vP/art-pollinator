/**
 * isPlaceholderSeedEnabled — the off-by-default gate for the placeholder
 * seed adapter (issue #42, AGENTS.md §3 "Placeholder content — hard
 * boundary"): "Scraped third-party artwork is permitted only as a local
 * development fixture. It must never reach a public node, a shipped build,
 * or any environment where it circulates to real users."
 *
 * ⚠️ **This flag decision carries weight beyond code** (AGENTS.md §3:
 * "Anything determining whether placeholder or scraped content reaches a
 * shipped build" must be flagged prominently in the PR description, not
 * buried — done here, and restated in this batch's PR description). A green
 * test suite proving this predicate defaults to `false` does not, by
 * itself, prove artists' rights are respected; it proves this one
 * mechanism behaves as designed. The actual placeholder tokens shipped
 * alongside this gate (`./placeholder-tokens.js`) are entirely synthetic —
 * invented titles/creators, never real scraped work — precisely so that
 * *even if* this gate were ever misconfigured, nothing real would leak.
 * That is a second, independent safeguard, not a substitute for the gate
 * itself working correctly.
 *
 * ## Design: two independently-required booleans, not one flag
 *
 * `isDevBuild` and `explicitOptIn` are supplied by the *caller*
 * (`clients/mobile`'s composition root), not read from any global or env
 * var inside this function — this package never imports React Native or
 * `process.env` directly, so it stays a plain, portable, fully-testable
 * module (the same "adapter has no platform dependency of its own" shape
 * `adapters/blob-store-filesystem` and `adapters/metadata-repository-sqlite`
 * already follow, just with *zero* I/O here instead of real filesystem
 * I/O — see this package's README).
 *
 * - **`isDevBuild`** — the composition root derives this from React
 *   Native's `__DEV__` global, which Metro/Hermes sets to `false` and
 *   dead-code-strips the `true` branch out of entirely in a release build
 *   — a *build-tool* guarantee, not something this package's own code can
 *   accidentally leave on. This is the mechanism issue #42's "cannot be
 *   enabled in a release build" DoD bullet rests on: `isDevBuild` being
 *   `false` in a release build isn't this package's promise to keep, it's
 *   Metro's.
 * - **`explicitOptIn`** — the composition root derives this from reading
 *   an explicit environment/build flag (e.g.
 *   `process.env.EXPO_PUBLIC_ENABLE_PLACEHOLDER_SEED === "true"`) that a
 *   normal build process never sets. Requiring *both* means a debug build
 *   someone happens to be running does not, by itself, silently seed
 *   placeholder content — a developer has to deliberately opt in on top of
 *   already being in a dev build.
 *
 * Both defaulting to unset/`false` is what "off by default" means here —
 * see this file's own test suite for the exhaustive truth table proving it.
 */
export interface PlaceholderSeedGateInputs {
  /** Derived from the build tool's own dev/release distinction (e.g. React Native's `__DEV__`). `false` in every release build, by construction of the build tool — not by this function's own logic. */
  readonly isDevBuild: boolean;
  /** Derived from an explicit environment/build flag a normal build process never sets. */
  readonly explicitOptIn: boolean;
}

/**
 * `true` only when BOTH `isDevBuild` and `explicitOptIn` are `true`. Every
 * other combination — including both being merely `undefined`/absent in
 * whatever the composition root passed — is `false`. This is the entire
 * gate; see this file's doc comment for why each input exists and where it
 * comes from.
 */
export function isPlaceholderSeedEnabled(inputs: PlaceholderSeedGateInputs): boolean {
  return inputs.isDevBuild === true && inputs.explicitOptIn === true;
}
