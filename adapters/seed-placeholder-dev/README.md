# `@art-pollinator/seed-placeholder-dev`

Dev-only placeholder library seed data (issue #42, IMPLEMENTATION.md Phase 1b
item 42). Follows the same structural pattern as every other package under
`adapters/` (own `package.json`/`tsconfig.json`/`vitest.config.ts`,
discovered automatically by `scripts/run-adapter-tests.mjs`) even though it
does zero real I/O — it lives here rather than in `core` specifically
_because_ AGENTS.md §3 requires it to be trivially deletable without
touching `core`.

## ⚠️ Hard boundary (AGENTS.md §3 / SPEC.md §10)

> Scraped third-party artwork is permitted only as a local development
> fixture. It must never reach a public node, a shipped build, or any
> environment where it circulates to real users.

This package ships **no scraped or real artwork at all** — every token in
`PLACEHOLDER_METADATA_TOKENS` (`src/placeholder-tokens.ts`) is invented data
with a deliberately unmistakable title/creator ("Untitled Study #1" /
"Placeholder Artist", etc.). This sandbox has no internet access to scrape
anything regardless, and even with access, AGENTS.md's boundary means this
would not be the place to do it.

**A green test suite proving the gate below defaults to disabled does not,
by itself, prove artists' rights are respected** — it proves this one
mechanism (a boolean predicate) behaves as designed. Say so plainly, per
AGENTS.md §3's own instruction to flag this prominently rather than let a
passing CI run stand in for the actual judgement call.

## The gate: `isPlaceholderSeedEnabled`

```ts
isPlaceholderSeedEnabled({ isDevBuild, explicitOptIn }): boolean
```

`true` only when **both** inputs are `true`:

- **`isDevBuild`** — supplied by the composition root, derived from React
  Native's `__DEV__` global. Metro/Hermes sets this to `false` (and
  dead-code-strips the `true` branch) in every release build — a
  build-tool guarantee this package's own code does not need to enforce
  itself.
- **`explicitOptIn`** — supplied by the composition root, derived from
  reading an explicit env/build flag a normal build process never sets
  (e.g. `process.env.EXPO_PUBLIC_ENABLE_PLACEHOLDER_SEED === "true"`).

This function takes plain booleans, not a live read of `__DEV__` or
`process.env` itself — it stays a portable, fully-testable pure predicate
with no platform dependency of its own (see `src/placeholder-seed-gate.ts`'s
header comment for the full reasoning). `src/placeholder-seed-gate.test.ts`
exhaustively covers all four input combinations and confirms only
`(true, true)` is enabled — this is the "clear test proving the flag
defaults to disabled" issue #42's DoD asks for.

## How a composition root wires this

```ts
import {
  isPlaceholderSeedEnabled,
  PLACEHOLDER_METADATA_TOKENS,
} from "@art-pollinator/seed-placeholder-dev";

const enabled = isPlaceholderSeedEnabled({
  isDevBuild: typeof __DEV__ !== "undefined" && __DEV__,
  explicitOptIn: process.env.EXPO_PUBLIC_ENABLE_PLACEHOLDER_SEED === "true",
});

if (enabled) {
  for (const token of PLACEHOLDER_METADATA_TOKENS) {
    await libraryService.add(token);
  }
}
```

See `clients/mobile/src/composition/composition-root.native.ts` /
`composition-root.web.ts` for the real wiring, and
`clients/mobile/src/composition/composition-root.test.ts` for an
integration-level test confirming the composition root does not seed by
default (no env var set in the test environment).
