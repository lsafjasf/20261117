import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDataset, buildWindowRecords, CELL_COUNT, WINDOWS } from '../js/data.js';
import {
  cleanAndFill, computeStats, dedupe, normalize, processWindow, scoreCells,
} from '../js/pipeline.js';
import { AppState, defaultFilter } from '../js/state.js';

const dataset = buildDataset();
const recordsOf = (id) => dataset.windows.find((w) => w.meta.id === id).records;

test('三个窗口分别具备正常/缺失/异常特征', () => {
  assert.equal(WINDOWS[0].kind, 'normal');
  assert.equal(WINDOWS[1].kind, 'missing');
  assert.equal(WINDOWS[2].kind, 'anomaly');
  for (const w of WINDOWS) {
    const recs = buildWindowRecords(w.id);
    assert.ok(recs.length > CELL_COUNT, `${w.id} 应包含重复记录`);
  }
});

test('去重：重复记录被移除且唯一记录保留', () => {
  const recs = recordsOf('W1');
  const result = dedupe(recs);
  assert.equal(result.records.length, CELL_COUNT);
  assert.ok(result.removed > 0);
  const ids = new Set(result.records.map((r) => r.cellId));
  assert.equal(ids.size, CELL_COUNT);
  // 幂等：再次去重不再删除。
  assert.equal(dedupe(result.records).removed, 0);
});

test('缺失窗口：null/undefined/NaN 全部被邻域或全局均值补齐', () => {
  const recs = dedupe(recordsOf('W2')).records;
  const hadMissing = recs.some((r) =>
    r.elevation === null || r.ndvi === undefined || Number.isNaN(r.waterDist));
  assert.ok(hadMissing);
  const { cells, filledCount } = cleanAndFill(recs);
  assert.ok(filledCount >= 3);
  for (const c of cells) {
    assert.equal(Number.isFinite(c.elevation), true);
    assert.equal(Number.isFinite(c.ndvi), true);
    assert.equal(Number.isFinite(c.waterDist), true);
  }
  assert.equal(cells.length, CELL_COUNT);
});

test('异常窗口：超范围与错误类型被清洗并标记', () => {
  const recs = dedupe(recordsOf('W3')).records;
  const { cells, anomalyCount, filledCount } = cleanAndFill(recs);
  assert.ok(anomalyCount >= 3);
  assert.ok(filledCount >= anomalyCount);
  for (const c of cells) {
    assert.ok(c.elevation >= 0 && c.elevation <= 2600);
    assert.ok(c.ndvi >= -1 && c.ndvi <= 1);
    assert.ok(c.waterDist >= 0 && c.waterDist <= 6000);
  }
});

test('归一化后所有因子落在 0..1', () => {
  const cells = normalize(cleanAndFill(dedupe(recordsOf('W1')).records).cells);
  for (const c of cells) {
    for (const m of ['elevation', 'ndvi', 'waterDist']) {
      assert.ok(c.norm[m] >= 0 && c.norm[m] <= 1);
    }
  }
});

test('加权评分：贡献之和等于综合分，权重自动归一化', () => {
  const cells = normalize(cleanAndFill(dedupe(recordsOf('W1')).records).cells);
  const scored = scoreCells(cells, { elevation: 2, ndvi: 1, water: 0 });
  for (const c of scored) {
    const sum = c.contributions.elevation + c.contributions.ndvi + c.contributions.water;
    assert.ok(Math.abs(sum - c.score) < 1e-12);
    assert.ok(c.score >= 0 && c.score <= 1);
    assert.ok(Math.abs(c.weights.elevation - 2 / 3) < 1e-12);
    assert.equal(c.weights.water, 0);
  }
});

test('正常筛选：默认条件返回全部网格且统计口径可切换', () => {
  const state = new AppState(dataset);
  const view = state.buildView();
  assert.equal(view.filteredCells.length, CELL_COUNT);
  assert.equal(view.stats.count, CELL_COUNT);
  assert.equal(view.stats.mean === null, false);
  state.patchWindow({ statsMode: 'all' });
  assert.equal(state.view.stats.count, CELL_COUNT);
  assert.equal(state.view.statsMode, 'all');
});

test('空结果：互斥筛选返回 0 网格，统计与列表安全降级', () => {
  const state = new AppState(dataset);
  state.patchFilter({ scoreMin: 0.99, scoreMax: 1, levels: ['poor'] });
  const view = state.view;
  assert.equal(view.filteredCells.length, 0);
  assert.equal(view.stats.count, 0);
  assert.equal(view.stats.mean, null);
  assert.deepEqual(view.stats.byLevel, {});
  // 全部口径不受筛选影响。
  state.patchWindow({ statsMode: 'all' });
  assert.equal(state.view.stats.count, CELL_COUNT);
});

test('聚合：按等级与按行的计数之和等于筛选后网格数', () => {
  const processed = processWindow(recordsOf('W3'),
    { elevation: 0.34, ndvi: 0.33, water: 0.33 }, defaultFilter());
  const byLevel = processed.filteredCells.reduce((m, c) => m + 1, 0);
  assert.equal(byLevel, CELL_COUNT);
  const stats = computeStats(processed.filteredCells);
  const levelSum = Object.values(stats.byLevel).reduce((a, b) => a + b, 0);
  assert.equal(levelSum, CELL_COUNT);
});

test('窗口切换：各窗口筛选/权重/选中/缩放独立保留', () => {
  const state = new AppState(dataset);
  state.patchFilter({ scoreMin: 0.6 });
  state.patchWindow({ selectedId: 7, view: { zoom: 1.6, offsetX: 10, offsetY: 20 } });
  state.setWindow('W2');
  assert.equal(state.ws.filter.scoreMin, 0, 'W2 应保持自己的默认筛选');
  state.patchFilter({ elevMax: 1000 });
  state.setWindow('W1');
  assert.equal(state.ws.filter.scoreMin, 0.6, '切回 W1 筛选状态保留');
  assert.equal(state.ws.selectedId, 7);
  assert.equal(state.ws.view.zoom, 1.6, '显示范围保留');
  state.setWindow('W2');
  assert.equal(state.ws.filter.elevMax, 1000, 'W2 的独立筛选保留');
});

test('数据版本：相同参数同版本，改权重/筛选后版本变化', () => {
  const state = new AppState(dataset);
  const v1 = state.buildView().version;
  const v2 = state.buildView().version;
  assert.equal(v1, v2);
  state.patchWindow({ weights: { elevation: 0.6, ndvi: 0.2, water: 0.2 } });
  assert.notEqual(state.view.version, v1);
  state.resetFilter();
  const v3 = state.view.version;
  state.setWindow('W2');
  assert.notEqual(state.view.version, v3, '不同窗口数据指纹不同');
});

test('同源保证：地图/曲线/列表/统计共享同一份视图数据', () => {
  const state = new AppState(dataset);
  state.patchFilter({ scoreMin: 0.3 });
  const view = state.buildView();
  const listSource = [...view.filteredCells].sort((a, b) => b.score - a.score);
  assert.ok(listSource.every((c) => c.score >= 0.3));
  const histCount = view.filteredCells.length;
  assert.equal(histCount, view.stats.count);
  assert.ok(view.version.startsWith('v-'));
});
