import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /ui-smoke\.spec\.js/,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4181",
    headless: true
  },
  webServer: {
    command: "PORT=4181 node server.js",
    url: "http://127.0.0.1:4181",
    reuseExistingServer: true,
    timeout: 10_000
  }
});
