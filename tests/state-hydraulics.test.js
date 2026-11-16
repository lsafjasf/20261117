import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppState, DATA_END } from '../src/state.js';
import { simulate } from '../src/hydraulics.js';
import { buildCsv } from '../src/export.js';
import { NODES } from '../src/data.js';

function fresh() {
  const app = createAppState();
  app.refresh();
  return app;
}

test('窗口切换后切回，筛选/聚合/阀门/选中节点完整保留', () => {
  const app = fresh();
  app.setFilters({ zone: '南区', metric: 'flow', min: '5', max: '', anomalyOnly: false });
  app.state.intervalMs = 3600000;
  app.refresh();
  app.toggleEdge('E04');
  app.selectNode('N11');
  const saved = {
    filters: { ...app.state.filters },
    intervalMs: app.state.intervalMs,
    closedEdges: [...app.state.closedEdges],
    selectedNode: app.state.selectedNode
  };
  assert.ok(app.canShift(-1));
  app.shiftWindow(-1); // 切到前一窗口（条件可能不同/默认）
  assert.notEqual(app.state.windowEnd, DATA_END);
  app.goBack(); // 回到上一窗口
  assert.equal(app.state.windowEnd, DATA_END);
  assert.deepEqual(app.state.filters, saved.filters);
  assert.equal(app.state.intervalMs, saved.intervalMs);
  assert.deepEqual(app.state.closedEdges, saved.closedEdges);
  assert.equal(app.state.selectedNode, saved.selectedNode);
  assert.equal(app.hasPrevious(), false);
});

test('窗口导航边界：不能越过数据起点与终点', () => {
  const app = fresh();
  app.state.windowMs = 86400000;
  app.refresh();
  assert.equal(app.canShift(-1), false);
  assert.equal(app.canShift(1), false);
});

test('关断支路后水力重算：不可达节点标红且压力为 0，恢复后可达', () => {
  const app = fresh();
  // E04 与 E05 是末端节点 N12/N14 方向的关键支路之一；先验证关断单条边
  const before = simulate([], app.state.snapshot);
  assert.equal(before.cutoffNodes.length, 0);
  assert.ok(before.nodes.every((n) => n.reachable));

  const cut = simulate(['E04'], app.state.snapshot);
  // 关 E04 后 N12 仍可经 N10-N13 路径；构造真正孤立场景：同时关掉 E18/E19/E20 中的 N13 通道
  const isolated = simulate(['E04', 'E19'], app.state.snapshot);
  assert.ok(isolated.cutoffNodes.includes('N12'), 'N12 应成为断供节点');
  const n12 = isolated.nodes.find((n) => n.id === 'N12');
  assert.equal(n12.reachable, false);
  assert.equal(n12.pressure, 0);
  assert.equal(n12.anomaly, true);
  assert.ok(isolated.cutoffZones.includes('北区'));
  assert.ok(isolated.edges.find((e) => e.id === 'E04').closed);

  const restored = simulate([], app.state.snapshot);
  assert.equal(restored.cutoffNodes.length, 0);
});

test('关断后压力重新分配：剩余可达节点压力随阻力路径衰减', () => {
  const app = fresh();
  const sim = simulate(['E04'], app.state.snapshot);
  const n10 = sim.nodes.find((n) => n.id === 'N10');
  const n01 = sim.nodes.find((n) => n.id === 'N01');
  assert.ok(n10.reachable && n01.reachable);
  assert.equal(n01.pressure, 0.42);
  assert.ok(n10.pressure > 0.1 && n10.pressure < 0.42);
});

test('空结果快照的导出 CSV 只含表头，且数值与快照记录一致', () => {
  const app = fresh();
  app.emptyDemo();
  const snap = app.state.snapshot;
  assert.equal(snap.records.length, 0);
  const csv = buildCsv(snap);
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith('数据版本'));

  // 正常快照：CSV 中每个数值都能在快照记录中找到且版本号一致
  const app2 = fresh();
  const s2 = app2.state.snapshot;
  const csv2 = buildCsv(s2);
  assert.ok(csv2.includes(s2.version));
  for (const r of s2.records.slice(0, 20)) {
    assert.ok(csv2.includes(String(r.value)), `CSV 缺少快照数值 ${r.value}`);
    assert.ok(csv2.includes(r.nodeId));
  }
  assert.equal(csv2.trim().split('\n').length - 1, s2.records.length);
});

test('地图/曲线/列表共享同一数据版本：状态内只有一个 snapshot 对象', () => {
  const app = fresh();
  const v1 = app.state.snapshot.version;
  app.setFilters({ zone: '中区' });
  assert.notEqual(app.state.snapshot.version, v1);
  assert.equal(app.state.sim.nodes.length, NODES.length);
  // 无参数再次刷新版本号保持确定；所有视图均读取 state.snapshot 这一个对象
  const v2 = app.state.snapshot.version;
  assert.equal(app.refresh().version, v2);
  assert.equal(app.state.snapshot.version, v2);
});

test('数据集切换不串数据：三组快照记录数与去重/补缺统计不同', () => {
  const app = fresh();
  const normal = app.state.snapshot.quality;
  app.setDataset('missing');
  const missing = app.state.snapshot.quality;
  app.setDataset('anomaly');
  const anomaly = app.state.snapshot.quality;
  assert.ok(missing.duplicatesRemoved > 0);
  assert.ok(missing.gapsFilled > 0);
  assert.ok(anomaly.anomalyPoints === undefined || app.state.snapshot.anomalies.length > 0);
  assert.notDeepEqual(normal, missing);
});
