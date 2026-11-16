import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSnapshot, diffSnapshots, cleanCheck, beatDriftCheck } from '../js/verify.js';
import { defaultState } from '../js/acoustics.js';

test('移动监听点并改 BPM 时至少三个维度发生真实变化', () => {
  const beforeState = defaultState();
  const before = collectSnapshot(beforeState);

  const afterState = defaultState();
  afterState.listener = { x: 120, y: 90 };
  afterState.sources[0].freq = 880;
  afterState.bpm = 132;
  const after = collectSnapshot(afterState);

  const result = diffSnapshots(before, after);
  assert.ok(result.dims.find((d) => d.dimension === '左右声道').changed);
  assert.ok(result.dims.find((d) => d.dimension === '频段').changed);
  assert.ok(result.dims.find((d) => d.dimension === '延迟').changed);
  assert.ok(result.dims.find((d) => d.dimension === '节拍').changed);
  assert.equal(result.changedCount, 4);
  assert.ok(result.pass);
});

test('仅改频率只有频段维度变化，不满足三维要求', () => {
  const before = collectSnapshot(defaultState());
  const state2 = defaultState();
  state2.sources[0].freq = 999;
  const result = diffSnapshots(before, collectSnapshot(state2));
  assert.equal(result.changedCount, 1);
  assert.equal(result.pass, false);
});

test('节拍漂移检测：稳定步进通过，漂移步进失败', () => {
  const nominal = 60 / 120 / 2; // 250ms
  const stable = [0, 1, 2, 3].map((i) => i * nominal * 1000);
  assert.ok(beatDriftCheck(stable, 120).pass);
  const drifted = [0, nominal * 1000, nominal * 2 * 1000 + 30];
  assert.equal(beatDriftCheck(drifted, 120).pass, false);
  assert.equal(beatDriftCheck([0], 120).pass, false);
});

test('清洁自检要求活动节点为零且无会话图', () => {
  const cleanEngine = { activeNodeCount: 0, playing: false, session: null };
  assert.ok(cleanCheck(cleanEngine).pass);
  const leaking = { activeNodeCount: 4, playing: false, session: {} };
  const result = cleanCheck(leaking);
  assert.equal(result.pass, false);
  assert.match(result.note, /残留/);
});
