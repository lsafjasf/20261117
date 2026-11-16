import test from 'node:test';
import assert from 'node:assert/strict';
import { DATASETS } from '../js/data/datasets.js';
import { cleanDataset, runPipeline } from '../js/core/pipeline.js';
import { STRAT_ORDER } from '../js/core/constants.js';

function run(id, overrides = {}) {
  const clean = cleanDataset(DATASETS[id]);
  const opts = {
    windowId: 'all',
    lithoIds: [...STRAT_ORDER],
    boreholeIds: clean.boreholes.map((b) => b.id),
    ...overrides
  };
  return { clean, model: runPipeline(clean, opts) };
}

test('正常数据集：无质量问题，两孔 7 层全部连通', () => {
  const { clean, model } = run('normal');
  assert.equal(clean.issues.length, 0);
  assert.equal(model.columns[0].units.filter((u) => u.kind === 'layer').length, 7);
  assert.equal(model.correlation.lines.length, 7);
  assert.equal(model.correlation.missingInA.length + model.correlation.missingInB.length, 0);
});

test('去重：完全重复与冲突重复均被识别且只保留首条', () => {
  const { clean } = run('abnormal');
  assert.equal(clean.cleaning.layerExactDup, 1);
  assert.equal(clean.cleaning.layerConflictDup, 1);
  assert.equal(clean.cleaning.sampleExactDup, 1);
  assert.equal(clean.cleaning.sampleConflictDup, 1);
  // 倒置与重叠层位被剔除，ZK05 最终仍为标准 7 层
  assert.equal(clean.cleaning.layerInvalid, 2);
  const zk05Layers = clean.layers.filter((l) => l.boreholeId === 'ZK05');
  assert.equal(zk05Layers.length, 7);
});

test('异常值：超量程 GR 被剔除，剩余值全部在合理区间', () => {
  const { clean } = run('abnormal');
  assert.equal(clean.cleaning.sampleOutlier, 2);
  assert.ok(clean.samples.every((s) => s.gr >= 0 && s.gr <= 220));
  const codes = clean.issues.filter((i) => i.code === 'SAMPLE_OUTLIER');
  assert.equal(codes.length, 2);
});

test('缺失层：生成 gap 占位且对比连线不跨过缺失层', () => {
  const { model } = run('missing');
  const zk04 = model.columns.find((c) => c.boreholeId === 'ZK04');
  const gap = zk04.units.find((u) => u.kind === 'gap');
  assert.ok(gap, 'ZK04 必须存在缺失段占位');
  assert.equal(gap.top, 17.6);
  assert.equal(gap.bottom, 22.4);
  assert.equal(gap.thickness, 4.8);
  // N1 在 ZK04 缺失，对比结果只有 6 条线，且没有任何线连接到 gap
  assert.equal(model.correlation.lines.length, 6);
  assert.deepEqual(model.correlation.missingInB.map((x) => x.lithoId), ['N1']);
  assert.ok(model.correlation.lines.every((line) => line.lithoId !== 'N1'));
});

test('补缺：重采样输出固定网格，无数据网格为 null', () => {
  const { model } = run('missing');
  const grid = model.resampled['ZK04'].grid;
  assert.ok(grid.length > 0);
  const depths = grid.map((g) => g.depth);
  for (let i = 1; i < depths.length; i++) {
    assert.ok(Math.abs((depths[i] - depths[i - 1]) - 0.5) < 1e-9);
  }
  // 缺失段 17.6–22.4m 内的网格应为 null
  const gapCells = grid.filter((g) => g.depth >= 18 && g.depth <= 22);
  assert.ok(gapCells.length > 0);
  assert.ok(gapCells.every((g) => g.gr === null));
  const boundaryCell = grid.find((g) => g.depth === 17.5);
  assert.ok(boundaryCell.gr !== null, '缺失段外的边界网格应保留实测值');
});

test('聚合：统计口径数值与筛选后样本实时计算结果一致', () => {
  const { model } = run('normal');
  const vals = model.filtered.samples.map((s) => s.gr);
  const expectedMean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  assert.equal(model.stats.total.grMean, expectedMean);
  assert.equal(model.stats.total.sampleCount, vals.length);
  const thickness = model.filtered.layers.reduce((a, l) => a + (l.bottom - l.top), 0);
  assert.equal(model.stats.total.thickness, Math.round(thickness * 100) / 100);
});

test('数据版本：相同输入版本一致，筛选变化版本随之变化', () => {
  const a = run('normal').model.version;
  const b = run('normal').model.version;
  assert.equal(a, b);
  const c = run('normal', { windowId: 'q1' }).model.version;
  assert.notEqual(a, c);
});
