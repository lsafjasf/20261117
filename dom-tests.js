/*
 * dom-tests.js - jsdom 集成测试：node dom-tests.js
 * 引擎物理由确定性 step 推进；DOM 层验证按钮、键盘、HUD、暂停/重开/存档。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const rafQueue = [];
const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'outside-only',
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      const gradient = { addColorStop: () => {} };
      return new Proxy({}, {
        get: (t, prop) => {
          if (prop === 'createLinearGradient' || prop === 'createRadialGradient' ||
              prop === 'createPattern') return () => gradient;
          return typeof prop === 'string' ? () => {} : undefined;
        },
        set: () => true
      });
    };
    window.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  }
});
const { window } = dom;
const document = window.document;

function flushFrames(count = 1) {
  let now = 1000;
  for (let i = 0; i < count; i++) {
    now += 33;
    const q = rafQueue.splice(0, rafQueue.length);
    q.forEach((cb) => cb(now));
  }
}

function load(file) {
  window.eval(fs.readFileSync(path.join(__dirname, file), 'utf8'));
}
load('engine.js');
load('render.js');
load('audio.js');
load('app.js');

const E = window.WindmillEngine;
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (err) { failed++; console.error('  FAIL ' + name + ' -> ' + err.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function state() { return window.WindmillApp.getState(); }
function click(id) { document.getElementById(id).dispatchEvent(new window.Event('click')); }
function key(code, type) {
  window.dispatchEvent(new window.KeyboardEvent(type, { code, bubbles: true }));
}
function autopilotRun(s, max = 30 * 300) {
  for (let i = 0; i < max && s.status === 'running'; i++) {
    E.step(s, window.WindmillApp.autopilot(s));
  }
  return s;
}

console.log('1) 页面初始化与 HUD');
test('开局 seed、三个目标、资源与风向面板显示', () => {
  assert(state().seed === 20261117);
  assert(document.querySelectorAll('#progress .target').length === 3);
  assert(document.getElementById('physics').textContent.includes('当前风向'));
  assert(document.getElementById('resources').textContent.includes('工具包'));
  flushFrames(2);
});

console.log('2) 暂停与恢复');
test('暂停冻结模拟，恢复后继续', () => {
  const t0 = state().t;
  key('KeyP', 'keydown');
  assert(state().paused === true);
  E.step(state(), { throttle: 1 });
  flushFrames(2);
  assert(state().t === t0, '暂停中 step 不应改变时间');
  key('KeyP', 'keydown');
  assert(state().paused === false);
  E.step(state(), { throttle: 1 });
  assert(state().t > t0);
});

console.log('3) 键盘输入映射');
test('W/空格/E 映射为上升/制动/检修，松开即复位', () => {
  key('KeyW', 'keydown');
  key('Space', 'keydown');
  key('KeyE', 'keydown');
  const s = state();
  for (let i = 0; i < 5; i++) E.step(s, { throttle: 1, brake: true, inspect: true });
  key('KeyW', 'keyup');
  key('Space', 'keyup');
  key('KeyE', 'keyup');
  assert(s.y > 0);
});

console.log('4) 正常路线（自动驾驶策略与引擎联通）');
test('自动驾驶通关并触发成功日志', () => {
  click('newGameBtn');
  const s = autopilotRun(state());
  flushFrames(3);
  assert(s.status === 'won');
  assert(s.inspected.every(Boolean) && s.y < 2);
  assert(document.getElementById('log').textContent.includes('任务成功'));
});

console.log('5) 碰撞场景与失败原因展示');
test('碰撞调试场景确定性失败', () => {
  document.getElementById('scenarioSelect').value = 'collision';
  click('newGameBtn');
  const s = state();
  for (let i = 0; i < 30 * 60 && s.status === 'running'; i++) E.step(s, { throttle: 1 });
  flushFrames(3);
  assert(s.status === 'failed' && s.failure === E.FAILURE.COLLISION);
  assert(document.getElementById('failureBox').textContent.includes('碰撞'));
  assert(!document.getElementById('overlay').classList.contains('hidden'));
});

console.log('6) 搁浅场景');
test('冰区静止启动遇横风确定性搁浅', () => {
  document.getElementById('scenarioSelect').value = 'strand';
  click('newGameBtn');
  const s = state();
  const zone = s.map.iceZones[0];
  const stopY = (zone.lo + zone.hi) / 2;
  for (let i = 0; i < 30 * 60 && s.status === 'running'; i++) {
    const inp = Math.abs(s.y - stopY) < 0.8 ? { throttle: 1 }
      : { throttle: s.y < stopY ? 1 : -1 };
    E.step(s, inp);
  }
  flushFrames(3);
  assert(s.status === 'failed' && s.failure === E.FAILURE.STRANDED);
});

console.log('7) 检查点继续');
test('完成检修后失败可从检查点继续并通关', () => {
  document.getElementById('scenarioSelect').value = 'normal';
  click('newGameBtn');
  const s = state();
  for (let i = 0; i < 30 * 300 && s.status === 'running' && !s.inspected[0]; i++) {
    E.step(s, window.WindmillApp.autopilot(s));
  }
  assert(s.inspected[0] && s.checkpoint);
  s.status = 'failed';
  s.failure = E.FAILURE.COLLISION;
  s.lastFailure = E.FAILURE.COLLISION;
  flushFrames(1);
  click('resumeBtn');
  assert(state().status === 'running' && state().inspected[0] === true);
  assert(state().lastFailure === E.FAILURE.COLLISION);
  autopilotRun(state());
  assert(state().status === 'won');
});

console.log('8) 重开恢复全部目标与资源');
test('重开不只是重置角色，目标/资源/地图全部复位', () => {
  document.getElementById('scenarioSelect').value = 'normal';
  click('newGameBtn');
  const s = state();
  s.battery = 5; s.brake = 7; s.kits = 0; s.inspected = [true, true, false];
  click('restartBtn');
  const f = state();
  assert(f.battery === 100 && f.brake === 100 && f.kits === E.constants.MAX_KITS);
  assert(f.inspected.every((v) => !v));
  assert(f.y === 0 && f.x === 0 && f.t === 0 && f.status === 'running');
  assert(JSON.stringify(f.map) === JSON.stringify(s.map));
});

console.log('9) 保存/载入');
test('保存后重开再载入，关键状态与胜负条件不变', () => {
  click('newGameBtn');
  const s = state();
  for (let i = 0; i < 140; i++) E.step(s, window.WindmillApp.autopilot(s));
  const text = E.serialize(s);
  click('saveBtn');
  assert(window.localStorage.getItem('windmill-gondola-save-v1') === text);
  click('newGameBtn');
  assert(state().t === 0);
  click('loadBtn');
  assert(E.serialize(state()) === text);
  const a = E.deserialize(text);
  const b = E.deserialize(text);
  for (let i = 0; i < 150; i++) {
    E.step(a, window.WindmillApp.autopilot(a));
    E.step(b, window.WindmillApp.autopilot(b));
  }
  assert(E.serialize(a) === E.serialize(b));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
