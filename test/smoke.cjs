#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function loadPuppeteer() {
  try {
    return require('puppeteer');
  } catch (err) {
    const fallback = '/home/hj/userfeedback/uid824/node_modules/puppeteer';
    try {
      return require(fallback);
    } catch (fallbackErr) {
      console.error('需要 puppeteer：npm install 或设置 NODE_PATH。');
      process.exit(2);
    }
  }
}

function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const homes = [process.env.HOME, '/home/hj'].filter(Boolean);
  const home = homes[0];
  const candidates = [
    path.join(home, '.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome'),
    path.join(home, '.cache/pw/chrome-headless-shell-linux64/chrome-headless-shell')
  ];
  for (const root of homes) {
    candidates.push(path.join(root, '.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome'));
    candidates.push(path.join(root, '.cache/pw/chrome-headless-shell-linux64/chrome-headless-shell'));
  }
  try {
    const dirs = fs.readdirSync(path.join(home, '.cache/puppeteer/chrome'));
    for (const dir of dirs) {
      candidates.unshift(path.join(home, '.cache/puppeteer/chrome', dir, 'chrome-linux64/chrome'));
    }
  } catch (err) { /* use known candidates */ }
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const puppeteer = loadPuppeteer();
const root = path.dirname(__dirname);
const url = 'file://' + path.join(root, 'index.html');
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    console.log('PASS  ' + name + (detail ? ' :: ' + detail : ''));
  } else {
    failures.push(name + (detail ? ' :: ' + detail : ''));
    console.error('FAIL  ' + name + (detail ? ' :: ' + detail : ''));
  }
}

async function main() {
  const launch = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--allow-file-access-from-files'] };
  const executablePath = findChrome();
  if (executablePath) launch.executablePath = executablePath;
  const browser = await puppeteer.launch(launch);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((resolve) => setTimeout(resolve, 350));

  const initial = await page.evaluate(() => {
    const canvas = document.getElementById('scene');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 40) lit++;
    }
    return {
      lit,
      missionRows: document.querySelectorAll('.mission-row').length,
      resourceTracks: document.querySelectorAll('.resource-track').length,
      progress: document.getElementById('progressText').textContent,
      signature: window.__towApp.sim.world.signature,
      debugLoad: document.getElementById('debugLoad').textContent,
      debugWind: document.getElementById('debugWind').textContent,
      debugPath: document.getElementById('debugRoute').textContent
    };
  });
  check('Canvas 有真实像素输出', initial.lit > 500000, initial.lit + ' lit pixels');
  check('HUD 显示 3 个目标与 0/3 进度', initial.missionRows === 3 && initial.progress.includes('0 / 3'));
  check('资源条与调试面板存在', initial.resourceTracks === 2 &&
    /空载/.test(initial.debugLoad) && /m\/s/.test(initial.debugWind) && /挂接/.test(initial.debugPath));
  check('默认 seed 与地图签名稳定', initial.signature === 'b775700c', initial.signature);

  const deterministic = await page.evaluate(() => {
    const a = TowSim.createSimulation(804);
    const b = TowSim.createSimulation(804);
    return {
      same: JSON.stringify(a.world) === JSON.stringify(b.world),
      order: a.world.mission.map((m) => m.cargoId).join(',') === b.world.mission.map((m) => m.cargoId).join(','),
      obstacles: a.world.obstacles.map((o) => o.id).join(',') === b.world.obstacles.map((o) => o.id).join(',')
    };
  });
  check('同 seed 地图、任务与障碍顺序一致', deterministic.same && deterministic.order && deterministic.obstacles);

  await page.click('#btnPause');
  const pausedT0 = await page.evaluate(() => window.__towApp.sim.t);
  await new Promise((resolve) => setTimeout(resolve, 280));
  const pauseState = await page.evaluate(() => ({ paused: window.__towApp.paused, t: window.__towApp.sim.t }));
  check('暂停冻结仿真时间', pauseState.paused && Math.abs(pauseState.t - pausedT0) < 1e-9);
  await page.click('#btnPause');

  await page.click('#btnValidate');
  await new Promise((resolve) => setTimeout(resolve, 1600));
  const validation = await page.evaluate(() => ({
    pass: document.querySelectorAll('.v-check.pass').length,
    fail: document.querySelectorAll('.v-check.fail').length,
    summary: (document.querySelector('.validate-summary') || {}).textContent || ''
  }));
  check('页面验收 13 项全通过', validation.pass === 13 && validation.fail === 0, validation.summary);

  const normal = await page.evaluate(() => {
    const run = TowValidate.runNormal(804);
    return { phase: run.sim.phase, delivered: run.sim.progress.delivered, legs: run.legs.length };
  });
  check('浏览器内真实跑通正常路线', normal.phase === 'won' && normal.delivered === 3 && normal.legs === 3);

  await page.evaluate(() => {
    const app = window.__towApp;
    app.restart(804);
    app.pause();
    const sim = app.sim;
    let mission = TowSim.activeMission(sim);
    TowNav.driveTo(sim, mission.pickup, 100);
    TowSim.tryAttach(sim);
    TowNav.driveTo(sim, mission.drop, 140);
    TowSim.tryDrop(sim);
    sim.truck.heading = -Math.PI / 2;
    sim.truck.x = 360;
    TowSim.setInput(sim, { throttle: 1, steer: 0, brake: false });
    for (let i = 0; i < 900 && sim.phase === 'playing'; i++) TowSim.step(sim, 1 / 60);
  });
  await new Promise((resolve) => setTimeout(resolve, 220));
  const failed = await page.evaluate(() => ({
    phase: window.__towApp.sim.phase,
    reason: window.__towApp.sim.lastFailureReason,
    delivered: window.__towApp.sim.progress.delivered,
    domReason: document.getElementById('lastFailureReason').textContent,
    continueEnabled: !document.getElementById('btnContinue').disabled,
    checkpoint: document.getElementById('checkpointInfo').textContent
  }));
  check('页面可触达搁浅失败并显示最近原因',
    failed.phase === 'failed' && /搁浅/.test(failed.reason) && /搁浅/.test(failed.domReason));
  check('失败后启用最近检查点继续', failed.continueEnabled && /CP-03/.test(failed.checkpoint), failed.checkpoint);
  await page.screenshot({ path: path.join(root, 'artifacts/smoke-failure.png'), fullPage: true });

  await page.click('#btnContinue');
  await new Promise((resolve) => setTimeout(resolve, 260));
  const recovered = await page.evaluate(() => ({
    phase: window.__towApp.sim.phase,
    delivered: window.__towApp.sim.progress.delivered,
    recoveryCount: window.__towApp.sim.recoveryCount,
    reasonKept: window.__towApp.sim.lastFailureReason,
    banner: document.getElementById('statusBanner').textContent
  }));
  check('检查点恢复保留 1/3 目标进度与最近失败记录',
    recovered.phase === 'playing' && recovered.delivered === 1 && recovered.recoveryCount === 1 &&
    /搁浅/.test(recovered.reasonKept) && /CP-03/.test(recovered.banner));
  await page.screenshot({ path: path.join(root, 'artifacts/smoke-recovery.png'), fullPage: true });

  await page.evaluate(() => {
    const app = window.__towApp;
    if (!app.paused) app.pause();
  });
  const beforeSave = await page.evaluate(() => window.__towApp.snapshot());
  await page.click('#btnSave');
  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((resolve) => setTimeout(resolve, 250));
  await page.click('#btnLoad');
  await new Promise((resolve) => setTimeout(resolve, 220));
  const loaded = await page.evaluate(() => ({
    state: window.__towApp.snapshot(),
    paused: window.__towApp.paused,
    status: document.getElementById('saveStatus').textContent
  }));
  check('刷新页面后载入存档不改变关键位置和胜负条件',
    JSON.stringify(beforeSave) === JSON.stringify(loaded.state) && /已载入/.test(loaded.status));

  await page.click('#btnRestart');
  await new Promise((resolve) => setTimeout(resolve, 180));
  const reset = await page.evaluate(() => ({
    delivered: window.__towApp.sim.progress.delivered,
    active: window.__towApp.sim.progress.activeIndex,
    battery: window.__towApp.sim.resources.battery,
    drawbar: window.__towApp.sim.resources.drawbar,
    statuses: window.__towApp.sim.cargoStates.map((c) => c.status),
    checkpoints: window.__towApp.sim.checkpoints.length,
    failure: window.__towApp.sim.lastFailureReason,
    signature: window.__towApp.sim.world.signature
  }));
  check('重新开始恢复全部目标、资源与检查点',
    reset.delivered === 0 && reset.active === 0 && reset.battery === 100 && reset.drawbar === 100 &&
    reset.statuses.every((s) => s === 'pending') && reset.checkpoints === 1 &&
    reset.failure === null && reset.signature === initial.signature);
  check('无页面脚本错误', errors.length === 0, errors.join(' | '));

  await page.screenshot({ path: path.join(root, 'artifacts/smoke-home.png'), fullPage: true });
  await browser.close();

  fs.writeFileSync(path.join(root, 'artifacts/smoke-result.json'), JSON.stringify({
    allPass: failures.length === 0,
    failures,
    initial,
    validation,
    normal,
    failed,
    recovered,
    reset,
    errors
  }, null, 2) + '\n');

  if (failures.length) {
    console.error('\nBrowser smoke failed: ' + failures.join('; '));
    process.exit(1);
  }
  console.log('\nBrowser smoke passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
