# @art-pollinator/mobile

The React Native client — iOS, Android, and web from one codebase (SPEC.md
§8, IMPLEMENTATION.md #29). Built with **Expo**, chosen specifically for a
setup that supports `expo prebuild` and config plugins (Expo Go does not
support custom native modules, and the BLE adapter arriving in #33/#34
needs one), not the fully managed Expo Go workflow.

## Structure

```
clients/mobile/
  index.ts                          registerRootComponent entry
  src/
    App.tsx                         root component
    composition/
      types.ts                      ClientCapabilities / CompositionRoot contracts (platform-agnostic)
      composition-root.native.ts    iOS/Android composition root
      composition-root.web.ts       web composition root
      composition-root.test.ts      proves the two differ, and neither branches on Platform.OS/typeof window
      capabilities-context.tsx      the one seam that imports "./composition-root" without an extension
    screens/
      library-screen.tsx            the single scaffold screen (issue #29/#32)
```

## The platform-split mechanism (issue #30)

`capabilities-context.tsx` imports `./composition-root` with **no file
extension**. Metro resolves that specifier to `composition-root.web.ts`
when bundling for the `web` platform, and to `composition-root.native.ts`
for `ios`/`android` — by filename convention, at bundle time, with **no
`Platform.OS` or `typeof window` check anywhere in this codebase**
(AGENTS.md §2 rule 2). `composition-root.test.ts` asserts this directly:
it imports both files by their concrete names and greps their source for
`Platform.OS`/`typeof window` to prove the split stays file-based.

Because plain `tsc` has no native concept of Metro's platform-extension
resolution, `tsconfig.json` and `tsconfig.native.json` each set
[`moduleSuffixes`](https://www.typescriptlang.org/tsconfig#moduleSuffixes)
to simulate it — one resolves the web variant, the other the native variant
— and `npm run typecheck` runs both, so neither platform's composition root
goes unchecked.

## What's real vs. placeholder in this batch

| Capability                                    | Status                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web export (`npx expo export --platform web`) | **Real, builds successfully in this sandbox.** Verified end to end, see below.                                                                                                                                                                                                                                                                                                     |
| iOS/Android native builds                     | **Not producible here.** No Xcode, no Android SDK, no simulator/emulator, no physical device — this sandbox cannot run `expo run:ios`/`expo run:android` or produce a signed build. `.github/workflows/ci.yml`'s `build-ios`/`build-android` jobs remain honest placeholders (mirroring how issue #4's CI already handles this) until a real macOS/Android-SDK runner is wired up. |
| BLE transport/discovery adapters              | **Placeholder**, issues #33/#34 in a later batch. `composition-root.native.ts` documents exactly where to register them and links `docs/spikes/0028-background-ble-feasibility.md` / `docs/adr/0010-hybrid-foreground-first-ble-swap-model.md` for what they need to account for.                                                                                                  |
| HTTP transport / LAN discovery adapters       | **Placeholder**, issues #43/#44 in a later batch. Both platforms currently report `wifiNodeSwap: true` (the capability tier) with no adapter registered yet.                                                                                                                                                                                                                       |
| Capability-aware UI                           | **Real.** `library-screen.tsx` renders its BLE section only when `capabilities.ble` is true — absent on web, not disabled (SPEC.md §8, issue #32).                                                                                                                                                                                                                                 |

## Running it

From the repo root, after `npm ci`:

```bash
# Type-check both platform resolutions (web + native)
npm run typecheck --workspace=@art-pollinator/mobile

# Run the composition-root test suite
npm run test --workspace=@art-pollinator/mobile

# Build the web target — this is the one target this sandbox can actually
# produce and smoke-test.
cd clients/mobile
npx expo export --platform web
```

`EXPO_OFFLINE=1` is set in CI (and was needed in this sandbox) to stop the
Expo CLI's telemetry/update-check/compatibility-lookup calls to
`api.expo.dev`, which this environment's egress policy blocks. It has no
effect on the build output — only on whether the CLI tries to phone home
first.

There is no meaningful `npm run ios` / `npm run android` to run here — they
would start a dev server waiting for a simulator/device that does not
exist in this sandbox.

## The RN Web compatibility gate (issue #31)

`scripts/check-web-bundle-native-imports.mjs` scans the **built** web
bundle (`clients/mobile/dist` after `expo export --platform web`) for a
denylist of native-only package names and fails if any are found. This is
a post-build check rather than a source-import scanner because Metro can
successfully bundle a native-only package for web with **no build error at
all** — verified empirically: a temporary
`import { BleManager } from "react-native-ble-plx"` in `src/App.tsx`
built cleanly and the string `"react-native-ble-plx"` ended up verbatim in
the compiled bundle. See the PR description for the full before/after
transcript, and `scripts/fixtures/web-bundle-native-leak/` +
`scripts/test-web-bundle-native-imports.mjs` for the fast, offline,
re-runnable regression proof of the same thing.

## Why Expo, not a bare RN CLI project

`SPEC.md` §8 and `docs/adr/0002-react-native-three-targets.md` establish
React Native across three targets as the framework decision; this package
picks Expo as the concrete tooling on top of that, because:

- One command (`npx expo export --platform web`) produces a genuinely
  working, testable web build — the only target this sandbox can build and
  the one this batch had to prove actually works.
- Expo's config-plugin system means the eventual BLE native module (#33/#34)
  can be integrated via `expo prebuild` without hand-maintaining Xcode/Gradle
  project files — this is why the project is set up for a development build
  (`expo-dev-client` / `expo run:ios` / `expo run:android` / EAS build), not
  the Expo Go managed workflow, which cannot load custom native modules at
  all.
- iOS, Android, and web genuinely share one `App.tsx`/composition-root
  structure, matching ADR-0002's premise of one client codebase.
