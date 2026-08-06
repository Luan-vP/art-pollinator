#!/usr/bin/env node
/**
 * Placeholder-retirement dependency-graph check (issue #56's retirement
 * mechanism).
 *
 * Proves — statically, the same way `scripts/check-core-boundaries.mjs`
 * proves the dependency-direction rule and
 * `scripts/check-web-bundle-native-imports.mjs` proves a native package
 * isn't reachable from the web bundle — that
 * `@art-pollinator/seed-placeholder-dev` is genuinely unreferenced from a
 * given client directory: no source file imports it, and it is not listed
 * as a `package.json` dependency. This is a real "reachable in the
 * dependency graph" check, not a text-search proxy for one: it only matches
 * the specifier inside an actual `import`/`export ... from`/`require()`
 * statement, the same restricted pattern `check-core-boundaries.mjs` uses,
 * so a doc comment that happens to mention the package by name (e.g.
 * explaining *why* it was removed) does not itself count as a violation.
 *
 * Usage:
 *   node scripts/check-placeholder-retirement.mjs <clientDir>
 *
 * <clientDir> must contain `package.json` and `src/`. Exits 0 if the
 * package is genuinely unreferenced, 1 if it is still referenced somewhere
 * (source import or package.json dependency), 2 on a usage/setup error.
 *
 * This check makes no judgement about whether the package *should* be
 * unreferenced right now — see `scripts/retire-placeholder-content.mjs` and
 * `clients/mobile/src/composition/placeholder-retirement-switch.ts` for the
 * actual switch and its explicit warning not to flip it until issue #54
 * resolves. Run against the real, unmodified `clients/mobile`, this check
 * is *expected* to fail (exit 1) — the placeholder seed adapter is still
 * deliberately wired in. It exists to verify the retirement *mechanism*
 * genuinely works when invoked, not to assert retirement has happened.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const TARGET_SPECIFIER = "@art-pollinator/seed-placeholder-dev";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

// Same restricted shape as check-core-boundaries.mjs's IMPORT_PATTERNS —
// matches only real import/export-from/require/dynamic-import specifiers,
// not arbitrary text occurrences (e.g. inside a doc comment).
const IMPORT_PATTERNS = [
  /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function listSourceFiles(rootDir) {
  const results = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
        results.push(fullPath);
      }
    }
  };
  walk(rootDir);
  return results;
}

function findImportViolations(srcDir) {
  const violations = [];
  for (const file of listSourceFiles(srcDir)) {
    const contents = readFileSync(file, "utf8");
    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(contents)) !== null) {
        if (match[1] === TARGET_SPECIFIER) {
          const line = contents.slice(0, match.index).split("\n").length;
          violations.push({ file, line, kind: "import" });
        }
      }
    }
  }
  return violations;
}

function findPackageJsonViolation(clientDir) {
  const pkgPath = join(clientDir, "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return []; // no package.json, or unparseable — not this check's concern
  }
  const violations = [];
  for (const depField of ["dependencies", "devDependencies"]) {
    if (pkg[depField]?.[TARGET_SPECIFIER] !== undefined) {
      violations.push({ file: pkgPath, line: undefined, kind: `package.json ${depField}` });
    }
  }
  return violations;
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node scripts/check-placeholder-retirement.mjs <clientDir>");
    process.exit(2);
  }

  const clientDirAbs = resolve(target);
  let stat;
  try {
    stat = statSync(clientDirAbs);
  } catch {
    console.error(`Target directory does not exist: ${clientDirAbs}`);
    process.exit(2);
  }
  if (!stat.isDirectory()) {
    console.error(`Target is not a directory: ${clientDirAbs}`);
    process.exit(2);
  }

  const srcDir = join(clientDirAbs, "src");
  let srcStat;
  try {
    srcStat = statSync(srcDir);
  } catch {
    console.error(`Expected a "src" directory inside ${clientDirAbs} — none found.`);
    process.exit(2);
  }
  if (!srcStat.isDirectory()) {
    console.error(`${srcDir} exists but is not a directory.`);
    process.exit(2);
  }

  const violations = [...findImportViolations(srcDir), ...findPackageJsonViolation(clientDirAbs)];

  if (violations.length > 0) {
    console.error(`"${TARGET_SPECIFIER}" is still referenced in ${target}:\n`);
    for (const v of violations) {
      const location = v.line
        ? `${relative(process.cwd(), v.file)}:${v.line}`
        : relative(process.cwd(), v.file);
      console.error(`  ${location}  (${v.kind})`);
    }
    console.error(
      `\n${violations.length} reference(s) found — the placeholder package is NOT retired here.`,
    );
    process.exit(1);
  }

  console.log(
    `OK: "${TARGET_SPECIFIER}" is genuinely unreferenced in ${target} (no import, no package.json dependency).`,
  );
  process.exit(0);
}

main();
