import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const API_SOURCES = ["apps/api/src/**/*.ts"];
const DB_ACCESS_FILES = [
  "apps/api/src/**/*.repository.ts",
  "apps/api/src/**/*.queries.ts",
  "apps/api/src/**/*.test.ts",
];

const UNSAFE_RAW_SQL = {
  selector: "MemberExpression[property.name=/^[$](queryRawUnsafe|executeRawUnsafe)$/]",
  message: "Unsafe raw SQL is forbidden: use the $queryRaw tagged template or TypedSQL.",
};
const RAW_SQL_OUTSIDE_QUERIES = {
  selector: "MemberExpression[property.name=/^[$](queryRaw|executeRaw)$/]",
  message: "SQL lives only in *.repository.ts and *.queries.ts.",
};
const HTML_INJECTION = {
  selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
  message: "dangerouslySetInnerHTML is forbidden.",
};

export default defineConfig(
  globalIgnores([
    "**/dist/",
    "**/coverage/",
    "apps/api/src/generated/",
    "docs/",
    "design/",
    // Local build output of the demo, kept in the demo tag
    "dist-server/",
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["**/*.{js,cjs,mjs}"], extends: [tseslint.configs.disableTypeChecked] },
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs" } },
  {
    files: API_SOURCES,
    rules: {
      "no-restricted-syntax": ["error", UNSAFE_RAW_SQL, RAW_SQL_OUTSIDE_QUERIES],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/generated/**"],
              message: "Prisma client: only *.repository.ts, *.queries.ts, core/db/client.",
            },
          ],
        },
      ],
    },
  },
  {
    files: DB_ACCESS_FILES,
    rules: { "no-restricted-syntax": ["error", UNSAFE_RAW_SQL], "no-restricted-imports": "off" },
  },
  { files: ["apps/api/src/core/db/client.ts"], rules: { "no-restricted-imports": "off" } },
  {
    // Node strips types from this package at runtime, so a relative import must name the real .ts file
    files: ["packages/shared/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ regex: "^\\.{1,2}/.*\\.js$", message: "Import the .ts file: Node runs this source directly." }],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: { "no-restricted-syntax": ["error", HTML_INJECTION] },
  },
  {
    files: ["apps/web/src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "antd",
              importNames: ["Table", "Modal", "Drawer", "Tag", "Popconfirm", "Select"],
              message: "Features use the UI kit from apps/web/src/ui.",
            },
          ],
        },
      ],
    },
  },
);
