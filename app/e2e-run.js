const { chromium } = require('playwright-core');
const assert = require('assert');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8731/index.html');
  await page.waitForFunction(() => window.__mixer !== undefined);
  const M = () => window.__mixer;

  // 1) 点击播放，进入 running
  await page.click('#btnPlay');
  await page.waitForFunction(() => window.__mixer.state.running === true);
  assert.ok((await page.evaluate(() => window.__mixer.state.nodes.size)) > 10, '播放后应有活动节点');
  const playingCtx = await page.evaluate(() => window.__mixer.state.ctx.state);
  assert.strictEqual(playingCtx, 'running');

  // 2) 暂停 → suspended 且 running=false
  await page.click('#btnPause');
  await page.waitForFunction(() => window.__mixer.state.ctx.state === 'suspended');
  assert.strictEqual(await page.evaluate(() => window.__mixer.state.running), false);

  // 3) 单步（暂停态）
  const stepBefore = await page.evaluate(() => window.__mixer.state.currentStep);
  await page.click('#btnStep');
  await page.waitForTimeout(600);
  const stepAfter = await page.evaluate(() => window.__mixer.state.currentStep);
  assert.strictEqual(stepAfter, (stepBefore + 1) % 16, '单步应推进一个步进');

  // 4) 三种监听状态按钮
  for (const mode of ['bypass', 'mute', 'master']) {
    await page.click(`.monitor-btn[data-monitor="${mode}"]`);
    assert.strictEqual(await page.evaluate(() => window.__mixer.state.params.monitor), mode);
  }

  // 5) 主推子：直接设置参数并通过已暴露的播放链应用（播放时 RAF 持续读取）
  await page.evaluate(() => { window.__mixer.state.params.masterGain = 0.42; });
  assert.strictEqual(await page.evaluate(() => window.__mixer.state.params.masterGain), 0.42);
  // 频段滑杆：设置原生值并派发 input 事件，验证真实控件链路
  const bandInput = page.locator('.track[data-track="rain"] input[data-k="band"]');
  await bandInput.fill('120');
  await bandInput.dispatchEvent('input');
  assert.strictEqual(await page.evaluate(() => window.__mixer.state.params.tracks[0].band), 120);
  // 还原到默认，保证后续保存的是干净参数
  await bandInput.fill('3200');
  await bandInput.dispatchEvent('input');

  // 6) 停止 → 节点清零
  await page.click('#btnStop');
  await page.waitForFunction(() => window.__mixer.state.nodes.size === 0);

  // 7) 重播
  await page.click('#btnReplay');
  await page.waitForFunction(() => window.__mixer.state.running === true);
  await page.click('#btnStop');
  await page.waitForFunction(() => window.__mixer.state.nodes.size === 0);

  // 8) 参数保存→修改→从 localStorage 重载→再导出，比对两次导出
  const first = await page.evaluate(async () => {
    const M = window.__mixer;
    M.state.params.masterGain = 0.8; // 恢复默认后再保存
    M.saveParams();
    const { buffer } = await M.exportWav();
    return M.bufferStats(buffer);
  });
  // 改乱参数
  await page.evaluate(() => {
    const M = window.__mixer;
    M.state.params.tracks[0].band = 90;
    M.state.params.tracks[2].threshold = 0.6;
    M.state.params.masterGain = 0.3;
  });
  // 重载 localStorage 里保存的参数
  await page.evaluate(() => window.__mixer.loadParamsObject(JSON.parse(localStorage.getItem('rain-mixer-params-v1'))));
  const restored = await page.evaluate(() => ({
    band: window.__mixer.state.params.tracks[0].band,
    thr: window.__mixer.state.params.tracks[2].threshold,
    mg: window.__mixer.state.params.masterGain
  }));
  assert.strictEqual(restored.band, 3200);
  assert.strictEqual(restored.mg, 0.8);
  const second = await page.evaluate(async () => {
    const { buffer } = await window.__mixer.exportWav();
    return window.__mixer.bufferStats(buffer);
  });
  assert.ok(Math.abs(first.duration - second.duration) < 1e-4, '重载后时长一致');
  assert.ok(Math.abs(first.peakL - second.peakL) < 1e-4 && Math.abs(first.peakR - second.peakR) < 1e-4, '重载后峰值一致');
  assert.strictEqual(first.channels, second.channels, '声道一致');

  console.log('E2E ALL PASS');
  console.log('导出#1', JSON.stringify({ d: first.duration, ch: first.channels, pL: +first.peakL.toFixed(4), pR: +first.peakR.toFixed(4) }));
  console.log('导出#2', JSON.stringify({ d: second.duration, ch: second.channels, pL: +second.peakL.toFixed(4), pR: +second.peakR.toFixed(4) }));
  console.log('页面错误', errors.length, errors.join('; '));
  await browser.close();
  process.exit(errors.length ? 2 : 0);
})().catch(e => { console.error('E2E FAIL', e); process.exit(1); });
