import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../js/core/store.js';
import { STRAT_ORDER } from '../js/core/constants.js';

test('切回前一时间窗口：筛选状态与深度范围完整保留', () => {
  const store = new Store();
  store.setWindow('q1');
  store.toggleLitho('N1'); // 隐藏 N1
  store.toggleBorehole('ZK02'); // 只留 ZK01
  store.setStatsBasis('grMax');
  store.setDepthRange(10, 40);

  const kept = {
    litho: [...store.state.lithoIds],
    holes: [...store.state.boreholeIds],
    basis: store.state.statsBasis,
    view: { ...store.view }
  };
  assert.deepEqual(kept.litho, STRAT_ORDER.filter((id) => id !== 'N1'));
  assert.deepEqual(kept.holes, ['ZK01']);

  // 切到 Q2（新窗口取默认状态），再切回 Q1
  store.setWindow('q2');
  assert.ok(store.state.lithoIds.includes('N1'), '新窗口应使用默认筛选');
  store.setWindow('q1');

  assert.deepEqual(store.state.lithoIds, kept.litho);
  assert.deepEqual(store.state.boreholeIds, kept.holes);
  assert.equal(store.state.statsBasis, 'grMax');
  assert.deepEqual(store.view, kept.view);
});

test('切换数据集后再切回：前一数据集的筛选快照同样保留', () => {
  const store = new Store();
  store.toggleLitho('K2');
  store.setDepthRange(5, 30);
  store.setDataset('missing');
  assert.ok(store.state.lithoIds.includes('K2'), '新数据集为默认全选');
  store.setDataset('normal');
  assert.ok(!store.state.lithoIds.includes('K2'), 'normal 的隐藏状态被恢复');
  assert.deepEqual(store.view, { depthTop: 5, depthBottom: 30 });
});

test('空结果：Q4 窗口无样本，模型显式标记 empty 且统计安全降级', () => {
  const store = new Store();
  store.setWindow('q4');
  const { model } = store.snapshot();
  assert.equal(model.filtered.empty, true);
  assert.equal(model.filtered.samples.length, 0);
  assert.equal(model.stats.empty, true);
  assert.equal(model.stats.total.sampleCount, 0);
  assert.equal(model.stats.total.grMean, null);
  assert.equal(model.resampled['ZK01'].grid.every((g) => g.gr === null), true);
});

test('正常筛选：Q1 窗口只保留该时间范围内样本，层位不受窗口影响', () => {
  const store = new Store();
  store.setWindow('q1');
  const { model } = store.snapshot();
  assert.equal(model.filtered.empty, false);
  assert.ok(model.filtered.samples.length > 0);
  assert.ok(model.filtered.samples.every((s) => s.measuredAt < '2024-04-01'));
  // 层位来自钻孔编录，时间窗口不删除层位
  assert.equal(model.filtered.layers.length, 14);
});

test('全部钻孔取消：视图模型安全降级为空列，重新选择后恢复', () => {
  const store = new Store();
  store.toggleBorehole('ZK01');
  store.toggleBorehole('ZK02');
  assert.deepEqual(store.state.boreholeIds, []);
  assert.equal(store.model.columns.length, 0);
  assert.equal(store.model.stats.total.sampleCount, 0);
  store.toggleBorehole('ZK01');
  assert.deepEqual(store.state.boreholeIds, ['ZK01']);
  assert.equal(store.model.columns.length, 1);
});
