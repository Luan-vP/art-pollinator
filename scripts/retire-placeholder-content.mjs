#!/usr/bin/env node
/**
 * The placeholder-content retirement mechanism (issue #56, IMPLEMENTATION.md
 * Phase 3, item 56: "Retire placeholder content — seed adapter removed; no
 * scraped work in any shipped build").
 *
 * ## ⚠️ Do not run this against the real repository yet
 *
 * SPEC.md §10 / §11 open question 5 and AGENTS.md §3: the rights and
 * consent model gates Phase 3 and is not resolved by this batch — see
 * `docs/rights/consent-model-DRAFT.md` (a draft proposal, not a shipped
 * policy) and `clients/mobile/src/composition/placeholder-retirement-switch.ts`
 * (the switch this script reads and refuses to proceed without). This
 * script exists, and is proven to work
 * (`scripts/test-placeholder-retirement.mjs`), so that once a real
 * consent model exists, retiring the placeholder seed adapter is a
 * mechanical, already-tested operation rather than new engineering work
 * done under time pressure. It is deliberately **not** registered as any
 * `package.json` script at all (unlike `scripts/check-placeholder-retirement.mjs`,
 * which is safe to run any time and is registered as
 * `npm run check:placeholder-retirement`) — the retirement script must be
 * invoked explicitly (`node scripts/retire-placeholder-content.mjs <dir>`)
 * so it can never be triggered by muscle-memory (`npm run <tab-complete>`)
 * or accidentally wired into CI. Its own switch check (below) is a second,
 * independent safeguard even if it ever is invoked against real source.
 *
 * ## What this does
 *
 * Given a client directory (e.g. `clients/mobile`):
 *
 * 1. Reads `<clientDir>/src/composition/placeholder-retirement-switch.ts`
 *    and requires it to contain `PLACEHOLDER_CONTENT_RETIRED = true`.
 *    Refuses (exit 2, no files touched) if the switch is `false`, missing,
 *    or the file itself is missing — this is the actual "switch" the task
 *    describes: nothing below runs unless it is flipped first, in the
 *    *target* directory (a temp copy, in tests — see that script's own
 *    doc comment on why real source is never edited by the test suite).
 * 2. Removes every `// @placeholder-retirement:start` ...
 *    `// @placeholder-retirement:end` marked block (inclusive) from
 *    `composition-root-shared.ts`, `composition-root.native.ts`, and
 *    `composition-root.web.ts` under `<clientDir>/src/composition/` — the
 *    placeholder-seed import, the two placeholder-seed functions, and both
 *    platforms' call sites.
 * 3. Removes the `@art-pollinator/seed-placeholder-dev` entry from
 *    `<clientDir>/package.json`'s `dependencies` (and `devDependencies`, if
 *    present there instead).
 *
 * `scripts/check-placeholder-retirement.mjs` independently verifies the
 * result is genuinely reference-free, not just inert — run it against
 * `<clientDir>` after this script to confirm.
 *
 * Usage:
 *   node scripts/retire-placeholder-content.mjs <clientDir>
 */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const TARGET_SPECIFIER = "@art-pollinator/seed-placeholder-dev";
const MARKER_BLOCK_PATTERN =
  /[ \t]*\/\/ @placeholder-retirement:start[\s\S]*?\/\/ @placeholder-retirement:end\n?/g;
const COMPOSITION_FILES = [
  "composition-root-shared.ts",
  "composition-root.native.ts",
  "composition-root.web.ts",
];

function readSwitchValue(clientDirAbs) {
  const switchPath = join(clientDirAbs, "src/composition/placeholder-retirement-switch.ts");
  let contents;
  try {
    contents = readFileSync(switchPath, "utf8");
  } catch {
    return { ok: false, reason: `Switch file not found: ${switchPath}` };
  }
  const match = /PLACEHOLDER_CONTENT_RETIRED\s*=\s*(true|false)/.exec(contents);
  if (!match) {
    return {
      ok: false,
      reason: `Could not find "PLACEHOLDER_CONTENT_RETIRED = true|false" in ${switchPath}`,
    };
  }
  return { ok: true, retired: match[1] === "true" };
}

function exciseMarkedBlocks(filePath) {
  const before = readFileSync(filePath, "utf8");
  const after = before.replace(MARKER_BLOCK_PATTERN, "");
  writeFileSync(filePath, after, "utf8");
  return { removedBlocks: (before.match(MARKER_BLOCK_PATTERN) ?? []).length };
}

function removeDependency(clientDirAbs) {
  const pkgPath = join(clientDirAbs, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  let removed = false;
  for (const depField of ["dependencies", "devDependencies"]) {
    if (pkg[depField] && Object.hasOwn(pkg[depField], TARGET_SPECIFIER)) {
      delete pkg[depField][TARGET_SPECIFIER];
      removed = true;
    }
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return removed;
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node scripts/retire-placeholder-content.mjs <clientDir>");
    process.exit(2);
  }

  const clientDirAbs = resolve(target);
  try {
    if (!statSync(clientDirAbs).isDirectory()) throw new Error("not a directory");
  } catch {
    console.error(`Target directory does not exist: ${clientDirAbs}`);
    process.exit(2);
  }

  const switchResult = readSwitchValue(clientDirAbs);
  if (!switchResult.ok) {
    console.error(`Refusing to retire: ${switchResult.reason}`);
    process.exit(2);
  }
  if (!switchResult.retired) {
    console.error(
      "Refusing to retire: PLACEHOLDER_CONTENT_RETIRED is false in " +
        `${target}/src/composition/placeholder-retirement-switch.ts. No files touched.\n\n` +
        "This switch must not be flipped until a real (non-draft) consent model from issue " +
        "#54 exists — see docs/rights/consent-model-DRAFT.md.",
    );
    process.exit(2);
  }

  let totalBlocksRemoved = 0;
  for (const file of COMPOSITION_FILES) {
    const filePath = join(clientDirAbs, "src/composition", file);
    const { removedBlocks } = exciseMarkedBlocks(filePath);
    totalBlocksRemoved += removedBlocks;
    console.log(`  ${file}: removed ${String(removedBlocks)} marked block(s)`);
  }

  const dependencyRemoved = removeDependency(clientDirAbs);
  console.log(
    `  package.json: ${dependencyRemoved ? "removed" : "did not find"} the "${TARGET_SPECIFIER}" dependency entry`,
  );

  console.log(
    `\nOK: placeholder-content retirement applied to ${target} ` +
      `(${String(totalBlocksRemoved)} source block(s) excised). ` +
      `Run "node scripts/check-placeholder-retirement.mjs ${target}" to verify.`,
  );
  process.exit(0);
}

main();
