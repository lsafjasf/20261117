import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distanceM, distanceGain, propagationDelayMs, azimuth,
  stereoGains, binauralGains, surroundGains, computeSpatial,
  defaultState, serializeParams, applyParams,
} from '../js/acoustics.js';

const center = { x: 360, y: 252 };

test('距离随像素差线性增长，单位为米', () => {
  const near = distanceM(center, { x: 360, y: 252 + 90 });
  const far = distanceM(center, { x: 360, y: 252 + 360 });
  assert.ok(Math.abs(near - 1) < 1e-9);
  assert.ok(Math.abs(far - 4) < 1e-9);
  assert.ok(far > near);
});

test('距离增加时音量单调下降、延迟单调上升', () => {
  const gains = [1, 2, 4, 8].map((d) => distanceGain(d));
  const delays = [1, 2, 4, 8].map((d) => propagationDelayMs(d));
  for (let i = 1; i < gains.length; i++) {
    assert.ok(gains[i] < gains[i - 1]);
    assert.ok(delays[i] > delays[i - 1]);
  }
  assert.ok(Math.abs(propagationDelayMs(3.43) - 10) < 1e-9);
});

test('方位角：右侧为正、左侧为负、正前方为零', () => {
  assert.ok(azimuth({ x: center.x + 100, y: center.y }, center) > 0);
  assert.ok(azimuth({ x: center.x - 100, y: center.y }, center) < 0);
  assert.ok(Math.abs(azimuth({ x: center.x, y: center.y - 100 }, center)) < 1e-9);
});

test('立体声等功率声像左右能量守恒', () => {
  const right = stereoGains({ x: center.x + 200, y: center.y }, center);
  const left = stereoGains({ x: center.x - 200, y: center.y }, center);
  assert.ok(right.right > right.left);
  assert.ok(left.left > left.right);
  for (const g of [right, left]) {
    assert.ok(Math.abs(g.left * g.left + g.right * g.right - 1) < 1e-9);
  }
});

test('双耳模式产生 ITD 左右耳延迟差与 ILD 电平差', () => {
  const right = binauralGains({ x: center.x + 200, y: center.y }, center);
  const left = binauralGains({ x: center.x - 200, y: center.y }, center);
  assert.ok(right.delayLeftMs > 0 && right.delayRightMs === 0);
  assert.ok(left.delayRightMs > 0 && left.delayLeftMs === 0);
  assert.ok(right.right > right.left);
  assert.ok(left.left > left.right);
});

test('环绕模式四声道归一化且随位置正确分配', () => {
  const frontLeft = surroundGains({ x: 0, y: 0 });
  const backRight = surroundGains({ x: 720, y: 504 });
  const norm = (g) => Math.hypot(g.fl, g.fr, g.bl, g.br);
  assert.ok(Math.abs(norm(frontLeft) - 1) < 1e-9);
  assert.ok(frontLeft.fl > frontLeft.br);
  assert.ok(backRight.br > backRight.fl);
});

test('computeSpatial 在三种模式下输出各自的空间参数', () => {
  const source = { x: 100, y: 100 };
  const s = computeSpatial('stereo', source, center);
  const b = computeSpatial('binaural', source, center);
  const q = computeSpatial('surround', source, center);
  assert.equal(s.mode, 'stereo');
  assert.ok('delayLeftMs' in b && 'delayRightMs' in b);
  assert.ok('fl' in q && 'br' in q);
  assert.ok(s.delayMs > 0 && s.gain > 0);
});

test('参数保存后重载，声源位置与模式不丢失', () => {
  const state = defaultState();
  state.mode = 'binaural';
  state.sources[0].x = 123;
  state.sources[0].freq = 666;
  const restored = defaultState();
  applyParams(restored, JSON.parse(serializeParams(state)));
  assert.equal(restored.mode, 'binaural');
  assert.equal(restored.sources[0].x, 123);
  assert.equal(restored.sources[0].freq, 666);
  assert.deepEqual(restored.sources[1].pattern, state.sources[1].pattern);
});

test('参数重载对越界值进行钳制并拒绝错误版本', () => {
  const state = defaultState();
  const bad = JSON.parse(serializeParams(defaultState()));
  bad.bpm = 9999;
  bad.reverbMix = -5;
  applyParams(state, bad);
  assert.equal(state.bpm, 240);
  assert.equal(state.reverbMix, 0);
  assert.throws(() => applyParams(state, { version: 99 }));
});
