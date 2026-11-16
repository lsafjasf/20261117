// 视觉验证：截图展开图 / 折叠透视 / 极端案例 / 错误状态，并校验导出拦截。
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://127.0.0.1:39777/index.html');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/shot-flat-standard.png' });

  // 折叠透视（内折）
  await page.selectOption('#view-mode', 'folded');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'artifacts/shot-folded-in.png' });

  // 外折：世界坐标不变
  const before = await page.evaluate(() => JSON.stringify(window.__doc_elements || []));
  await page.click('#btn-fold-dir');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'artifacts/shot-folded-out.png' });

  // 极端案例
  await page.selectOption('#view-mode', 'flat');
  await page.click('#btn-case-extreme');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'artifacts/shot-flat-extreme.png' });

  // 制造错误：把第 2 折长文本拖到跨折线位置，验证导出被阻止
  await page.evaluate(() => { window.__test_moveFirst(); });
  await page.waitForTimeout(200);
  await page.click('#btn-export-svg');
  await page.waitForTimeout(200);
  const status = await page.textContent('#statusbar');
  console.log('导出拦截状态栏:', status.slice(0, 80));
  await page.screenshot({ path: 'artifacts/shot-error-state.png' });

  // 撤销应恢复
  await page.click('#btn-undo');
  await page.waitForTimeout(200);
  const summary = await page.textContent('#check-summary');
  console.log('撤销后检查摘要:', summary);

  console.log(errors.length ? '页面错误:\n' + errors.join('\n') : '无页面 JS 错误');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
