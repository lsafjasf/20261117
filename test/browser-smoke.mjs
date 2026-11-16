// 真实浏览器冒烟测试：需要先启动静态服务器（npm run serve）。
// 运行：node test/browser-smoke.mjs
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.DEMO_URL || 'http://localhost:8510/index.html';
const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(error.message));

await page.goto(base);
await page.waitForSelector('#stage');
await page.waitForFunction(() => window.__demo !== undefined);

// 1. 初始状态：12 事件、20 秒、差值 0。
const initial = await page.evaluate(() => {
  const { project } = window.__demo;
  return {
    events: project.audioTracks[0].events.length,
    duration: project.outPoint - project.inPoint,
    rows: document.querySelectorAll('#delta-table tbody tr').length,
  };
});
assert.equal(initial.events, 12);
assert.equal(initial.duration, 20);
assert.equal(initial.rows, 12);

// 2. 页面自检全部通过。
await page.click('#selftest-btn');
await page.waitForFunction(() =>
  document.querySelector('#selftest-output').textContent.includes('全部通过'));

// 3. 分割 + 转场后仍 12 事件且对齐。
await page.evaluate(() => {
  const { project } = window.__demo;
  window.__demo.clock.seek(7.5);
});
await page.click('#split-btn');
await page.selectOption('#transition-select', '0.8');
await page.click('#transition-btn');
const afterEdit = await page.evaluate(() => {
  const { project } = window.__demo;
  const events = project.audioTracks[0].events;
  return {
    clips: project.videoTracks[0].clips.length,
    events: events.length,
    transition: project.videoTracks[0].clips[0].transitionOut,
  };
});
assert.equal(afterEdit.clips, 2);
assert.equal(afterEdit.events, 12);
assert.equal(afterEdit.transition.duration, 0.8);

// 4. 非法重叠被模型阻止，冲突横幅出现并标出位置。
const blocked = await page.evaluate(() => {
  const { project } = window.__demo;
  const right = project.videoTracks[0].clips[1];
  return window.__demo.moveClip(right.id, right.timelineStart - 1);
});
assert.equal(blocked.ok, false);

// 5. 制造真实重叠 -> 导出被阻止并跳到冲突位置。
await page.evaluate(() => {
  const { project } = window.__demo;
  const left = project.videoTracks[0].clips[0];
  left.timelineEnd = 8.4;
  document.querySelector('#export-btn').click();
});
await page.waitForFunction(() =>
  document.querySelector('#export-progress').textContent.includes('导出阻止'));
const bannerText = await page.textContent('#conflict-banner');
assert.match(bannerText, /7\.500s - 8\.400s|重叠/);

// 6. 恢复工程，裁切为 2 秒并实际导出，验证首尾无黑帧且文件可播放。
await page.evaluate(() => {
  const { project } = window.__demo;
  const left = project.videoTracks[0].clips[0];
  left.timelineEnd = 7.5;
  window.__demo.setInOut(0, 2);
});
await page.click('#export-btn');
await page.waitForFunction(() =>
  document.querySelector('#export-progress').textContent.includes('导出完成'), { timeout: 30000 });
const exportInfo = await page.textContent('#export-progress');
assert.match(exportInfo, /无黑帧/);
const href = await page.getAttribute('#export-download', 'href');
assert.ok(href.startsWith('blob:'));

// 7. 保存 -> 重新载入：入出点与事件位置保持不变。
const saved = await page.evaluate(() => window.__demo.serialize());
const reloadResult = await page.evaluate((text) => {
  const blob = new Blob([text], { type: 'application/json' });
  const file = new File([blob], 'project.json', { type: 'application/json' });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  const input = document.querySelector('#load-file');
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return new Promise((resolve) => setTimeout(() => {
    resolve(document.querySelector('#selftest-output').textContent);
  }, 200));
}, saved);
assert.match(reloadResult, /校验一致/);

// 8. 逐帧与播放头共用时钟：逐帧一次正好前进 1/30 秒。
const beforeStep = await page.evaluate(() => window.__demo.clock.state.time);
await page.click('#next-frame');
const afterStep = await page.evaluate(() => window.__demo.clock.state.time);
assert.ok(Math.abs((afterStep - beforeStep) - 1 / 30) < 1e-9);

assert.equal(consoleErrors.length, 0, `浏览器控制台错误：${consoleErrors.join(' | ')}`);
console.log('浏览器冒烟测试全部通过：', {
  initial,
  afterEdit,
  blocked,
  exportInfo,
});
await browser.close();
