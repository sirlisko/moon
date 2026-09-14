import { defineConfig } from "vitest/config";

// Scoped to src/*.test.ts only — tests/*.spec.js is the separate
// Playwright E2E suite (different test API, run via `pnpm test`) and must
// never be picked up by Vitest's own runner.
export default defineConfig({
  test: {
    include: ["src/*.test.ts"],
    exclude: ["tests/**", "node_modules/**"],
  },
});
