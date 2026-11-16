/* jsdom 集成冒烟：需要 jsdom 与 @napi-rs/canvas（可选依赖，CI 无 GUI 时验证 UI 管线）。
 * 挂起 rAF 后由测试手动推进，保证断言不受实时时钟影响。 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const napiCanvas = require('@napi-rs/canvas');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const scripts = ['src/config.js', 'src/engine.js', 'src/renderer.js',
  'src/autopilot.js', 'src/replay.js', 'src/main.js']
  .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n;\n');

let rafCb = null;
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: false });
const { window } = dom;
window.HTMLCanvasElement.prototype.getContext = function () {
  if (!this.__ctx2d) {
    this.__ctx2d = napiCanvas.createCanvas(this.width, this.height).getContext('2d');
  }
  return this.__ctx2d;
};
// 捕获 rAF 回调，由测试手动驱动
window.requestAnimationFrame = function (cb) { rafCb = cb; return 1; };
// performance.now 由测试控制（必须在页面脚本 eval 前替换）
let fakeNow = 0;
Object.defineProperty(window, 'performance', { value: { now: () => fakeNow } });

let failures = 0;
function check(name, cond) {
  if (cond) console.log('  PASS  ' + name);
  else { failures += 1; console.error('  FAIL  ' + name); }
}

window.eval(scripts);

const doc = window.document;
const C = window.DBConfig;
function frame() {
  const cb = rafCb;
  rafCb = null;
  if (cb) cb(performance.now());
}
function tickFrames(n) {
  for (let i = 0; i < n; i++) {
    fakeNow += C.DT * 1000;
    frame();
  }
}

console.log('== 浏览器层冒烟测试 ==');
check('页面与双玩家面板渲染',
  doc.getElementById('panel-p1') && doc.getElementById('panel-p2'));

function key(type, code) {
  window.dispatchEvent(new window.KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
}

// 首帧：渲染初始仪表
frame();
check('两侧仪表各 12 项',
  doc.querySelectorAll('#gauges-p1 .gauge').length === 12 &&
  doc.querySelectorAll('#gauges-p2 .gauge').length === 12);
check('双方仪表数值一致（同源快照）',
  doc.querySelectorAll('#gauges-p1 .value')[0].textContent ===
  doc.querySelectorAll('#gauges-p2 .value')[0].textContent);

// 两侧同时按键：P1 下潜 + P2 开气，互不冲突
key('keydown', 'KeyS');
key('keydown', 'ArrowRight');
tickFrames(30);
const depthAfter = parseFloat(doc.querySelectorAll('#gauges-p1 .value')[0].textContent);
check('P1 压载生效、钟体下潜', depthAfter > 0);
key('keyup', 'KeyS');
key('keyup', 'ArrowRight');

// 暂停冻结
key('keydown', 'KeyP');
frame();
check('暂停遮罩出现', doc.getElementById('overlay').hidden === false);
const frozen = doc.getElementById('mission').textContent;
tickFrames(30);
check('暂停期间任务计时冻结', doc.getElementById('mission').textContent === frozen);
key('keydown', 'KeyP');

// 键位零重叠
const codes = Object.keys(C.KEYMAP);
const p1Keys = codes.filter((c) => C.KEYMAP[c].player === 'p1');
const p2Keys = codes.filter((c) => C.KEYMAP[c].player === 'p2');
check('两侧键位完全不重叠',
  p1Keys.length + p2Keys.length === new Set(codes).size);

// 调试模式
key('keydown', 'KeyD');
frame();
check('进入单人调试模式', doc.body.classList.contains('debug-on'));

// 模拟 P1 断开 → 保护
doc.getElementById('btn-disconnect-p1').click();
frame();
check('单侧断开进入保护状态',
  doc.getElementById('overlay').textContent.indexOf('保护状态') !== -1);
doc.getElementById('btn-reconnect').click();
frame();
check('重连后保护解除', doc.getElementById('overlay').hidden === true);

// 托管两侧推进一段，再打开回放
doc.getElementById('btn-drive-p1').click();
doc.getElementById('btn-drive-p2').click();
tickFrames(900);
doc.getElementById('btn-replay').click();
check('回放时间轴打开', doc.getElementById('replay-bar').hidden === false);
check('回放记录 tick 与冲突字段',
  doc.getElementById('rp-label').textContent.indexOf('tick') !== -1);
const scrub = doc.getElementById('rp-scrub');
scrub.value = String(Math.floor(Number(scrub.max) / 2));
scrub.dispatchEvent(new window.Event('input'));
check('时间轴可拖动重放', doc.getElementById('rp-label').textContent.indexOf('/') !== -1);

// 关闭回放并重开
doc.getElementById('rp-close').click();
key('keydown', 'KeyR');
frame();
check('重开后仪表/目标/计时复位',
  doc.getElementById('mission').textContent.indexOf('0.0s') !== -1 &&
  parseFloat(doc.querySelectorAll('#gauges-p1 .value')[0].textContent) === 0);
check('重开后冲突记录清空', doc.getElementById('conflict-list').children.length === 0);

console.log(failures === 0 ? '\n浏览器冒烟全部通过。' : '\n有 ' + failures + ' 项失败。');
process.exit(failures === 0 ? 0 : 1);
