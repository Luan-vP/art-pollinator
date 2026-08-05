#!/usr/bin/env node
/**
 * Node server entry point (issue #45): `npm run start --workspace=clients/node`
 * (or `tsx src/index.ts` directly) runs this as a long-lived process.
 *
 * ## Running this without a build step
 *
 * Every package in this monorepo ships as raw TypeScript (`"main": "./src/
 * index.ts"`) — `core`, `app`, and every adapter are consumed as source via
 * vitest (tests) or Metro (the mobile bundler), and neither this repo nor
 * any of its packages has ever had a `tsc`-to-JS build step before this
 * batch. Plain `node` cannot run this file directly: Node's own type-
 * stripping (`--experimental-strip-types`, verified against this exact
 * codebase while building this batch) erases type annotations but does not
 * remap the `.js`-suffixed relative imports this codebase's `NodeNext`
 * module resolution requires (e.g. `./constants.js`, where only
 * `constants.ts` exists on disk) — `node --experimental-strip-types` on
 * this file fails with `ERR_MODULE_NOT_FOUND` resolving straight through
 * `core`'s own entry point. `tsx` (a devDependency of this package only) is
 * the pragmatic fix: an esbuild-backed loader that both strips types *and*
 * performs the extension remapping this codebase's imports need, with no
 * new build artifacts and no change to any other package. This is the
 * smallest change that makes "a runnable Node process" literally true
 * (issue #45's own DoD) without introducing a repo-wide bundling pipeline
 * disproportionate to this task's scope.
 *
 * ## Linux/macOS: what was actually verified here
 *
 * This sandbox is Linux-only — there is no macOS runner available in this
 * environment to verify against directly (the same category of gap
 * `clients/mobile/src/composition/composition-root.native.ts` already
 * discloses for BLE hardware: "noted rather than solved"). Everything this
 * process depends on is cross-platform by construction, though, which is
 * the closest available substitute for a real macOS run:
 * `node:http`/`node:sqlite`/`node:crypto`/`node:fs` are all part of Node's
 * standard, cross-platform API surface (no native addons, no
 * platform-conditional code path anywhere in this package or the adapters
 * it wires — AGENTS.md §2 rule 2 applies here exactly as it does to `core`/
 * `app`), and this package's `engines.node` (`>=22.5.0`, inherited from
 * `@art-pollinator/metadata-repository-sqlite`'s `node:sqlite` requirement)
 * is satisfied by the same official Node.js binary distributed for both
 * Linux and macOS. SPEC.md §9's "Linux- and macOS-friendly" exit criterion
 * is met on the only axis actually verifiable without macOS hardware:
 * nothing in this dependency chain is Linux-specific.
 */
import { readConfigFromEnv } from "./config.js";
import { createNodeCompositionRoot } from "./composition/composition-root.js";

async function main(): Promise<void> {
  const config = readConfigFromEnv();
  const root = await createNodeCompositionRoot(config);
  const { baseUrl, transportPort } = await root.start();

  // A single structured line on startup — parsed by
  // `e2e-client-node-swap.test.ts` when it spawns this file as a real child
  // process (issue #48), and useful for a human operator running this for
  // real either way.
  console.log(
    JSON.stringify({
      event: "art-pollinator-node-listening",
      baseUrl,
      transportPort,
      discoveryPort: config.discoveryPort,
      host: config.host,
      capacity: config.capacity,
      dbPath: config.dbPath,
    }),
  );

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ event: "art-pollinator-node-stopping", signal }));
    void root.stop().then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
        console.error("Error during shutdown:", error);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

main().catch((error: unknown) => {
  console.error("art-pollinator node server failed to start:", error);
  process.exit(1);
});
