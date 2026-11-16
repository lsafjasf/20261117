import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4389",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath: "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
      args: [
        "--autoplay-policy=no-user-gesture-required",
        "--disable-dev-shm-usage",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  webServer: {
    command: "npm run dev -- --port 4389",
    url: "http://127.0.0.1:4389",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
