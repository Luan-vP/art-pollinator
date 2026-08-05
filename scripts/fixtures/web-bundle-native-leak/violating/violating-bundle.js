// FIXTURE — not a real Metro/Expo bundle. This file's shape (a minified-
// looking bundle chunk that requires a native-only package and references
// its exported symbol) mimics what scripts/check-web-bundle-native-imports.mjs
// actually found in a *real* `expo export --platform web` bundle when
// clients/mobile/src/App.tsx temporarily imported `react-native-ble-plx`
// during development of issue #31 (see the PR description for that
// original, real-build proof). This fixture exists so the same violation
// can be proven again quickly and offline by scripts/test-web-bundle-native-imports.mjs,
// without re-running a full Expo export on every change to the checker.
(function () {
  var BleManager = require("react-native-ble-plx").BleManager;
  var manager = new BleManager();
  module.exports = { manager: manager };
})();
