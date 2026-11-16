/* jsdom 页面级冒烟测试：验证 DOM 绑定、时钟控制、场景按钮与导出数据结构 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;

// Canvas 2D 上下文打桩
window.HTMLCanvasElement.prototype.getContext = function () {
  return new Proxy({}, {
    get: function (t, prop) {
      if (prop === 'createLinearGradient') {
        return function () { return { addColorStop: function () {} }; };
      }
      return typeof prop === 'string' ? function () {} : undefined;
    },
    set: function () { return true; }
  });
};
window.HTMLCanvasElement.prototype.getContext = window.HTMLCanvasElement.prototype.getContext;

let downloadName = null;
let downloadContent = null;
window.Blob = class Blob {
  constructor(parts) { this.parts = parts; this.text = parts.join(''); }
};
window.URL.createObjectURL = function () { return 'blob:mock'; };
window.URL.revokeObjectURL = function () {};
window.HTMLAnchorElement.prototype.click = function () {
  downloadName = this.download;
  downloadContent = window.__lastBlob ? window.__lastBlob.text : '';
};
const origCreate = window.URL.createObjectURL;
window.URL.createObjectURL = function (blob) {
  window.__lastBlob = blob;
  return origCreate(blob);
};

function load(script) {
  window.eval(fs.readFileSync(path.join(__dirname, '..', script), 'utf8'));
}
load('js/simulation.js');
load('js/renderer.js');
load('js/audio.js');
load('js/app.js');

const doc = window.document;
const $ = (id) => doc.getElementById(id);

// 初始渲染
assert.strictEqual($('simClock').textContent, '0.00 s');
assert.strictEqual($('statGood').textContent, '0');
assert.ok(doc.querySelectorAll('.log-row').length >= 1, '重置事件应显示在日志中');

// 单步推进同一个仿真时钟
$('btnStep').click();
assert.strictEqual($('simClock').textContent, '0.25 s');
$('btnStep').click();
assert.strictEqual($('simClock').textContent, '0.50 s');

// 参数滑杆联动并产生 PARAM_CHANGE / 越限事件
const rng = $('rng-pressure');
rng.value = '4.6';
rng.dispatchEvent(new window.Event('input', { bubbles: true }));
assert.strictEqual($('val-pressure').textContent, '4.6 MPa');
assert.ok($('ctrl-pressure').classList.contains('out-of-limit'), '越限参数应高亮');

// 设备停机按钮
const pumpBtn = doc.querySelector('.eq-btn[data-eq="pump"]');
assert.ok(pumpBtn.classList.contains('eq-on'));
pumpBtn.click();
assert.ok(pumpBtn.classList.contains('eq-off'));
pumpBtn.click();
assert.ok(pumpBtn.classList.contains('eq-on'));

// 重置：清空日志显示与缓存
$('btnReset').click();
assert.strictEqual($('simClock').textContent, '0.00 s');
assert.strictEqual(doc.querySelectorAll('.log-row').length, 1, '重置后仅保留一条 BATCH_RESET');
assert.strictEqual($('val-pressure').textContent, '3.2 MPa', '参数恢复默认');

// 三个场景按钮可完成并更新统计
['normal', 'outOfLimit', 'downtime'].forEach(function (name) {
  const btn = doc.querySelector('.scenarios button[data-scenario="' + name + '"]');
  window.alert = function () {};
  btn.click();
  assert.strictEqual($('runState').textContent, '批次完成', name + ' 场景应跑完批次');
});
const outReport = JSON.parse(JSON.stringify({
  good: $('statGood').textContent,
  reject: $('statReject').textContent,
  yield: $('statYield').textContent
}));
assert.strictEqual(outReport.good, '2', '停机场景应有 2 块良品');
assert.strictEqual(outReport.reject, '1');

// JSON 导出
$('btnExportJson').click();
assert.ok(/^batch-report-.*\.json$/.test(downloadName));
const report = JSON.parse(downloadContent);
assert.ok(Array.isArray(report.events) && report.events.length > 0);
assert.strictEqual(report.batchSize, 3);

// CSV 导出
$('btnExportCsv').click();
assert.ok(/^event-log-.*\.csv$/.test(downloadName));
assert.ok(downloadContent.split('\n')[0].startsWith('time_s,type,source,'));

console.log('页面级冒烟测试全部通过');
console.log('导出文件名示例:', downloadName);
