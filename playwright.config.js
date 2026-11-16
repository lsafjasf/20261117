export default {
  testDir: './e2e',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:8742',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'PORT=8742 node server.js',
    url: 'http://localhost:8742',
    reuseExistingServer: !process.env.CI,
    timeout: 20000,
  },
};
