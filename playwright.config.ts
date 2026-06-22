import { defineConfig, devices } from "@playwright/test";

// End-to-end tests that drive the real app in a browser — currently the board
// drag-and-drop, which can only be verified with genuine pointer events. Opt-in
// (`bun run test:e2e`), separate from the fast `bun test` unit suite. Needs a
// browser once: `bunx playwright install chromium`.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  use: { baseURL: "http://localhost:8000", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Boots `bun run dev` if nothing is already serving :8000.
  webServer: {
    command: "bun run dev",
    url: "http://localhost:8000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
