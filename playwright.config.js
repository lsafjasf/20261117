export default {
  testDir: './test',
  testMatch: 'browser.test.js',
  timeout: 90000,
  expect: { timeout: 15000 },
  globalTimeout: 900000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'node tools/serve.js',
    url: 'http://127.0.0.1:4783/',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
};
