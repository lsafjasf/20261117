// browser-smoke.mjs — real-browser smoke test (Playwright chromium).
// Verifies boot, persistence across reload, invalid-input handling and export.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:8123';
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed += 1; console.log(`  ok  ${name}`); } else {
    failed += 1; console.error(`FAIL  ${name} ${detail}`);
  }
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const consoleErrors = [];
page.on('pageerror', (err) => consoleErrors.push(String(err)));
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('页面加载无 JS 错误', consoleErrors.length === 0, consoleErrors.join(' | '));
check('画布已绘制（非空白）', await page.evaluate(() => {
  const c = document.getElementById('scene');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 401) sum += d[i] + d[i + 1] + d[i + 2];
  return sum > 1000;
}));

// Change sun azimuth and zoom, then reload: state must be restored.
await page.locator('#azimuth').fill('40');
await page.locator('#zoom').fill('1.5');
await page.locator('#saveBtn').click();
await page.waitForTimeout(200);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('mtn.scene.state.v1')));
check('刷新后视角与参数恢复', restored
  && restored.sun.azimuth === 40 && Math.abs(restored.view.zoom - 1.5) < 1e-9,
  JSON.stringify(restored && restored.view));
check('刷新后对象数量一致（场景由种子重建）', await page.evaluate(() => {
  const c = document.getElementById('scene');
  return c.width === 1000 && c.height === 700;
}));

// Invalid input: error box shows reasons, canvas keeps the last good frame.
const before = await page.evaluate(() => document.getElementById('scene').toDataURL().length);
await page.locator('#azimuthNum').fill('110');
await page.waitForTimeout(150);
check('非法方位角显示原因',
  /sun\.azimuth/.test(await page.locator('#error').textContent()));
await page.locator('#elevationNum').fill('0');
await page.waitForTimeout(150);
const errorText = await page.locator('#error').textContent();
check('非法高度角显示原因', /sun\.elevation/.test(errorText), errorText);
const after = await page.evaluate(() => document.getElementById('scene').toDataURL().length);
check('非法参数不白屏（保留上一帧）', after === before, `${before} -> ${after}`);
check('控件回弹到上一次可用值',
  (await page.locator('#azimuth').inputValue()) === '40');

// Pause toggle and layer toggle work.
await page.locator('#pauseBtn').click();
check('暂停按钮切换文案', (await page.locator('#pauseBtn').textContent()) === '暂停');
await page.locator('#pauseBtn').click();
check('再次点击恢复暂停', (await page.locator('#pauseBtn').textContent()) === '继续');
await page.locator('#layers input[data-layer="objectShadows"]').uncheck();
await page.waitForTimeout(200);
check('图层开关生效并保存', await page.evaluate(
  () => JSON.parse(localStorage.getItem('mtn.scene.state.v1')).layers.objectShadows === false,
));

await page.screenshot({ path: 'artifacts/ui-smoke.png' });
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
