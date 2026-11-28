import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: false,
  workers: 1,
  retries: 2,
  timeout: 30_000,
  reporter: [["list"], ["json", { outputFile: "test-results/prod-smoke-report.json" }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://apoiaseguro.com.br",
    browserName: "chromium",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
