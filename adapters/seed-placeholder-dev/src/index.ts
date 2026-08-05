/**
 * `@art-pollinator/seed-placeholder-dev` — dev-only placeholder library seed
 * data (issue #42). Deletable without touching `core`: nothing in `core`
 * imports this package, and everything it exports is either pure static
 * data (`PLACEHOLDER_METADATA_TOKENS`) or a pure predicate
 * (`isPlaceholderSeedEnabled`) that a composition root calls, never the
 * reverse. See `./placeholder-seed-gate.ts` and `./placeholder-tokens.ts`
 * for the full reasoning, and this package's README for how a composition
 * root wires the gate.
 */
export * from "./placeholder-seed-gate.js";
export * from "./placeholder-tokens.js";
