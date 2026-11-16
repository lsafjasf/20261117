import test from 'node:test';
import assert from 'node:assert/strict';
import { TransportClock } from '../src/clock.js';

// Node 下没有 requestAnimationFrame，用空桩；测试直接手动调用 tick 推进时间。
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

test('拖动与逐帧都写入同一个 time 状态', () => {
  const clock = new TransportClock();
  clock.setLoopBounds(0, 20);
  clock.seek(5);
  assert.equal(clock.state.time, 5);
  clock.frameStep(1, 1 / 30);
  assert.ok(Math.abs(clock.state.time - (5 + 1 / 30)) < 1e-9);
  assert.equal(clock.state.playing, false);
});

test('seek 被限制在循环区间内', () => {
  const clock = new TransportClock();
  clock.subscribe(() => {});
  clock.setLoopBounds(2, 10);
  clock.seek(0);
  assert.equal(clock.state.time, 2);
  clock.seek(99);
  assert.equal(clock.state.time, 10);
});

test('循环开启时越界自动回到入点', () => {
  const clock = new TransportClock();
  clock.subscribe(() => {});
  clock.setLoopBounds(1, 3);
  clock.play();
  clock.lastNow = performance.now();
  clock.tick(clock.lastNow + 2500); // 前进 2.5 秒：1 -> 3.5，循环回 1.5
  assert.ok(Math.abs(clock.state.time - 1.5) < 1e-9);
  clock.pause();
});

test('非循环模式到达出点自动暂停', () => {
  const clock = new TransportClock();
  clock.subscribe(() => {});
  clock.state.loop = false;
  clock.setLoopBounds(0, 2);
  clock.play();
  clock.lastNow = performance.now();
  clock.tick(clock.lastNow + 5000);
  assert.equal(clock.state.playing, false);
  assert.equal(clock.state.time, 2);
});
