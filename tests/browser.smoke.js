/* Playwright 浏览器冒烟测试：node tests/browser.smoke.js */
const path = require('path');
const { chromium } = require('/tmp/pwtest/node_modules/playwright-core');

const fileUrl = 'file://' + path.join(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 940 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });

  await page.goto(fileUrl);
  await page.waitForFunction(() => document.querySelectorAll('#metricsTable tr').length > 1);
  console.log('PASS 页面加载，指标表渲染行数=' +
    (await page.locator('#metricsTable tr').count()));

  await page.click('#btnStep');
  await page.click('#btnStep');
  const clock2 = await page.locator('#clock').textContent();
  console.log('PASS 单步运行，时钟=' + clock2.trim());

  await page.click('.pump-btn[data-pump="2"]');
  const pumpActive = await page.locator('.pump-btn.active').textContent();
  console.log('PASS 手动干预高档泵，激活按钮=' + pumpActive.trim());

  await page.click('#btnPlay');
  await page.waitForTimeout(1500);
  await page.click('#btnPlay');
  const midClock = (await page.locator('#clock').textContent()).trim();
  console.log('PASS 连续运行后暂停，时钟=' + midClock);

  page.on('dialog', (d) => d.accept());
  await page.click('#btnBatch');
  await page.waitForFunction(() =>
    document.getElementById('runStatus').textContent.includes('一年结束'));
  const status = (await page.locator('#runStatus').textContent()).trim();
  const cpPass = await page.locator('.cp-pass').count();
  const logCount = await page.locator('.log-entry').count();
  console.log('PASS 跑批结束状态=' + status + '，通过检查点=' + cpPass +
    '，日志条数=' + logCount);

  await page.click('#btnRepro');
  await page.waitForTimeout(300);
  console.log('PASS 复现性自检弹窗已触发并确认');

  await page.click('#btnReset');
  const resetClock = (await page.locator('#clock').textContent()).trim();
  const sitesAfterReset = await page.locator('.site').count();
  console.log('PASS 重置后时钟=' + resetClock + '，位点数=' + sitesAfterReset);

  await page.screenshot({ path: path.join(__dirname, '..', 'artifacts',
    'screenshot-steady.png') });

  // 验证模式下推进到干旱临界窗口（约 D52）截图
  await page.evaluate(() => {
    document.getElementById('modeSelect').value = 'validation';
    document.getElementById('btnReset').click();
  });
  await page.click('#btnBatch');
  await page.waitForFunction(() =>
    document.getElementById('runStatus').textContent.includes('一年结束'));
  // 重置后用单步推进到 D53 捕获临界
  await page.evaluate(() => document.getElementById('btnReset').click());
  await page.evaluate(() => {
    const btn = document.getElementById('btnPlay');
    if (btn.textContent.includes('暂停')) btn.click();
  });
  const critHour = await page.evaluate(() => {
    const s = window.__sim;
    const d = window.__director;
    let hit = -1;
    for (let i = 0; i < 24 * 70 && !s.finished; i++) {
      d.beforeStep(s);
      s.step(1);
      d.afterStep(s);
      if (s.alarms.level.status === 'critical' && hit < 0) {
        hit = s.hour;
        break;
      }
    }
    return hit;
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(__dirname, '..', 'artifacts',
    'screenshot-drought.png') });
  const critBadge = await page.locator('.badge.critical').count();
  const critLogs = await page.locator('.log-entry.critical').count();
  console.log('PASS 干旱临界时刻徽章=' + critBadge + '，临界日志=' +
    critLogs + '，触发小时=' + critHour);
  if (critBadge < 1 || critHour < 0) {
    errors.push('干旱窗口未出现临界状态');
  }

  // 跑批到年末，截取处置失败卡片与年末达标总览
  await page.evaluate(() => {
    const s = window.__sim;
    const d = window.__director;
    while (!s.finished) {
      d.beforeStep(s);
      s.step(1);
      d.afterStep(s);
    }
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(__dirname, '..', 'artifacts',
    'screenshot-yearend.png'), fullPage: true });
  const failCards = await page.locator('.compare-card h4').allTextContents();
  const failCard = failCards.find((t) => t.includes('处置失败'));
  console.log('PASS 年末处置对比卡片含失败记录=' + (failCard ? '是' : '否') +
    '，共 ' + failCards.length + ' 张卡片');
  if (!failCard) errors.push('未找到处置失败对比卡片');

  if (errors.length) {
    console.log('FAIL 浏览器错误：\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('\n浏览器冒烟测试全部通过 ✔');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
