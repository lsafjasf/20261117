import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pageUrl = 'file://' + path.join(root, 'index.html');

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream']
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1700 });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
});

await page.goto(pageUrl);
await new Promise((r) => setTimeout(r, 800));

// 1. Canvas 有真实像素输出
const pixels = await page.evaluate(() => {
  const c = document.getElementById('scene');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let nonBlack = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i + 1] + d[i + 2] > 30) nonBlack++;
  }
  return nonBlack;
});
console.log('非黑像素数:', pixels);

// 2. 指标面板渲染：观测/实际/告警三类标签都存在
const tags = await page.evaluate(() => ({
  obs: document.querySelectorAll('.tag.obs').length,
  act: document.querySelectorAll('.tag.act').length,
  metricCards: document.querySelectorAll('.metric').length,
  targetRows: document.querySelectorAll('.target-row').length
}));
console.log('面板:', JSON.stringify(tags));

// 3. 交互：选 B 路线、紧装、出发、开通风、开喷淋
await page.click('[data-route="B"]');
await page.click('[data-arr="tight"]');
await page.click('#btnDepart');
await new Promise((r) => setTimeout(r, 600));
await page.click('#btnVent');
await page.click('#btnSpray');
const state1 = await page.evaluate(() => ({
  phase: document.querySelector('.phase-banner').textContent,
  vent: document.getElementById('btnVent').textContent,
  spray: document.getElementById('btnSpray').textContent,
  logs: document.querySelectorAll('#log .entry').length
}));
console.log('出发后状态:', JSON.stringify(state1));

// 4. 运行一段时间后重置，确认同 seed 目标与天气复现（界面层）
await new Promise((r) => setTimeout(r, 2500));
const grabStaticTargets = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#targets .target-row')).map((r) => r.textContent).join('|'));
const beforeReset = await grabStaticTargets();
await page.click('#btnReset');
await new Promise((r) => setTimeout(r, 300));
const afterReset = await grabStaticTargets();
console.log('重置后目标一致:', beforeReset === afterReset);
const weatherRepro = await page.evaluate(() => {
  const a = BeeSim.createSimulation(42);
  const b = BeeSim.createSimulation(42);
  return JSON.stringify(a.world.events) === JSON.stringify(b.world.events) &&
    JSON.stringify(a.world.targets) === JSON.stringify(b.world.targets);
});
console.log('同 seed 天气/目标复现:', weatherRepro);

// 5. 触发页面内验证报告
await page.click('#btnValidate');
await new Promise((r) => setTimeout(r, 500));
const report = await page.evaluate(() => {
  const root = document.getElementById('validateReport');
  return {
    pass: root.querySelectorAll('.v-check.pass').length,
    fail: root.querySelectorAll('.v-check.fail').length,
    compares: root.querySelectorAll('.v-compare').length,
    summary: root.querySelector('p').textContent
  };
});
console.log('验证报告:', JSON.stringify(report));

// 6. 静音按钮
await page.click('#btnMute');
const muteLabel = await page.$eval('#btnMute', (el) => el.textContent);

// 7. 失败场景截图：紧装 + 关通风，加速跑到热浪
await page.click('#btnReset');
await page.click('[data-route="B"]');
await page.click('[data-arr="tight"]');
await page.click('#btnDepart');
await page.click('#btnVent'); // 关闭通风（错误处置）
await page.evaluate(() => window.__beeApp.step(380)); // 推进到仿真 76s：热浪(64-109)中段
const failureShot = await page.evaluate(() => ({
  banner: document.querySelector('.phase-banner').textContent,
  alarmCards: document.querySelectorAll('.metric.alert, .metric.warn').length,
  logEntries: document.querySelectorAll('#log .entry.alarm').length
}));
console.log('失败场景截图时刻:', JSON.stringify(failureShot));
await page.screenshot({ path: path.join(root, 'artifacts/smoke-incident.png') });

const failures = [];
if (pixels < 10000) failures.push('Canvas 绘制像素不足');
if (tags.metricCards < 6) failures.push('指标卡片不足 6 张');
if (tags.targetRows !== 3) failures.push('目标行不是 3 行');
if (state1.vent !== '强通风：关') failures.push('通风按钮未生效（默认开，点击应变关）');
if (!state1.spray.includes('开')) failures.push('喷淋按钮未生效');
if (state1.logs < 2) failures.push('事件日志未写入');
if (beforeReset !== afterReset) failures.push('重置后目标分布不一致');
if (!weatherRepro) failures.push('同 seed 天气序列或目标分布未复现');
if (report.fail !== 0 || report.pass < 10) failures.push('页面验证报告存在失败项');
if (!muteLabel.includes('静音')) failures.push('静音切换失效');
if (errors.length) failures.push('浏览器错误: ' + errors.join(' | '));

await page.screenshot({ path: path.join(root, 'artifacts/smoke-validate.png'), fullPage: true });
await page.click('#btnReset');
await page.screenshot({ path: path.join(root, 'artifacts/smoke-idle.png'), fullPage: false });
await browser.close();

if (failures.length) {
  console.error('SMOKE FAIL:', failures.join('; '));
  process.exit(1);
}
console.log('SMOKE PASS（全部浏览器检查通过）');
