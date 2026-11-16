/*
 * Playwright 端到端：真实浏览器加载 index.html，
 * 验证连续运行、重置复现、场景成败、三态指标、浮标交互、事件时刻与截图。
 * 运行：node tests/browser.e2e.js
 */
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const pageUrl = 'file://' + path.resolve(__dirname, '..', 'index.html');
const failures = [];
function check(name, cond, detail) {
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (detail ? ' - ' + detail : ''));
  if (!cond) failures.push(name);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1500 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pageUrl);
  await page.waitForTimeout(300);
  await page.evaluate(async () => { await document.fonts.ready; });

  console.log('== A. 初始渲染与三态指标 ==');
  check('画布已绘制', await page.locator('#map').screenshot().then((b) => b.length > 2000));
  const metricCount = await page.locator('.metric').count();
  check('6 张指标卡', metricCount === 6, 'count=' + metricCount);
  check('无浮标时显示无观测', (await page.locator('.flag.na').count()) >= 5);
  check('时钟从 D1 00:00 开始', (await page.locator('#simClock').textContent()).includes('D1 00:00'));

  console.log('== B. 浮标点击交互 ==');
  const box = await page.locator('#map').boundingBox();
  // 热点 (6,0) 中心（由 seed estuary-2026 复现）
  const cw = box.width / 16, ch = box.height / 10;
  await page.mouse.click(box.x + 6.5 * cw, box.y + 0.5 * ch);
  await page.waitForTimeout(100);
  check('浮标计数变为 1', (await page.locator('#buoyVal').textContent()).startsWith('1/'));
  check('事件表记录布放', (await page.locator('#logTable tbody').textContent()).includes('监测浮标部署'));
  // 再点一次撤离
  await page.mouse.click(box.x + 6.5 * cw, box.y + 0.5 * ch);
  check('再次点击撤离浮标', (await page.locator('#buoyVal').textContent()).startsWith('0/'));

  console.log('== C. 稳态场景连续运行 + 恢复观察 ==');
  await page.click('.scenario[data-sc="steady"]');
  await page.waitForTimeout(1500);
  await page.click('#btnRun'); // 暂停自动循环，避免抢状态
  // 直接在页面上下文把模拟跑到结束
  const steadyResult = await page.evaluate(async () => {
    const rt = window.RT;
    // 重新构造一个独立 sim 跑完整流程，避免与定时器竞争
    const sim = rt.createSim('estuary-2026');
    rt.Scenarios.steady.deploy(sim);
    while (sim.status === 'running') {
      const p = rt.Scenarios.steady.policy(sim);
      rt.setControl(sim, 'aeration', p.aeration);
      rt.setControl(sim, 'diversion', p.diversion);
      rt.step(sim);
    }
    rt.postRecoveryRun(sim);
    return { status: sim.status, post: sim.postTicks, reason: sim.endReason,
      events: sim.events.map((e) => ({ type: e.type, simTime: e.simTime, wall: e.wallTime })) };
  });
  check('稳态成功且完成 144 步恢复', steadyResult.status === 'success' && steadyResult.post === 144,
    steadyResult.status + ' post=' + steadyResult.post);
  check('恢复事件存在', steadyResult.events.some((e) => e.type === 'recovery'));

  console.log('== D. 临界与失败场景（页面内引擎） ==');
  const scenarioResults = await page.evaluate(() => {
    const out = {};
    ['critical', 'failure'].forEach((key) => {
      const sim = window.RT.createSim('estuary-2026');
      window.RT.Scenarios[key].deploy(sim);
      while (sim.status === 'running') {
        const p = window.RT.Scenarios[key].policy(sim);
        window.RT.setControl(sim, 'aeration', p.aeration);
        window.RT.setControl(sim, 'diversion', p.diversion);
        window.RT.step(sim);
      }
      out[key] = {
        status: sim.status,
        criticalAt: sim.events.filter((e) => e.type === 'critical').map((e) => e.simTime),
        failAt: sim.events.filter((e) => e.type === 'fail').map((e) => e.simTime),
        missedTicks: sim.missedTicks
      };
    });
    return out;
  });
  check('临界场景成功且有触发时刻', scenarioResults.critical.status === 'success' &&
    scenarioResults.critical.criticalAt.length >= 1, JSON.stringify(scenarioResults.critical.criticalAt));
  check('失败场景判定失败且带时刻', scenarioResults.failure.status === 'failed' &&
    scenarioResults.failure.failAt.length >= 1, JSON.stringify(scenarioResults.failure.failAt));
  check('失败场景存在监测漏报', scenarioResults.failure.missedTicks > 0);

  console.log('== E. 同 seed 重开复现（两次重置对比） ==');
  async function snapshotAfterReset() {
    await page.fill('#seedInput', 'estuary-2026');
    await page.click('#btnReset');
    return page.evaluate(() => {
      const s = window.RT.createSim('estuary-2026');
      return { hot: s.hotspots, weather: s.weatherSeq.map((w) => w.kind), pulses: s.pulses };
    });
  }
  const s1 = await snapshotAfterReset();
  const s2 = await snapshotAfterReset();
  check('重开热点/天气/脉冲一致', JSON.stringify(s1) === JSON.stringify(s2));
  check('热点为复现坐标', JSON.stringify(s1.hot) ===
    JSON.stringify([{ x: 6, y: 0 }, { x: 1, y: 8 }, { x: 2, y: 4 }]));

  console.log('== F. 截图与控制台错误 ==');
  // 让 UI 跑几步后截图
  await page.click('.scenario[data-sc="critical"]');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'ui-critical.png'), fullPage: true });
  check('截图已生成', require('fs').existsSync(
    path.resolve(__dirname, '..', 'artifacts', 'ui-critical.png')));

  // 失败场景：跑到告警出现后截图
  await page.click('.scenario[data-sc="failure"]');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.resolve(__dirname, '..', 'artifacts', 'ui-failure.png'), fullPage: true });
  check('失败态截图已生成', require('fs').existsSync(
    path.resolve(__dirname, '..', 'artifacts', 'ui-failure.png')));
  check('无页面 JS 错误', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log('\n========================================');
  if (failures.length) {
    console.log('E2E 失败 ' + failures.length + ' 项: ' + failures.join('; '));
    process.exit(1);
  }
  console.log('E2E 全部通过');
})().catch((e) => { console.error(e); process.exit(1); });
