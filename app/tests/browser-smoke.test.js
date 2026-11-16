import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 浏览器装配冒烟测试：jsdom 无 Canvas 2D，使用全 no-op 的代理上下文替代，
// 重点验证模块装配、事件联动、状态同步与导出调用链，而非像素绘制。
test('浏览器环境装配：渲染、点击、筛选、空结果与 SVG 导出全链路可用', async () => {
  const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const html = await readFile(join(appRoot, 'index.html'), 'utf8');

  const dom = new JSDOM(html, {
    url: 'http://localhost:8710/app/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  const noop2d = () => new Proxy({}, {
    get: (t, prop) => {
      if (prop === 'measureText') return () => ({ width: 10 });
      if (prop === 'createLinearGradient' || prop === 'createPattern') return () => ({ addColorStop() {} });
      return typeof prop === 'string' ? () => {} : undefined;
    },
    set: () => true
  });
  window.HTMLCanvasElement.prototype.getContext = function getContext() { return noop2d(); };
  window.URL.createObjectURL = () => 'blob:mock';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function click() {};
  globalThis.window = window;
  globalThis.document = window.document;
  const click = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));

  const load = (rel) => import(`../${rel}`);
  // 直接在 Node 侧复刻 main.js 的装配流程，DOM 元素使用 jsdom 文档
  const { Store } = await load('js/core/store.js');
  const { DATASET_LIST } = await load('js/data/datasets.js');
  const { TIME_WINDOWS } = await load('js/core/filters.js');
  const { STAT_BASIS } = await load('js/core/stats.js');
  const { ColumnView } = await load('js/ui/columnView.js');
  const { CurveView } = await load('js/ui/curveView.js');
  const { MapView } = await load('js/ui/mapView.js');
  const { Legend } = await load('js/ui/legend.js');
  const { DetailPanel, LayerList } = await load('js/ui/panels.js');
  const { StatsPanel, SummaryPanel } = await load('js/ui/statsPanel.js');
  const { LogPanel } = await load('js/ui/logPanel.js');
  const { buildSvg, exportFingerprint, countSvgElements } = await load('js/core/exporter.js');
  const { computeGeometry } = await load('js/ui/geometry.js');

  const doc = window.document;
  const store = new Store();
  new ColumnView(doc.getElementById('columnCanvas'), store, (u) => store.selectUnit(u));
  new CurveView(doc.getElementById('curveCanvas'), store);
  new MapView(doc.getElementById('map'), store);
  new Legend(doc.getElementById('legend'), store);
  new DetailPanel(doc.getElementById('detail'), store);
  new LayerList(doc.getElementById('layerList'), store);
  new StatsPanel(doc.getElementById('stats'), store);
  new SummaryPanel(doc.getElementById('summary'), store);
  new LogPanel(doc.getElementById('exportLog'), store);

  assert.ok(doc.querySelectorAll('.legend-item').length === 7);
  assert.ok(doc.querySelectorAll('.map-dot').length === 2);
  assert.ok(doc.getElementById('summary').textContent.includes(store.model.version));

  // 图例点击隐藏 K2，所有视图同步
  click(doc.querySelector('.legend-item[data-id="K2"]'));
  assert.ok(!store.state.lithoIds.includes('K2'));
  assert.ok(doc.querySelector('.legend-item[data-id="K2"]').classList.contains('off'));
  const layerTextAfter = doc.getElementById('layerList').textContent;
  assert.ok(!layerTextAfter.includes('灰岩'));

  // 列表点击选择层位，详情面板出现厚度
  const firstRow = doc.querySelector('#layerList tbody tr');
  click(firstRow);
  assert.ok(store.state.selectedUnit);
  assert.ok(doc.getElementById('detail').textContent.includes('厚度'));

  // 地图点击切换钻孔
  click(doc.querySelector('.map-dot[data-id="ZK02"]'));
  assert.deepEqual(store.state.boreholeIds, ['ZK01']);

  // 切到空结果窗口，统计/曲线/列表显示空结果文案
  store.setWindow('q4');
  assert.equal(store.model.filtered.empty, true);
  assert.ok(doc.getElementById('stats').textContent.includes('空结果'));

  // 导出链路：生成 SVG 与日志，空结果被记录
  const snap = store.snapshot();
  const svg = buildSvg(snap.model, snap.state, computeGeometry(snap.model, snap.view));
  store.addExportLog({
    datasetId: snap.state.datasetId,
    version: snap.model.version,
    windowLabel: snap.model.filtered.window.label,
    basisLabel: 'GR 均值（API）',
    empty: true,
    elementCount: countSvgElements(svg),
    fingerprint: exportFingerprint(snap.model)
  });
  assert.ok(doc.getElementById('exportLog').textContent.includes('空结果'));

  // 切回前一窗口，筛选状态恢复
  store.setWindow('all');
  assert.ok(!store.state.lithoIds.includes('K2'));
  assert.deepEqual(store.state.boreholeIds, ['ZK01']);

  // 控件常量完整性
  assert.ok(DATASET_LIST.length === 3 && TIME_WINDOWS.length === 5 && STAT_BASIS.length === 5);
});
