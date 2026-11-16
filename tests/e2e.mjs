// 真实浏览器端到端验证：播放/暂停、模式切换、四维变化、WAV 导出与参数重载回归。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const data = await readFile(path.join(root, urlPath));
    res.writeHead(200, { 'Content-Type': mime[path.extname(urlPath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

await new Promise((r) => server.listen(4593, r));
const exe = process.env.CHROMIUM_PATH
  || '/home/hj/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const assert = (cond, label) => {
  if (!cond) { console.error(`✗ ${label}`); process.exitCode = 1; }
  else console.log(`✔ ${label}`);
};

try {
  await page.goto('http://localhost:4593/');
  await page.waitForSelector('#roomCanvas');

  // 1. 播放后出现活动节点，暂停后必须归零。
  await page.click('#playBtn');
  await page.waitForFunction(() => document.getElementById('nodeReadout').textContent.includes('节点') &&
    !document.getElementById('nodeReadout').textContent.includes('节点 0'));
  const playingNodes = await page.textContent('#nodeReadout');
  assert(!playingNodes.includes('节点 0'), `播放时存在活动节点（${playingNodes.trim()}）`);
  await page.waitForTimeout(500);
  await page.click('#playBtn');
  await page.waitForFunction(() => document.getElementById('nodeReadout').textContent.includes('节点 0'));
  assert(true, '暂停后活动节点归零，无未关闭节点');

  // 2. 模式切换保留声源位置。
  const before = await page.evaluate(() => window.__getState().sources.map((s) => [s.x, s.y]));
  await page.click('#modeSeg button[data-mode="binaural"]');
  await page.click('#modeSeg button[data-mode="surround"]');
  const after = await page.evaluate(() => window.__getState().sources.map((s) => [s.x, s.y]));
  assert(JSON.stringify(before) === JSON.stringify(after), '立体声→双耳→环绕切换后声源位置未重置');
  const mode = await page.evaluate(() => window.__getState().mode);
  assert(mode === 'surround', '当前模式为环绕');

  // 3. 试听三态切换无报错。
  for (const audition of ['bypass', 'mute', 'main']) {
    await page.click(`#auditionSeg button[data-audition="${audition}"]`);
  }
  const audition = await page.evaluate(() => window.__getState().audition);
  assert(audition === 'main', '主输出/旁路/静音三态可切换');

  // 4. 单步触发。
  await page.click('#stepBtn');
  const stepText = await page.textContent('#stepReadout');
  assert(/节拍 [2-8]/.test(stepText.trim()), `单步推进节拍指针（${stepText.trim()}）`);

  // 5. 完整回归：两次离线导出对比 + 重载后播放 + 暂停清洁。
  const result = await page.evaluate(() => window.__regression());
  await page.waitForTimeout(1200);
  const logText = await page.textContent('#logPanel');
  assert(logText.includes('全部一致'), '参数重载后两次 WAV 导出时长/声道/峰值一致');
  assert(logText.includes('无未关闭节点'), '重载后播放→暂停清洁自检通过');

  // 6. 四维验证：移动监听点、改频率、改 BPM 后至少三维真实变化。
  await page.click('#snapshotBtn');
  await page.evaluate(() => {
    const s = window.__getState();
    s.listener.x = 90; s.listener.y = 80;
    s.sources[0].freq = 880; s.bpm = 140;
  });
  await page.click('#snapshotBtn');
  await page.waitForFunction(() => document.querySelector('#verifyPanel')?.textContent.includes('满足至少三维'));
  const verifyText = await page.textContent('#verifyPanel');
  assert(verifyText.includes('满足至少三维'),
    '左右声道/频段/延迟/节拍四维真实变化验证通过');

  // 7. WAV 下载确实产出文件（监听下载事件）。
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#exportWavBtn'),
  ]);
  assert(download.suggestedFilename().endsWith('.wav'), `导出 WAV 文件：${download.suggestedFilename()}`);

  assert(errors.length === 0, `浏览器控制台无错误（${errors.join(' | ')}）`);
} finally {
  await browser.close();
  server.close();
}
