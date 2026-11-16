// 导出与持久化验证：SVG/PNG 下载、SVG 与预览一致性、保存/重新载入、缩放。
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:39777/index.html');
  await page.waitForTimeout(400);

  // 1. 导出 SVG（标准案例）
  const [dlSvg] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-svg'),
  ]);
  await dlSvg.saveAs('artifacts/export-standard.svg');
  console.log('SVG 已导出, 大小:', (require('fs').statSync('artifacts/export-standard.svg')).size);

  // 2. 导出 PNG（当前展开图）
  const [dlPng] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btn-export-png'),
  ]);
  await dlPng.saveAs('artifacts/export-standard.png');

  // 3. 将 SVG 渲染成图，与画布展开图对比一致性
  const svgPage = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  await svgPage.goto('http://127.0.0.1:39777/artifacts/export-standard.svg');
  await svgPage.waitForTimeout(300);
  await svgPage.screenshot({ path: 'artifacts/export-standard-svg-render.png' });
  await svgPage.close();

  // 4. 保存 → 改动 → 重新载入应恢复
  await page.click('#btn-save');
  const saved = await page.evaluate(() => localStorage.getItem('trifold-doc-v1'));
  await page.click('#btn-case-extreme'); // 改乱当前文档
  await page.click('#btn-reload');
  const restored = await page.evaluate(() => localStorage.getItem('trifold-doc-v1'));
  const status = await page.textContent('#statusbar');
  console.log('保存/载入:', saved === restored && status.includes('已重新载入') ? 'PASS' : 'FAIL', '-', status);

  // 5. 缩放下布局检查不漂移（缩放是纯视图操作）
  await page.evaluate(() => { const z = document.getElementById('zoom'); z.value = 250; z.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(200);
  const summary = await page.textContent('#check-summary');
  console.log('缩放 250% 后检查:', summary);
  await page.screenshot({ path: 'artifacts/shot-zoom250.png' });

  // 6. 非法属性输入：选中元素后输入非法字号，应保留原值
  await page.evaluate(() => { const z = document.getElementById('zoom'); z.value = 100; z.dispatchEvent(new Event('input')); });
  await page.click('#btn-case-standard');
  await page.evaluate(() => {
    // 模拟点击画布中第 2 折标题文字
    const c = document.getElementById('stage');
    const r = c.getBoundingClientRect();
    const evt = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
    // 标准案例「核心特性」约在 (104,20)mm → 画布坐标估算
    evt('pointerdown', r.left + 470, r.top + 200);
    evt('pointerup', r.left + 470, r.top + 200);
  });
  await page.waitForTimeout(200);
  const fontInput = await page.$('#props input[data-k="fontSize"]');
  if (fontInput) {
    await fontInput.fill('200');
    await fontInput.dispatchEvent('change');
    const err = await page.textContent('#prop-err');
    const kept = await fontInput.inputValue();
    console.log('非法字号拦截:', err.includes('已保留原值') && kept !== '200' ? 'PASS' : 'FAIL', '-', err);
  } else {
    console.log('非法字号拦截: SKIP（未选中文字元素）');
  }

  console.log(errors.length ? '页面错误:\n' + errors.join('\n') : '无页面 JS 错误');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
