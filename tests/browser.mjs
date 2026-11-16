// Browser smoke test (playwright-core + cached headless chromium).
// Run: node tests/browser.mjs
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const EXE = '/home/hj/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const ROOT = new URL('..', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    const path = normalize(join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]));
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(8931, r));
const BASE = 'http://localhost:8931/index.html';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.error(`FAIL  ${name} ${detail}`); }
}

const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// 1. canvas actually renders non-uniform content
const px = await page.evaluate(() => {
  const c = document.getElementById('canvas');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4013 * 4) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
  return seen.size;
});
check('画布渲染非空白(多种颜色)', px > 8, `distinct=${px}`);

const stats1 = await page.textContent('#stats');
check('状态栏显示等高线数量', /等高线: [1-9]/.test(stats1), stats1);
await page.screenshot({ path: 'artifacts/view-default.png' });

// 2. invalid params -> error shown, previous frame kept
const before = await page.evaluate(() => document.getElementById('canvas').toDataURL().length);
await page.fill('#p-interval', '-5');
await page.fill('#p-smoothness', '99');
await page.click('#btn-apply');
await page.waitForTimeout(200);
const errVisible = await page.isVisible('#error-box');
const errText = await page.textContent('#error-box');
check('错误提示框可见', errVisible);
check('提示包含 interval 原因', errText.includes('interval') && errText.includes('范围'), errText);
check('提示包含 smoothness 原因', errText.includes('smoothness'), errText);
await page.waitForTimeout(400);
const after = await page.evaluate(() => document.getElementById('canvas').toDataURL().length);
check('错误参数后画面未白屏(帧仍渲染)', after > 10000 && Math.abs(after - before) < before * 0.3,
  `before=${before} after=${after}`);
const statsAfterErr = await page.textContent('#stats');
check('错误参数后对象数量不变', statsAfterErr === stats1, statsAfterErr);

// 3. extreme preset renders & screenshot
await page.click('#btn-preset-extreme');
await page.waitForTimeout(500);
const statsExt = await page.textContent('#stats');
check('极端预设生效(线数增加)', statsExt !== stats1 && /等高线: [1-9]/.test(statsExt), statsExt);
await page.screenshot({ path: 'artifacts/view-extreme.png' });

// 4. pause keeps frame, resume works
await page.click('#btn-pause');
await page.waitForTimeout(200);
const f1 = await page.evaluate(() => document.getElementById('canvas').toDataURL());
await page.waitForTimeout(300);
const f2 = await page.evaluate(() => document.getElementById('canvas').toDataURL());
check('暂停后画面静止', f1 === f2);
await page.click('#btn-pause');
await page.waitForTimeout(300);
const f3 = await page.evaluate(() => document.getElementById('canvas').toDataURL());
check('继续后动画恢复', f3 !== f1);

// 5. reload restores unsaved state (params/view/layers)
await page.click('#btn-preset-default');
await page.fill('#p-interval', '0.06');
await page.click('#btn-apply');
await page.evaluate(() => {
  const c = document.getElementById('canvas');
  c.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true, cancelable: true }));
});
await page.uncheck('#layer-terrain');
await page.waitForTimeout(300);
const statsPre = await page.textContent('#stats');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const statsPost = await page.textContent('#stats');
check('刷新后未保存状态恢复(对象数量/视角一致)', statsPost === statsPre,
  `pre=${statsPre} post=${statsPost}`);
const terrainChecked = await page.isChecked('#layer-terrain');
check('刷新后图层开关恢复', terrainChecked === false);

check('页面无 JS 异常', errors.length === 0, errors.join('; '));

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
