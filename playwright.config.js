import { defineConfig, devices } from "@playwright/test";

// A small, fast smoke suite, not exhaustive coverage — see tests/*.spec.js.
// webServer auto-starts the Vite dev server on a dedicated port so `pnpm
// test` never collides with a manually-running `pnpm dev`.
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5175",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm exec vite --port 5175 --strictPort",
    url: "http://localhost:5175",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
