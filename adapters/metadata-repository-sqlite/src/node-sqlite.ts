/**
 * Thin `node:sqlite` re-export, loaded via `createRequire` instead of a
 * static `import ... from "node:sqlite"`.
 *
 * ## Why: a vitest 2.1.x test-runner limitation, not a production concern
 *
 * `node:sqlite` is a "prefix-only" Node builtin (like `node:test`) — it can
 * only be imported with the `node:` prefix, never as a bare `sqlite`
 * specifier. A *static* `import { DatabaseSync } from "node:sqlite"`
 * works correctly in plain Node (verified directly, and via a raw
 * `vite.createServer().ssrLoadModule()` probe) and vitest's own module
 * executor separately recognizes `"node:sqlite"` as a known builtin
 * (`vitest/dist/chunks/execute*.js`'s `prefixedBuiltins` set includes it).
 * Despite that, running a test file that statically imports `node:sqlite`
 * through this monorepo's pinned `vitest@2.1.9` fails with
 * `Failed to load url sqlite (resolved id: sqlite). Does the file exist?`
 * — some part of vitest 2.1.x's SSR dependency-resolution path strips the
 * `node:` prefix before the builtin check that would otherwise externalize
 * it, and no `vitest.config.ts` option (`deps.optimizer.ssr.enabled`,
 * `ssr.external`, etc. — all tried) routes around it. `vitest@2.1.9` is
 * the latest available `2.x` release at the time of writing, so this is
 * not a "just update the patch version" fix, and bumping the whole
 * monorepo's shared `vitest` devDependency across a major version for one
 * adapter package is a heavier change than this warrants.
 *
 * `createRequire` sidesteps the problem at its root: `require("node:sqlite")`
 * is a runtime function call, not an ES `import` specifier, so nothing in
 * vite/vitest's static import-graph analysis ever sees `"node:sqlite"` to
 * mis-resolve — Node's real, built-in module resolution handles it
 * directly, exactly as it does outside a test run. Production code that
 * depends on this package (a real Node process, no vitest involved) is
 * unaffected by any of this either way; this file exists purely so this
 * package's own test suite can run under this monorepo's current tooling.
 */
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);
const sqliteModule = nodeRequire("node:sqlite") as typeof import("node:sqlite");

/** `node:sqlite`'s `DatabaseSync`, both as the runtime class and as the instance type. */
export const DatabaseSync = sqliteModule.DatabaseSync;
export type DatabaseSync = InstanceType<typeof sqliteModule.DatabaseSync>;
