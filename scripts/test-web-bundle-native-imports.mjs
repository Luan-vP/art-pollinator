#!/usr/bin/env node
/**
 * Proves the RN Web compatibility gate (scripts/check-web-bundle-native-imports.mjs,
 * issue #31) actually fails on a real violation and passes on clean bundle
 * content — the fast, offline, re-runnable regression counterpart to the
 * one-off manual proof performed during development (see the PR description):
 * a real `expo export --platform web` was run from clients/mobile with a
 * temporary `import { BleManager } from "react-native-ble-plx"` added to
 * App.tsx. Metro bundled it successfully — no build error — and the string
 * "react-native-ble-plx" ended up verbatim in the compiled web bundle. That
 * import was then reverted; clients/mobile has no native-only dependency in
 * its committed source. scripts/fixtures/web-bundle-native-leak/ mimics that
 * same shape so this exact proof can be re-run on every CI run without
 * needing a full Expo build.
 *
 * Run with: node scripts/test-web-bundle-native-imports.mjs
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const checker = join(__dirname, "check-web-bundle-native-imports.mjs");
const repoRoot = join(__dirname, "..");

function run(targetDir) {
  try {
    const stdout = execFileSync("node", [checker, targetDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

let failures = 0;

function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`PASS: ${message}`);
  }
}

// 1. The checker must PASS on a clean bundle directory (no violations).
const clean = run("scripts/fixtures/web-bundle-native-leak/clean");
assert(clean.exitCode === 0, "checker passes on a bundle with no native-only package markers");

// 2. The checker must FAIL on the fixture simulating a leaked native import.
const violating = run("scripts/fixtures/web-bundle-native-leak/violating");
assert(
  violating.exitCode === 1,
  "checker fails on the fixture bundle that requires react-native-ble-plx",
);
assert(
  violating.stderr.includes("violating-bundle.js") &&
    violating.stderr.includes("react-native-ble-plx"),
  "checker output names the offending file and the banned package",
);

// 3. Usage error (missing directory) exits 2, distinct from a real violation.
const missing = run("scripts/fixtures/web-bundle-native-leak/does-not-exist");
assert(
  missing.exitCode === 2,
  "checker exits 2 (setup error), not 1 (violation), when the bundle directory is missing",
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}

console.log(
  "\nAll assertions passed: the RN Web compatibility gate is proven to fail the build on a " +
    "real native-only-import leak into the web bundle, and to pass on clean bundle content.",
);
