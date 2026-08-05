// FIXTURE — a stand-in for a clean web bundle chunk with no native-only
// package markers, used by scripts/test-web-bundle-native-imports.mjs to
// prove the checker does NOT false-positive on ordinary bundle content.
(function () {
  module.exports = { ok: true };
})();
