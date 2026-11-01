import { defineConfig } from "vitest/config";

const INTEGRATION_TESTS = "src/**/*.int.test.ts";

// `npm test` runs the unit projects without a database; `npm run test:integration` needs real PostgreSQL
export default defineConfig({
  test: {
    projects: [
      { test: { name: "shared", root: "packages/shared", include: ["src/**/*.test.ts"] } },
      {
        test: { name: "api", root: "apps/api", include: ["src/**/*.test.ts"], exclude: [INTEGRATION_TESTS] },
      },
      { test: { name: "web", root: "apps/web", include: ["src/**/*.test.ts"] } },
      { test: { name: "infra", root: "infra", include: ["*.test.ts"] } },
      // One database, so test files take turns
      {
        test: {
          name: "integration",
          root: "apps/api",
          include: [INTEGRATION_TESTS],
          globalSetup: ["src/core/db/test-setup.ts"],
          fileParallelism: false,
          // A sign-in hashes for real, and each test signs several people in
          testTimeout: 20_000,
        },
      },
    ],
  },
});
