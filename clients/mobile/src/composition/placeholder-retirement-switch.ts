/**
 * PLACEHOLDER_CONTENT_RETIRED — the retirement switch for issue #56
 * (IMPLEMENTATION.md Phase 3, item 56: "Retire placeholder content — seed
 * adapter removed; no scraped work in any shipped build").
 *
 * ## What flipping this switch means, mechanically
 *
 * This constant, by itself, changes nothing at runtime — the composition
 * root's own placeholder-seed gate
 * (`@art-pollinator/seed-placeholder-dev`'s `isPlaceholderSeedEnabled`)
 * already defaults off and is unaffected by this file either way. What this
 * switch actually gates is `scripts/retire-placeholder-content.mjs`
 * (repo root): that script refuses to run (exits non-zero, touches nothing)
 * unless it finds this exact constant set to `true` in the copy of this
 * file it is pointed at. When it *is* `true`, running that script performs
 * a real, structural removal — it deletes every import of
 * `@art-pollinator/seed-placeholder-dev`, the two placeholder-seed
 * functions in `./composition-root-shared.ts`, their call sites in
 * `./composition-root.native.ts`/`./composition-root.web.ts`, and the
 * `@art-pollinator/seed-placeholder-dev` entry from `package.json`'s
 * `dependencies` — genuinely cutting the placeholder-seed adapter out of
 * this client's dependency graph, not merely leaving it present-but-inert.
 * `scripts/check-placeholder-retirement.mjs` independently verifies that
 * removal is real (statically scans for the import specifier and the
 * `package.json` dependency entry, the same "reachable in the dependency
 * graph" check `scripts/check-web-bundle-native-imports.mjs` uses for
 * native-only imports leaking into the web bundle). See
 * `scripts/test-placeholder-retirement.mjs` for the test proving all of
 * this — both that flipping the switch to `false` (the default) leaves
 * every file untouched, and that flipping it to `true` and running the
 * script produces a genuinely reference-free result.
 *
 * ## ⚠️ Do NOT set this to `true` in this repository's real source
 *
 * SPEC.md §10 / §11 open question 5 and AGENTS.md §3 are explicit: the
 * rights and consent model gates Phase 3, is not an engineering decision,
 * and is not resolved by this batch — see
 * `docs/rights/consent-model-DRAFT.md`, delivered as a draft proposal for a
 * real artist/venue conversation, not a shipped policy. Flipping this
 * switch and running the retirement script only cuts the *placeholder dev
 * fixture* out of the build; it does not, by itself, constitute or replace
 * that rights decision, and it must not be treated as a green light to wire
 * in real (non-placeholder, non-test) artist content either. This switch
 * stays `false` — the mechanism this batch delivers is proven to work
 * (`scripts/test-placeholder-retirement.mjs`), but is deliberately left
 * inactive, per this batch's own explicit instructions.
 */
export const PLACEHOLDER_CONTENT_RETIRED = false as const;
