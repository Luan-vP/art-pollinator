#!/usr/bin/env node
/**
 * Dependency-direction lint rule for `core` (AGENTS.md §2, issue #1).
 *
 * `core` must have ZERO I/O and ZERO external dependencies: no imports from
 * `app`, `adapters/*`, `clients/*`, any npm package, or any Node builtin.
 * The only imports it may make are relative imports that resolve to another
 * file inside its own source root.
 *
 * Usage:
 *   node scripts/check-core-boundaries.mjs <targetDir>
 *
 * Exits 0 and prints a summary if every import in <targetDir> is a relative
 * import resolving inside <targetDir>. Exits 1 and prints every violation
 * (file, line, offending specifier, reason) otherwise.
 *
 * Decision: *.test.ts / *.spec.ts files are exempt from the "no bare
 * imports" check (they may `import { ... } from "vitest"`). The zero-
 * dependency invariant is about what ships as `core`'s runtime code — the
 * test framework is a devDependency that never ships and never executes
 * outside `npm test`. Test files are still required to stay inside the
 * target directory (no reaching into app/adapters/clients).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, dirname, join, relative, resolve } from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

// Matches the specifier in static import/export-from, require(), and
// dynamic import() forms. Good enough for real source files; it does not
// need to be a full parser to serve as a build-failing guard rail.
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

function findSpecifiers(fileContents) {
  const specifiers = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(fileContents)) !== null) {
      specifiers.push({ specifier: match[1], index: match.index });
    }
  }
  return specifiers;
}

function lineNumberAt(fileContents, index) {
  return fileContents.slice(0, index).split("\n").length;
}

function checkFile(filePath, rootDirAbs) {
  const contents = readFileSync(filePath, "utf8");
  const isTestFile = TEST_FILE_PATTERN.test(filePath);
  const violations = [];
  for (const { specifier, index } of findSpecifiers(contents)) {
    const line = lineNumberAt(contents, index);

    if (!specifier.startsWith(".")) {
      if (isTestFile) continue; // see TEST_FILE_PATTERN comment above
      violations.push({
        file: filePath,
        line,
        specifier,
        reason:
          "bare (non-relative) import — core may not import external packages, Node builtins, or other workspace packages",
      });
      continue;
    }

    const resolved = resolve(dirname(filePath), specifier);
    const rel = relative(rootDirAbs, resolved);
    if (rel.startsWith("..")) {
      violations.push({
        file: filePath,
        line,
        specifier,
        reason: `relative import escapes the core source root (resolves to ${resolved})`,
      });
    }
  }
  return violations;
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node scripts/check-core-boundaries.mjs <targetDir>");
    process.exit(2);
  }

  const rootDirAbs = resolve(target);
  let stat;
  try {
    stat = statSync(rootDirAbs);
  } catch {
    console.error(`Target directory does not exist: ${rootDirAbs}`);
    process.exit(2);
  }
  if (!stat.isDirectory()) {
    console.error(`Target is not a directory: ${rootDirAbs}`);
    process.exit(2);
  }

  const files = listSourceFiles(rootDirAbs);
  const allViolations = files.flatMap((file) => checkFile(file, rootDirAbs));

  if (allViolations.length > 0) {
    console.error(`Dependency-direction violations in ${target}:\n`);
    for (const v of allViolations) {
      console.error(
        `  ${relative(process.cwd(), v.file)}:${v.line}  "${v.specifier}"\n    ${v.reason}`,
      );
    }
    console.error(`\n${allViolations.length} violation(s) found. See AGENTS.md §2.`);
    process.exit(1);
  }

  console.log(
    `OK: ${files.length} file(s) checked in ${target} — no dependency-direction violations.`,
  );
  process.exit(0);
}

main();
