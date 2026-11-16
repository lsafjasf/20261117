import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 45_000,
  expect: {
    timeout: 8_000
  },
  use: {
    baseURL: "http://127.0.0.1:4317",
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure"
  },
  webServer: {
    command: "PORT=4317 node server.mjs",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: true,
    timeout: 20_000
  },
  reporter: [["list"]]
});
