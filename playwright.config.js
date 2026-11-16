import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5183',
    headless: true,
    viewport: { width: 1440, height: 1100 },
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
    },
  },
  webServer: {
    command: 'node scripts/serve.js',
    url: 'http://127.0.0.1:5183',
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
