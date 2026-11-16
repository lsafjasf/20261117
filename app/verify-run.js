const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  await page.goto('http://127.0.0.1:8731/index.html');
  await page.waitForFunction(() => window.__mixer !== undefined);
  const pass = await page.evaluate(() => window.__mixer.runVerification());
  const report = await page.evaluate(() => document.getElementById('verifyReport').innerText);
  console.log(report);
  console.log('\n=== 页面错误 ' + errors.length + ' 条 ===');
  errors.forEach(e => console.log(' - ' + e));
  console.log('\nVERDICT: ' + (pass ? 'ALL PASS' : 'HAS FAILURES'));
  await browser.close();
  process.exit(pass && errors.length === 0 ? 0 : 2);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
