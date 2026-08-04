// @ts-check
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier";

const tsRecommended = tseslint.configs["recommended"].rules;

/** Packages that must never import anything except relative paths within `core`. */
const CORE_GLOB = "core/src/**/*.ts";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.expo/**",
      "scripts/fixtures/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tsRecommended,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message:
            "Prefer union types / const objects over enums for tree-shakeable, zero-runtime domain types.",
        },
      ],
    },
  },
  {
    // Belt-and-suspenders: ESLint-level restriction mirroring
    // scripts/check-core-boundaries.mjs (the authoritative, tested check
    // wired into `npm run lint:boundaries`). Bare specifiers matching these
    // patterns are rejected directly inside `core`.
    files: [CORE_GLOB],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@art-pollinator/app", "@art-pollinator/app/*"],
              message: "core must not depend on app — see AGENTS.md §2.",
            },
            {
              group: ["@art-pollinator/adapters/*", "**/adapters/*"],
              message: "core must not depend on adapters — see AGENTS.md §2.",
            },
            {
              group: ["@art-pollinator/clients/*", "**/clients/*"],
              message: "core must not depend on clients — see AGENTS.md §2.",
            },
            {
              group: ["../app/*", "../../app/*", "../../../app/*"],
              message: "core must not reach into app via relative paths — see AGENTS.md §2.",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
];
