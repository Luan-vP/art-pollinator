#!/usr/bin/env node
/**
 * Runs the test suite for every package under clients/*.
 *
 * Mirrors scripts/run-adapter-tests.mjs. `clients/mobile` (issue #29) is the
 * first package to land here; its composition-root tests (issue #30) are
 * pure (no network/filesystem/device — they import platform modules
 * directly by filename) and run the same way core/app tests do.
 */
import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const clientsDir = join(process.cwd(), "clients");

function findClientPackages() {
  if (!existsSync(clientsDir)) return [];
  return readdirSync(clientsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(clientsDir, entry.name))
    .filter((dir) => existsSync(join(dir, "package.json")));
}

const packages = findClientPackages();

if (packages.length === 0) {
  console.log(
    "No client packages found under clients/* yet. test:clients is wired and will run each " +
      "client's `npm test` once one lands.",
  );
  process.exit(0);
}

for (const pkgDir of packages) {
  console.log(`\nRunning client tests in ${pkgDir}`);
  execFileSync("npm", ["test", "--prefix", pkgDir], { stdio: "inherit" });
}
