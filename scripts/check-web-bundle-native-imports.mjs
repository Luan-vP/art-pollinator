#!/usr/bin/env node
/**
 * RN Web compatibility gate (AGENTS.md §5, issue #31).
 *
 * "Native-only imports must never reach the shared path... CI fails the
 * build if it leaks into the web bundle." This checker scans an already-
 * built Metro/Expo web bundle for banned native-only package markers and
 * exits non-zero if any are found — it is deliberately a *post-build*
 * check, not a source-level import scan, because Metro can and does
 * silently succeed at bundling a native-only package for web (verified
 * empirically while building this checker: `react-native-ble-plx` resolves
 * cleanly and its module name string ends up in the compiled web bundle
 * with no build error at all — see the PR description for the full
 * before/after proof). A source-level scanner would miss that class of
 * leak entirely.
 *
 * Usage:
 *   node scripts/check-web-bundle-native-imports.mjs <bundleDir>
 *
 * <bundleDir> is the output of `expo export --platform web` (default
 * "dist" inside a client package, e.g. clients/mobile/dist). Exits 2 (not a
 * violation, a usage/setup error) if the directory does not exist — run the
 * web export first.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

/**
 * Native-only packages that must never be reachable from a web bundle.
 * `react-native-ble-plx` is the one AGENTS.md §5 names explicitly; the rest
 * are the peripheral/advertising-role candidates
 * docs/spikes/0028-background-ble-feasibility.md discusses for issue #34 —
 * listed pre-emptively so the gate does not need editing the day one of
 * them is actually adopted.
 */
export const BANNED_NATIVE_PACKAGES = [
  "react-native-ble-plx",
  "react-native-ble-advertiser",
  "react-native-peripheral",
  "munim-bluetooth",
];

const BUNDLE_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

function listBundleFiles(rootDir) {
  const results = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (BUNDLE_EXTENSIONS.has(extname(entry.name))) {
        results.push(fullPath);
      }
    }
  };
  walk(rootDir);
  return results;
}

function findViolations(bundleDir) {
  const files = listBundleFiles(bundleDir);
  const violations = [];
  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    for (const pkg of BANNED_NATIVE_PACKAGES) {
      if (contents.includes(pkg)) {
        violations.push({ file, pkg });
      }
    }
  }
  return violations;
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node scripts/check-web-bundle-native-imports.mjs <bundleDir>");
    process.exit(2);
  }

  const bundleDirAbs = resolve(target);
  let stat;
  try {
    stat = statSync(bundleDirAbs);
  } catch {
    console.error(
      `Bundle directory does not exist: ${bundleDirAbs}\n` +
        `Run the web export first (e.g. "npm run export:web --workspace=@art-pollinator/mobile").`,
    );
    process.exit(2);
  }
  if (!stat.isDirectory()) {
    console.error(`Target is not a directory: ${bundleDirAbs}`);
    process.exit(2);
  }

  const violations = findViolations(bundleDirAbs);

  if (violations.length > 0) {
    console.error(`Native-only import(s) reachable from the web bundle in ${target}:\n`);
    for (const v of violations) {
      console.error(`  ${relative(process.cwd(), v.file)}  contains "${v.pkg}"`);
    }
    console.error(
      `\n${violations.length} violation(s) found. See AGENTS.md §5 ` +
        `("Native-only imports must never reach the shared path") and issue #31.`,
    );
    process.exit(1);
  }

  console.log(`OK: web bundle at ${target} contains no banned native-only package markers.`);
  process.exit(0);
}

main();
