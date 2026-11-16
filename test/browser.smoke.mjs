// 浏览器端冒烟测试（Playwright）：真实键盘 + Canvas + HUD + 回放
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const pageUrl = 'http://127.0.0.1:8765/index.html';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(pageUrl);
await page.waitForSelector('#mine');
await page.waitForTimeout(300);

// 1. 初始状态：倒计时 10:00，仪表复位
assert.equal(await page.textContent('#timer'), '10:00');
assert.equal(await page.textContent('#up-value'), '50');
assert.equal(await page.textContent('#down-value'), '50');

// 2. 同时按下两侧按键（键盘并发输入），风机与风门各自变化
await page.keyboard.down('w');
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(700);
await page.keyboard.up('w');
await page.keyboard.up('ArrowLeft');
const fan = Number(await page.textContent('#up-value'));
const door = Number(await page.textContent('#down-value'));
assert.ok(fan > 55, `风机应上升，实际 ${fan}`);
assert.ok(door < 48, `风门应左偏，实际 ${door}`);

// 3. 两侧仪表与任务记录同步刷新
const rows = await page.locator('#zone-table tr').count();
assert.equal(rows, 2);
assert.ok((await page.locator('#event-log li').count()) > 0);

// 4. 越权操作：W/S 只影响风机，方向键只影响风门（职责不可替代）
const fanBefore = Number(await page.textContent('#up-value'));
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(500);
await page.keyboard.up('ArrowRight');
assert.equal(Number(await page.textContent('#up-value')), fanBefore, '风门键不得改变风机');
const doorBefore = Number(await page.textContent('#down-value'));
await page.keyboard.down('s');
await page.waitForTimeout(500);
await page.keyboard.up('s');
assert.equal(Number(await page.textContent('#down-value')), doorBefore, '风机键不得改变风门');

// 5. 暂停/继续
await page.keyboard.press('w');
await page.waitForTimeout(150);
assert.equal(await page.textContent('#status-pill'), '运行中');
await page.keyboard.press('p');
assert.equal(await page.textContent('#status-pill'), '已暂停');
const frozenTimer = await page.textContent('#timer');
await page.waitForTimeout(400);
assert.equal(await page.textContent('#timer'), frozenTimer);
await page.keyboard.press('p');
await page.waitForFunction(
  () => document.querySelector('#status-pill').textContent === '运行中',
  { timeout: 2000 },
);
assert.equal(await page.textContent('#status-pill'), '运行中');

// 6. 模拟单侧断开 → 保护状态
await page.click('#sim-disconnect-up');
await page.waitForTimeout(200);
assert.ok((await page.getAttribute('#panel-up', 'class')).includes('protected'));
await page.click('#sim-disconnect-up');

// 7. 单人调试：选择下游为人类侧，10x 加速
await page.selectOption('#debug-station', 'downstream');
await page.keyboard.press('d');
await page.waitForTimeout(200);
assert.equal(await page.textContent('#up-role'), '自动辅助（调试）');
assert.equal(await page.textContent('#down-role'), '人工操控');
await page.waitForTimeout(1200);
const simTimeFast = await page.textContent('#sim-time');
assert.notEqual(simTimeFast, '00:00');
await page.keyboard.press('d'); // 退出调试

// 8. 重开：仪表、目标、计时同时复位
await page.keyboard.press('r');
await page.waitForTimeout(200);
assert.equal(await page.textContent('#timer'), '10:00');
assert.equal(await page.textContent('#safe-elapsed'), '00:00');
assert.equal(await page.textContent('#up-value'), '50');
assert.equal(await page.textContent('#down-value'), '50');
assert.equal(await page.textContent('#energy-text'), '100%');

// 9. 保存并播放回放
await page.keyboard.down('w');
await page.waitForTimeout(400);
await page.keyboard.up('w');
await page.click('#btn-save-replay');
await page.waitForTimeout(200);
assert.ok((await page.locator('#replay-list .replay-item').count()) >= 1);
await page.click('#replay-list [data-play]');
await page.waitForSelector('#replay-panel:not([hidden])');
await page.waitForTimeout(800);
assert.equal(await page.textContent('#status-pill'), '回放中');
await page.click('#btn-stop-replay');

assert.equal(errors.length, 0, `页面错误: ${errors.join(' | ')}`);
await browser.close();
console.log('浏览器冒烟测试全部通过');
