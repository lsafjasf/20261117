import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join } from 'path';

const root = new URL('..', import.meta.url).pathname;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.wav': 'audio/wav' };
const server = createServer(async (req, res) => {
  try {
    const p = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    const data = await readFile(p);
    res.writeHead(200, { 'content-type': mime[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('http://127.0.0.1:' + port + '/');
await page.waitForTimeout(1500);

// 1. 播放 → 暂停:节点建立又全部关闭
await page.click('#btnPlay');
await page.waitForTimeout(800);
const playing = await page.evaluate(() => ({
  state: engine.state, nodes: engine.activeNodeCount(), t: engine.playhead(),
}));
await page.click('#btnPause');
await page.waitForTimeout(200);
const paused = await page.evaluate(() => ({
  state: engine.state, graphs: engine.clipGraphs.length, t: engine.offset,
  lv: engine.levels(),
}));

// 2. 单步
await page.click('#btnStep');
await page.waitForTimeout(600);
const stepped = await page.evaluate(() => ({ state: engine.state, t: engine.offset }));

// 3. 重播 + 监听状态切换
await page.click('#btnReplay');
await page.waitForTimeout(300);
await page.click('#monBypass');
await page.click('#monMute');
await page.click('#monMain');
await page.click('#btnStop');

// 4. 导出 WAV(拦截下载,校验文件头)
const dlPromise = page.waitForEvent('download');
await page.click('#btnExport');
const dl = await dlPromise;
const dlPath = await dl.path();
const wav = await readFile(dlPath);
const wavInfo = {
  riff: wav.toString('ascii', 0, 4), wave: wav.toString('ascii', 8, 12),
  channels: wav.readUInt16LE(22), sampleRate: wav.readUInt32LE(24),
  bits: wav.readUInt16LE(34), dataBytes: wav.readUInt32LE(40),
};

// 5. 完整自动验证
await page.click('#btnVerify');
await page.waitForFunction(
  () => document.getElementById('verifyOut').textContent.includes('验证结束'),
  { timeout: 120000 });
const verifyText = await page.evaluate(() => document.getElementById('verifyOut').textContent);

console.log('== 播放中 ==', JSON.stringify(playing));
console.log('== 暂停后 ==', JSON.stringify(paused));
console.log('== 单步后 ==', JSON.stringify(stepped));
console.log('== WAV 头 ==', JSON.stringify(wavInfo));
console.log('== 页面错误 ==', errors.length ? errors.join('\n') : '(无)');
console.log('== 验证输出 ==');
console.log(verifyText);

await browser.close();
server.close();
const fails = (verifyText.match(/✗/g) || []).length;
console.log(fails === 0 && errors.length === 0 ? 'E2E PASS' : 'E2E FAIL');
process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
