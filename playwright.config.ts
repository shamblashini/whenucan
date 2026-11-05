import { defineConfig, devices } from "@playwright/test";

const port = 5189;
const state = ".wrangler/e2e";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  // Set PW_CHROMIUM to reuse a Chromium you already have instead of running `playwright install`.
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec wrangler d1 migrations apply whenucan --local --persist-to ${state} && pnpm exec vite --port ${port}`,
    env: { E2E_STATE: state },
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
