#!/usr/bin/env node
/**
 * Proves the placeholder-content retirement mechanism (issue #56) actually
 * works: the switch genuinely gates it (default OFF refuses and touches
 * nothing), and flipping it to ON and running the retirement script
 * produces a result `scripts/check-placeholder-retirement.mjs` confirms is
 * genuinely reference-free — not merely inert — while leaving the real
 * checked-out `clients/mobile` source completely untouched throughout (this
 * script only ever mutates a temp copy). This is the same
 * fixture-plus-two-scripts shape `scripts/test-boundaries.mjs` and
 * `scripts/test-web-bundle-native-imports.mjs` already use to prove their
 * own checkers, applied here to a mechanism that *mutates* rather than only
 * *checks* — hence testing it against a real temp copy of `clients/mobile`
 * rather than a synthetic fixture, so the proof is about the real
 * composition root, not a stand-in shaped like it.
 *
 * Run with: node scripts/test-placeholder-retirement.mjs
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const checker = join(__dirname, "check-placeholder-retirement.mjs");
const retirer = join(__dirname, "retire-placeholder-content.mjs");
const realMobileDir = join(repoRoot, "clients/mobile");

function run(script, targetDir) {
  try {
    const stdout = execFileSync("node", [script, targetDir], { cwd: repoRoot, encoding: "utf8" });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    return { exitCode: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
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

// --- Set up a real, disposable copy of clients/mobile's composition root + package.json. ---
const tmpBase = mkdtempSync(join(tmpdir(), "placeholder-retirement-"));
const tmpClientDir = join(tmpBase, "mobile");
mkdirSync(join(tmpClientDir, "src/composition"), { recursive: true });
cpSync(join(realMobileDir, "package.json"), join(tmpClientDir, "package.json"));
cpSync(join(realMobileDir, "src/composition"), join(tmpClientDir, "src/composition"), {
  recursive: true,
});

try {
  // 1. The checker must FAIL (exit 1) on an untouched copy — the placeholder
  //    package is genuinely still referenced there, exactly as it should be
  //    while issue #54 remains unresolved.
  const before = run(checker, tmpClientDir);
  assert(before.exitCode === 1, "checker fails on an untouched copy (placeholder still wired)");

  // 2. The retirement script must REFUSE (exit 2) while the switch is off —
  //    the copied switch file is byte-for-byte the real one, which is `false`.
  const refusedBefore = readFileSync(
    join(tmpClientDir, "src/composition/composition-root-shared.ts"),
    "utf8",
  );
  const refusal = run(retirer, tmpClientDir);
  assert(refusal.exitCode === 2, "retirement script refuses when the switch is off (default)");
  const afterRefusal = readFileSync(
    join(tmpClientDir, "src/composition/composition-root-shared.ts"),
    "utf8",
  );
  assert(
    afterRefusal === refusedBefore,
    "a refused retirement attempt leaves source files byte-for-byte unchanged",
  );

  // 3. Flip the switch — in the TEMP COPY ONLY, never in the real repo.
  writeFileSync(
    join(tmpClientDir, "src/composition/placeholder-retirement-switch.ts"),
    "export const PLACEHOLDER_CONTENT_RETIRED = true;\n",
    "utf8",
  );

  // 4. Now the retirement script must SUCCEED (exit 0).
  const retirement = run(retirer, tmpClientDir);
  assert(retirement.exitCode === 0, "retirement script succeeds once the switch is flipped on");

  // 5. And the checker must now PASS (exit 0) — genuinely unreferenced, not
  //    just inert: no import specifier, no package.json dependency entry.
  const after = run(checker, tmpClientDir);
  assert(
    after.exitCode === 0,
    "checker passes after retirement — the placeholder package is genuinely unreferenced",
  );

  // 6. Sanity: the excision removed ONLY the placeholder-seed block, not the
  //    rest of the composition root's real functionality.
  const sharedAfter = readFileSync(
    join(tmpClientDir, "src/composition/composition-root-shared.ts"),
    "utf8",
  );
  for (const survivor of [
    "export function buildSharedServices",
    "export function buildSwapService",
    "export function buildIngestionService",
    "export function wireAutomaticSwap",
  ]) {
    assert(
      sharedAfter.includes(survivor),
      `retirement preserves unrelated composition-root code: "${survivor}" still present`,
    );
  }
  assert(
    !sharedAfter.includes("seed-placeholder-dev"),
    "retirement removes the placeholder package specifier from composition-root-shared.ts",
  );

  const pkgAfter = JSON.parse(readFileSync(join(tmpClientDir, "package.json"), "utf8"));
  assert(
    pkgAfter.dependencies?.["@art-pollinator/seed-placeholder-dev"] === undefined,
    "retirement removes the placeholder package from package.json's dependencies",
  );
  assert(
    pkgAfter.dependencies?.["@art-pollinator/app"] === "*",
    "retirement leaves unrelated package.json dependencies untouched",
  );

  // 7. The REAL repository must be completely unaffected by any of the above
  //    — this test only ever mutated the temp copy.
  const real = run(checker, realMobileDir);
  assert(
    real.exitCode === 1,
    "the real clients/mobile is untouched: placeholder seed still wired there, as required " +
      "until issue #54 resolves",
  );
} finally {
  rmSync(tmpBase, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}

console.log(
  "\nAll assertions passed: the placeholder-content retirement mechanism (issue #56) is " +
    "proven to work end to end, gated by its switch, and the real repository was left " +
    "untouched (the switch stays off there, per this batch's explicit instruction).",
);
