// 用最小 DOM/Canvas 桩在 Node 中跑通 app.js 的完整交互链路（含导出与空结果）。
import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = new Map();

function makeCtx() {
  return new Proxy({}, {
    get(target, prop) {
      if (prop === 'measureText') return () => ({ width: 40 });
      if (prop === 'getContext') return undefined;
      return typeof prop === 'string' ? () => {} : undefined;
    },
    set() { return true; },
  });
}

function makeElement(id) {
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    width: 720,
    height: 560,
    checked: false,
    listeners: {},
    dataset: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    getContext() { return makeCtx(); },
    click() {},
    closest() { return null; },
    querySelectorAll() { return []; },
  };
}

const ids = [
  'mapCanvas', 'histCanvas', 'legendCanvas', 'windowSelect', 'statusBar', 'summaryPanel',
  'statsPanel', 'detailPanel', 'listPanel', 'aggPanel', 'exportLog',
  'w_elevation', 'w_ndvi', 'w_water', 'w_elevation_val', 'w_ndvi_val', 'w_water_val',
  'scoreRange', 'scoreRangeVal', 'elevMin', 'elevMax', 'statsMode', 'aggSelect',
  'resetFilter', 'emptyTest', 'zoomIn', 'zoomOut', 'zoomReset', 'exportBtn', 'zoomVal',
];
const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));

globalThis.document = {
  getElementById: (id) => elements[id] || makeElement(id),
  createElement: (tag) => {
    const el = makeElement(`created-${tag}`);
    if (tag === 'canvas') {
      el.width = 1180;
      el.height = 820;
      el.toDataURL = () => 'data:image/png;base64,STUB';
    }
    return el;
  },
  querySelectorAll: () => [],
};

test('app 初始化、筛选、空结果、窗口切换与导出全链路无异常', async () => {
  const { AppState } = await import('../js/state.js');
  const { buildDataset } = await import('../js/data.js');
  const { HabitatMap } = await import('../js/map.js');
  const { HistogramChart, drawLegend } = await import('../js/chart.js');
  const { exportPng } = await import('../js/export.js');
  const panels = await import('../js/ui-panels.js');

  const dataset = buildDataset();
  const state = new AppState(dataset);
  const map = new HabitatMap(elements.mapCanvas, () => {});
  const chart = new HistogramChart(elements.histCanvas);

  const renderAll = () => {
    const view = state.buildView();
    map.draw(view);
    chart.draw(view);
    drawLegend(elements.legendCanvas, view);
    panels.renderStatusBar(view);
    panels.renderSummary(view, dataset);
    panels.renderStats(view);
    panels.renderSelected(view);
    panels.renderList(view);
    panels.renderAggregation(view);
    return view;
  };

  let view = renderAll();
  assert.equal(view.filteredCells.length, 192);
  assert.ok(elements.statusBar.textContent.includes('数据版本'));

  // 点击网格：选择状态与因子贡献面板。
  state.patchWindow({ selectedId: 42 });
  renderAll();
  assert.ok(elements.detailPanel.innerHTML.includes('网格因子贡献') === false);
  assert.ok(elements.detailPanel.innerHTML.includes('#42'));

  // 调权重：版本变化且重新渲染。
  const v0 = state.view.version;
  state.ws.weights.water = 0.8;
  renderAll();
  assert.notEqual(state.buildView().version, v0);

  // 空结果链路。
  state.patchFilter({ scoreMin: 0.99, scoreMax: 1, levels: ['poor'] });
  view = renderAll();
  assert.equal(view.filteredCells.length, 0);
  assert.ok(elements.statsPanel.innerHTML.includes('空结果'));
  assert.ok(elements.listPanel.innerHTML.includes('空结果'));

  // 导出使用同一 view 对象，返回屏幕一致的数值。
  const entry = exportPng(state.buildView());
  assert.equal(entry.count, 0);
  assert.equal(entry.mean, null);
  assert.ok(entry.file.endsWith('.png'));

  // 恢复筛选后导出有数值，且日志数值等于统计。
  state.resetFilter();
  view = renderAll();
  const entry2 = exportPng(view);
  assert.equal(entry2.count, view.stats.count);
  assert.equal(entry2.mean, view.stats.mean);

  // 窗口切到缺失/异常窗口渲染不报错，再切回保留状态。
  state.setWindow('W2');
  renderAll();
  assert.ok(state.view.pipeline.filledCount > 0);
  state.setWindow('W3');
  renderAll();
  assert.ok(state.view.pipeline.anomalyCount > 0);
  state.setWindow('W1');
  assert.equal(state.ws.selectedId, 42);

  // 导出日志面板。
  panels.renderExportLog([entry, entry2]);
  assert.ok(elements.exportLog.innerHTML.includes('habitat-W1'));
});
