#!/usr/bin/env node
/**
 * Proves the dependency-direction lint rule (scripts/check-core-boundaries.mjs)
 * actually fails the build on violating imports, and passes on real `core`
 * source. This is the test required by issue #1's definition of done:
 * "a fixture file that violates the rule, asserted to fail the lint."
 *
 * Run with: node scripts/test-boundaries.mjs
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const checker = join(__dirname, "check-core-boundaries.mjs");
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

// 1. The checker must PASS on real core/src (no violations expected).
const realCore = run("core/src");
assert(realCore.exitCode === 0, "real core/src has zero dependency-direction violations");

// 2. The checker must FAIL on the fixture with a bare external import.
const bareExternal = run("scripts/fixtures/violating-import");
assert(
  bareExternal.exitCode === 1,
  "fixture directory (bare external import + reach into app) fails the checker",
);
assert(
  bareExternal.stderr.includes("bare-external.ts") && bareExternal.stderr.includes('"fs"'),
  "checker output names the offending file and the disallowed 'fs' import",
);
assert(
  bareExternal.stderr.includes("reaches-app.ts"),
  "checker output also flags the fixture that reaches into app/",
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}

console.log(
  "\nAll assertions passed: the dependency-direction rule is proven to fail the build on violations.",
);
