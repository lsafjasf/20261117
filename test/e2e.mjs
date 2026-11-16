import { chromium } from 'playwright';

const url = 'file:///home/hj/userfeedback/uid828/index.html';
const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => { console.error('PAGE_ERROR:', e.message); process.exit(1); });
await page.goto(url);

const logText = () => page.$eval('#log', (el) => el.textContent);
const txt = (id) => page.$eval('#' + id, (el) => el.textContent);
let failures = 0;
const check = (name, ok) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
  if (!ok) failures++;
};

// 1) 维度自检
await page.click('#btnSelfTest');
await page.waitForFunction(
  () => document.getElementById('log').textContent.includes('自检结束'),
  null, { timeout: 60000 });
const selfLog = await logText();
check('自检-左右声道', selfLog.includes('PASS 左右声道'));
check('自检-频段', selfLog.includes('PASS 频段'));
check('自检-节拍', selfLog.includes('PASS 节拍'));
check('自检-确定性', selfLog.includes('PASS 确定性'));

// 2) 播放→暂停:节点清零、声音停止
await page.click('#btnPlay');
await page.waitForTimeout(600);
const nodesPlaying = parseInt((await txt('txtNodes')).replace(/\D+/g, ''), 10);
check('播放中活动节点>0', nodesPlaying > 0);
await page.click('#btnPause');
await page.waitForTimeout(400);
const nodesPaused = parseInt((await txt('txtNodes')).replace(/\D+/g, ''), 10);
check('暂停后活动节点=0', nodesPaused === 0);
const lv = await page.evaluate(() => window.__engineLevels ?? null);

// 3) 单步
await page.click('#btnStep');
await page.waitForTimeout(300);
check('单步计数=1', (await txt('txtState')).includes('单步计数 1'));

// 4) 监听三态切换
for (const m of ['bypass', 'mute', 'main']) {
  await page.selectOption('#selMonitor', m);
}
check('监听三态可切换', (await txt('txtState')).includes('主输出'));

// 5) 导出→保存→重载→再导出→对比
await page.click('#btnExport');
await page.waitForFunction(
  () => document.getElementById('log').textContent.includes('导出完成'),
  null, { timeout: 30000 });
await page.click('#btnSave');
// 打乱参数再重载,验证重载生效
await page.$eval('#rngLoad', (el) => {
  el.value = '0.9';
  el.dispatchEvent(new Event('input'));
});
await page.click('#btnLoad');
await page.click('#btnExport');
await page.waitForFunction(
  () => (document.getElementById('log').textContent.match(/导出完成/g) || []).length >= 2,
  null, { timeout: 30000 });
const expLog = await logText();
check('重载后对比-时长', expLog.includes('PASS 时长一致'));
check('重载后对比-声道', expLog.includes('PASS 声道数一致'));
check('重载后对比-左峰', expLog.includes('PASS 左声道峰值一致'));
check('重载后对比-右峰', expLog.includes('PASS 右声道峰值一致'));
check('重载后对比-峰时刻', expLog.includes('PASS 左峰时刻一致') && expLog.includes('PASS 右峰时刻一致'));
check('重载后对比-总体通过', expLog.includes('对比通过'));

// 6) 诊断流程:直接填入正确答案应成功
const assign = await page.evaluate(
  () => window.AudioLib.assignmentFromSeed(window.__engine.params.seed));
await page.evaluate((a) => {
  document.querySelectorAll('.diagSel').forEach((s, i) => { s.value = String(a[i]); });
}, assign);
await page.click('#btnDiagnose');
check('诊断成功判定', (await txt('txtVerdict')).includes('成功'));

await browser.close();
console.log(failures === 0 ? 'ALL_E2E_PASS' : failures + ' FAILURES');
process.exit(failures === 0 ? 0 : 1);
