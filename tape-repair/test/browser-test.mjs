import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const mime = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.wav': 'audio/wav',
};

const server = createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const data = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': mime[extname(path)] || 'text/plain' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const url = `http://127.0.0.1:${port}/index.html`;

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(url);
await page.waitForSelector('input[data-key="speed"]');

await page.click('#btnPlay');
await page.waitForFunction(() =>
  document.getElementById('nodeLabel').textContent.includes('14'));
await page.waitForFunction(() =>
  parseFloat(document.getElementById('barL').style.width) > 0 &&
  parseFloat(document.getElementById('barR').style.width) > 0,
  { timeout: 5000 });
const playingMeters = await page.evaluate(() => ({
  l: document.getElementById('barL').style.width,
  r: document.getElementById('barR').style.width,
  nodes: document.getElementById('nodeLabel').textContent,
  mode: document.getElementById('modeLabel').textContent,
}));
assert.ok(parseFloat(playingMeters.l) > 0, 'L meter moves while playing');
assert.ok(parseFloat(playingMeters.r) > 0, 'R meter moves while playing');

assert.ok(playingMeters.nodes.includes('14'), '14 active nodes, got ' +
  playingMeters.nodes);

await page.click('#btnPause');
await page.waitForTimeout(300);
const pauseInfo = await page.textContent('#exportInfo');
assert.ok(pauseInfo.includes('确认无声音、无尾音'), 'pause silence: ' + pauseInfo);
const pausedMeters = await page.evaluate(() => ({
  l: document.getElementById('barL').style.width,
  r: document.getElementById('barR').style.width,
}));
assert.equal(pausedMeters.l, '0%', 'L meter zeroed on pause');
assert.equal(pausedMeters.r, '0%', 'R meter zeroed on pause');

const posBeforeStep = await page.evaluate(() => window.__engine.position);
await page.click('#btnStep');
await page.waitForTimeout(150);
const stepInfo = await page.evaluate(() =>
  document.getElementById('timeLabel').textContent);
const posAfterStep = await page.evaluate(() => window.__engine.position);
const stepDelta = posAfterStep - posBeforeStep;
assert.ok(stepDelta === 128,
  'single step advances one quantum: ' + stepInfo);

await page.click('#btnReplay');
await page.waitForTimeout(200);
const replayPos = await page.evaluate(() =>
  document.getElementById('timeLabel').textContent);
assert.ok(/0\.\d\d/.test(replayPos), 'replay restarts');

await page.click('#btnMute');
const muteMode = await page.textContent('#modeLabel');
assert.ok(muteMode.includes('静音'), 'mute mode shown');
await page.click('#btnBypass');
assert.ok((await page.textContent('#modeLabel')).includes('旁路'));
await page.click('#btnMain');

await page.click('#btnExport');
await page.waitForSelector('#downloadLink:not(.hidden)');
const exportInfo = await page.textContent('#exportInfo');
assert.ok(exportInfo.includes('导出成功'), 'export ok: ' + exportInfo);
assert.ok(/10\.\d{3}s/.test(exportInfo), '~10s duration: ' + exportInfo);
assert.ok(exportInfo.includes('2 声道'), 'stereo export');

await page.click('#btnSave');
const saveInfo = await page.textContent('#saveInfo');
assert.ok(saveInfo.includes('已保存'), 'params saved');

const stored = await page.evaluate(() => localStorage.getItem('tape-repair-params-v1'));
assert.ok(stored && stored.includes('"speed"'), 'localStorage has params');

await page.click('#btnExportReload');
await page.waitForFunction(() =>
  document.getElementById('exportCompare').querySelector('table') !== null);
const compareRows = await page.$$eval('#exportCompare tr',
  (rows) => rows.slice(1).map((r) => r.textContent));
for (const row of compareRows) {
  assert.ok(row.includes('通过'), 'compare failed: ' + row);
}

await page.click('#btnVerify');
await page.waitForFunction(() =>
  document.getElementById('verifyResults').querySelector('table') !== null,
  { timeout: 60000 });
const verifyRows = await page.$$eval('#verifyResults tr',
  (rows) => rows.slice(1).map((r) => r.textContent));
assert.ok(verifyRows.length >= 8, 'expected >= 8 checks, got ' + verifyRows.length);
for (const row of verifyRows) {
  assert.ok(row.includes('通过'), 'verification failed: ' + row);
}

await page.reload();
await page.waitForSelector('#saveInfo');
const afterReload = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('tape-repair-params-v1')));
assert.ok(afterReload.savedAt, 'params survive reload');
await page.click('#btnLoad');
await page.waitForTimeout(500);
const reloadPlay = await page.evaluate(() =>
  document.getElementById('modeLabel').textContent);
assert.ok(reloadPlay, 'reloaded and playback started');

const clipBlocked = await page.evaluate(async () => {
  const p = Object.assign({}, window.TapeParams.DEFAULTS, { outputGain: 1.5 });
  const r = await window.AudioEngine.renderOffline(p, 10, 48000);
  const s = window.AudioMetrics.peakAndClip(r.channels);
  return { clipped: s.clipped, peak: s.peak };
});
assert.ok(clipBlocked.clipped > 0, 'clipping detected at gain 1.5');

const dimensionCheck = await page.evaluate(async () => {
  const base = window.TapeParams.DEFAULTS;
  const r1 = await window.AudioEngine.renderOffline(base, 10, 48000);
  const r2 = await window.AudioEngine.renderOffline(
    Object.assign({}, base, { speed: 0.75 }), 10, 48000);
  const r3 = await window.AudioEngine.renderOffline(
    Object.assign({}, base, { notchFreq: 3300, notchQ: 28, deessGain: -20 }),
    10, 48000);
  const s1 = window.AudioMetrics.summarize(r1.channels, r1.sampleRate,
    window.TapeVerify.BANDS);
  const s2 = window.AudioMetrics.summarize(r2.channels, r2.sampleRate,
    window.TapeVerify.BANDS);
  const s3 = window.AudioMetrics.summarize(r3.channels, r3.sampleRate,
    window.TapeVerify.BANDS);
  return {
    durationChanged: Math.abs(s1.durationSec - s2.durationSec) > 1,
    beatChanged: Math.abs(s1.beat.mean - s2.beat.mean) > 0.05,
    bandChanged: Math.abs(s1.bands.notch - s3.bands.notch) /
      (s1.bands.notch + 1e-12) > 0.2,
    stereo: s1.balance.diff > 0.001,
    drift: s1.beat.maxDriftSec,
  };
});
assert.ok(dimensionCheck.durationChanged, 'duration changes with speed');
assert.ok(dimensionCheck.beatChanged, 'beat interval changes with speed');
assert.ok(dimensionCheck.bandChanged, 'band energy changes with notch');
assert.ok(dimensionCheck.stereo, 'L/R channels differ');
assert.ok(dimensionCheck.drift < 0.02, 'no beat drift');

const modeCheck = await page.evaluate(async () => {
  const base = window.TapeParams.DEFAULTS;
  const render = (mode) => window.AudioEngine.renderOffline(
    Object.assign({}, base, { mode }), 2, 48000);
  const main = await render('main');
  const bypass = await render('bypass');
  const mute = await render('mute');
  const peakOf = (r) => {
    let pk = 0;
    for (const ch of r.channels)
      for (const v of ch) pk = Math.max(pk, Math.abs(v));
    return pk;
  };
  return {
    mainPeak: peakOf(main),
    bypassPeak: peakOf(bypass),
    mutePeak: peakOf(mute),
  };
});
assert.ok(modeCheck.mutePeak === 0, 'mute renders silence');
assert.ok(modeCheck.mainPeak > 0 && modeCheck.bypassPeak > 0,
  'main and bypass both produce sound');
assert.ok(Math.abs(modeCheck.mainPeak - modeCheck.bypassPeak) > 1e-4,
  'bypass differs from repaired chain');

await page.fill('input[data-key="outputGain"]', '1.5');
await page.waitForTimeout(100);
await page.click('#btnExport');
await page.waitForTimeout(500);
const blockedInfo = await page.textContent('#exportInfo');
assert.ok(blockedInfo.includes('导出被阻止'),
  'clipping blocks UI export: ' + blockedInfo);
assert.ok((await page.$('#downloadLink.hidden')) !== null,
  'no download link while blocked');
await page.click('#btnReset');

assert.equal(errors.length, 0, 'console/page errors: ' + errors.join(' | '));

await browser.close();
server.close();
console.log('browser-test: all assertions passed');
console.log('  verify rows:', verifyRows.length);
console.log('  compare rows:', compareRows.length);
process.exit(0);
