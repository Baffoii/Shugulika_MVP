import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // DB suites rebuild one shared ephemeral schema. Running test files in
    // parallel races those resets; the suite is small enough that deterministic
    // file-level sequencing is preferable.
    fileParallelism: false,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    // Integration/DB tests connect to a real Postgres and are opt-in (they run
    // only when DATABASE_URL is set — CI provides it, unit runs skip them).
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html", "json-summary", "lcov"],
      reportsDirectory: "./coverage",
      all: true,
      // Meaningful, security-relevant modules. Server/UI wiring that needs a live
      // DB or browser is exercised by the DB and e2e suites, not unit coverage.
      include: [
        "src/lib/rbac.ts",
        "src/lib/validation.ts",
        "src/lib/constants.ts",
        "src/lib/format.ts",
        "src/lib/resume-suggestions.ts",
        "src/lib/env.ts",
        "src/lib/cn.ts",
        "src/lib/candidate-completion.ts",
        "src/components/StatusBadge.tsx",
        "src/components/PlaceholderCard.tsx",
        "src/components/PlaceholderModules.tsx",
        "src/components/jobs/JobCard.tsx",
      ],
      thresholds: {
        statements: 75,
        branches: 75,
        functions: 75,
        lines: 75,
        // Stricter bars for the highest-risk logic (authz, validation, data-sharing).
        "src/lib/rbac.ts": { statements: 95, branches: 90, functions: 100, lines: 95 },
        "src/lib/validation.ts": { statements: 85, branches: 80, functions: 90, lines: 85 },
        "src/lib/resume-suggestions.ts": { statements: 85, branches: 80, functions: 90, lines: 85 },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./src/test/stubs/server-only.ts"),
    },
  },
});
