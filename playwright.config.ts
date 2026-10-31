import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertDisposableDatabase } from "./tests/safety";

assertDisposableDatabase();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: "test-results/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-report.json" }]],
  use: {
    baseURL: "http://localhost:3000",
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000/api/saude",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { NEXT_TELEMETRY_DISABLED: "1", ANTHROPIC_API_KEY: "", RESEND_API_KEY: "", EMAIL_TRANSPORT: "file" },
  },
});
