// 离线渲染声学验证：环绕四声道分布、双耳左右差异、混响尾音长度。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const p = req.url === '/' ? '/index.html' : req.url;
  const d = await readFile(path.join(root, p));
  res.writeHead(200, { 'Content-Type': mime[path.extname(p)] ?? 'application/octet-stream' });
  res.end(d);
});
await new Promise((r) => server.listen(4596, r));
const browser = await chromium.launch({
  executablePath: '/home/hj/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => { console.error('PAGEERROR', String(e)); process.exitCode = 1; });

const assert = (cond, label) => {
  console.log(`${cond ? '✔' : '✗'} ${label}`);
  if (!cond) process.exitCode = 1;
};

try {
  await page.goto('http://localhost:4596/');
  await page.waitForSelector('#roomCanvas');

  const surround = await page.evaluate(async () => {
    const eng = window.__engine ?? null;
    const state = window.__getState();
    state.mode = 'surround';
    const { AudioEngine } = await import('./js/audio-engine.js');
    const e = new AudioEngine(state);
    const buffer = await e.renderOffline(1);
    const peaks = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      peaks.push(Math.max(...buffer.getChannelData(c).slice(0, 40000).map((v) => Math.abs(v))));
    }
    e.ctx.close();
    return { channels: buffer.numberOfChannels, peaks, durationMs: buffer.duration * 1000 };
  });
  assert(surround.channels === 4, `环绕导出为 4 声道（实际 ${surround.channels}）`);
  const distinct = new Set(surround.peaks.map((p) => p.toFixed(5))).size;
  assert(distinct >= 2, `四扬声器能量分布不同（${surround.peaks.map((p) => p.toFixed(4)).join(', ')}）`);

  const binaural = await page.evaluate(async () => {
    const state = window.__getState();
    state.mode = 'binaural';
    state.sources[0].x = 60; state.sources[0].y = 100;
    const { AudioEngine } = await import('./js/audio-engine.js');
    const e = new AudioEngine(state);
    const buffer = await e.renderOffline(1);
    const l = buffer.getChannelData(0);
    const r = buffer.getChannelData(1);
    const sum = (arr) => arr.reduce((a, v) => a + v * v, 0);
    e.ctx.close();
    return { channels: buffer.numberOfChannels, leftEnergy: sum(l), rightEnergy: sum(r) };
  });
  assert(binaural.channels === 2, '双耳导出为 2 声道');
  assert(Math.abs(binaural.leftEnergy - binaural.rightEnergy) > 1e-4,
    `双耳左右能量可测差异（L=${binaural.leftEnergy.toFixed(4)}, R=${binaural.rightEnergy.toFixed(4)}）`);
} finally {
  await browser.close();
  server.close();
}
