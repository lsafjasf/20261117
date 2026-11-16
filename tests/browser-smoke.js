/* tests/browser-smoke.js — 无头 Chrome 端到端冒烟测试 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const ART = path.join(ROOT, 'artifacts');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  PASS ' + name); }
  else { failed++; console.log('  FAIL ' + name); }
}

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const p = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/home/hj/.codex-relay-home-2cwdjny8/.cache/puppeteer/chrome/linux-157.0.8103.78/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  console.log('== 页面加载与默认渲染 ==');
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));
  check('页面无 JS 错误', errors.length === 0);

  const stats = await page.$eval('#stats', el => el.textContent);
  check('统计显示各层占比', /层1\(低\).*%/.test(stats) && /层3\(高\).*%/.test(stats));
  const layerRows = await page.$$('.layer-row');
  check('图层列表有 3 层', layerRows.length === 3);

  const pix1 = await page.$eval('#view', c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4013) sum += d[i] + d[i + 1] + d[i + 2];
    return sum;
  });
  check('画布非空白（有绘制内容）', pix1 > 0);
  await page.screenshot({ path: path.join(ART, 'preset-default.png') });

  console.log('== 异常参数：保留上一可用画面 ==');
  await page.click('#btn-pause'); // 先暂停动画，避免帧间差异干扰对比
  await new Promise(r => setTimeout(r, 200));
  const before = await page.$eval('#view', c => c.toDataURL());
  await page.$eval('input[data-key="shapeCount"]', el => {
    el.value = '99999';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 300));
  const status = await page.$eval('#status', el => el.textContent + '|' + el.className);
  check('状态栏显示错误原因', /参数无效/.test(status) && /超出范围/.test(status));
  check('状态栏为错误样式', status.indexOf('error') !== -1);
  const afterBad = await page.$eval('#view', c => c.toDataURL());
  check('错误参数后画面未变白屏（与之前一致）', afterBad === before);
  const inputVal = await page.$eval('input[data-key="shapeCount"]', el => el.value);
  check('表单回滚到上一次有效值', inputVal === '36');
  await page.click('#btn-pause'); // 恢复播放
  await new Promise(r => setTimeout(r, 200));

  console.log('== 图层操作 ==');
  await page.$$eval('.layer-row input[type="checkbox"]', boxes => boxes[0].click());
  await new Promise(r => setTimeout(r, 200));
  const afterHide = await page.$eval('#view', c => c.toDataURL());
  check('隐藏层1后画面变化', afterHide !== before);
  await page.$$eval('.layer-row input[type="checkbox"]', boxes => boxes[0].click());

  console.log('== 缩放/平移与刷新恢复 ==');
  await page.$eval('#view', el => {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
  });
  await new Promise(r => setTimeout(r, 400)); // 等待防抖保存
  const zoomBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('uid845.layerEditor.v1')).view.zoom);
  check('缩放已持久化到 localStorage', zoomBefore > 1);
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  const zoomAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('uid845.layerEditor.v1')).view.zoom);
  check('刷新后视角恢复', Math.abs(zoomAfter - zoomBefore) < 1e-9);
  const statsAfter = await page.$eval('#stats', el => el.textContent);
  check('刷新后统计仍显示当前参数', /zoom 1\./.test(statsAfter));

  console.log('== 极端预设与导出 ==');
  await page.click('#btn-extreme');
  await new Promise(r => setTimeout(r, 500));
  const extremeStats = await page.$eval('#stats', el => el.textContent);
  check('极端预设生效（hue 分层）', extremeStats.indexOf('hue') !== -1);
  await page.screenshot({ path: path.join(ART, 'preset-extreme.png') });

  const exported = await page.evaluate(() => {
    const raw = localStorage.getItem('uid845.layerEditor.v1');
    const back = window.SceneCore.importState(raw);
    return { ok: back.ok, order: back.layers.map(l => l.id).join(','), n: back.params.shapeCount };
  });
  check('导出 JSON 可重新导入且层级顺序保持', exported.ok && exported.order === '0,1,2');
  check('极端预设对象数量=200', exported.n === 200);

  console.log('== 暂停 ==');
  await page.click('#btn-pause');
  const f1 = await page.$eval('#view', c => c.toDataURL());
  await new Promise(r => setTimeout(r, 400));
  const f2 = await page.$eval('#view', c => c.toDataURL());
  check('暂停后画面静止', f1 === f2);
  const pauseLabel = await page.$eval('#btn-pause', el => el.textContent);
  check('暂停按钮文案切换', pauseLabel === '继续');

  check('全程无 JS 运行时错误', errors.length === 0);
  if (errors.length) console.log('  错误详情: ' + errors.join(' | '));

  await browser.close();
  srv.close();
  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
