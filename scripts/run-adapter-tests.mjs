#!/usr/bin/env node
/**
 * Runs the integration test suite for every package under adapters/*.
 *
 * Adapter tests may use real I/O (AGENTS.md §5) and are structurally
 * separate from the core suite (issue #3). No adapter packages exist yet
 * (issue #1 only creates the placeholder directory), so this currently finds
 * zero packages and exits 0 — the command is wired and ready for CI, and
 * will start exercising real adapters as soon as the first one lands.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const adaptersDir = join(process.cwd(), "adapters");

function findAdapterPackages() {
  if (!existsSync(adaptersDir)) return [];
  return readdirSync(adaptersDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(adaptersDir, entry.name))
    .filter((dir) => existsSync(join(dir, "package.json")));
}

const packages = findAdapterPackages();

if (packages.length === 0) {
  console.log(
    "No adapter packages found under adapters/* yet (placeholder directory only, see #1). " +
      "test:adapters is wired and will run each adapter's `npm test` once adapters land.",
  );
  process.exit(0);
}

for (const pkgDir of packages) {
  console.log(`\nRunning adapter tests in ${pkgDir}`);
  execFileSync("npm", ["test", "--prefix", pkgDir], { stdio: "inherit" });
}
