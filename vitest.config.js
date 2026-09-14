import { defineConfig } from "vitest/config";

// Scoped to root-level *.test.js only — tests/*.spec.js is the separate
// Playwright E2E suite (different test API, run via `pnpm test`) and must
// never be picked up by Vitest's own runner.
export default defineConfig({
  test: {
    include: ["*.test.js"],
    exclude: ["tests/**", "node_modules/**"],
  },
});
