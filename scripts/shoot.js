// 真实浏览器截图：初始态、运行态、故障态，验证 Canvas 渲染与面板
const { chromium } = require('/tmp/node_modules/playwright-core');

(async () => {
  const exe = '/home/hj/.codex-relay-home-8p11pn5a/.cache/ms-playwright/' +
    'chromium-1255/chrome-linux64/chrome';
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8923/index.html');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'artifacts/01-initial.png' });

  // 正常工况运行 2 秒
  await page.click('#btnRun');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'artifacts/02-running.png' });

  // 暂停 + 单步
  await page.click('#btnPause');
  await page.click('#btnStep');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'artifacts/03-paused-step.png' });

  // 故障工况
  await page.click('#btnReset');
  await page.fill('#in-current', '62');
  await page.dispatchEvent('#in-current', 'input');
  await page.click('#btnRun');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'artifacts/04-fault.png' });

  // 回放
  await page.click('#btnReplay');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'artifacts/05-replay.png' });

  // 趋势图切换（先重置进入干净工况）
  await page.click('#btnReset');
  await page.fill('#in-current', '40');
  await page.dispatchEvent('#in-current', 'input');
  const tabs = await page.$$('#metricTabs button');
  await tabs[2].click();
  await page.click('#btnRun');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'artifacts/06-trend-temp.png' });

  console.log('页面错误:', errors.length ? errors : '无');
  await browser.close();
})();
