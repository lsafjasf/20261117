// UI 组装入口：所有视图从 app.state.snapshot 这一个数据版本读取并同步刷新

import { NODES, ZONES, METRICS } from './data.js';
import { createAppState, DATA_END, DEFAULT_FILTERS } from './state.js';
import { createMapView, renderLegend } from './mapView.js';
import { createChartView } from './chartView.js';
import { exportHtml, exportCsv } from './export.js';

const $ = (id) => document.getElementById(id);
const BASIS_LABEL = { avg: '平均值', max: '最大值', min: '最小值', p95: 'P95 分位' };
const METRIC_LABEL = { pressure: '压力', flow: '流量', leakage: '漏损' };

const app = createAppState();
const mapView = createMapView($('mapCanvas'), {
  onPick(hit) {
    if (hit.type === 'edge') {
      app.toggleEdge(hit.id);
      renderAll();
    } else if (hit.type === 'node') {
      app.selectNode(hit.id);
      syncFilterInputs();
      renderAll();
    }
  }
});
const chartView = createChartView($('chartCanvas'));
const exportEntries = [];

function initStaticOptions() {
  const zoneSel = $('filterZone');
  ZONES.forEach((z) => zoneSel.add(new Option(z, z)));
  const nodeSel = $('filterNode');
  NODES.forEach((n) => nodeSel.add(new Option(`${n.id}（${n.zone}${n.source ? '·水源' : ''}）`, n.id)));
  renderLegend($('mapLegend'));
}

function readFilterInputs() {
  return {
    zone: $('filterZone').value,
    nodeId: $('filterNode').value,
    metric: $('filterMetric').value,
    min: $('filterMin').value,
    max: $('filterMax').value,
    anomalyOnly: $('filterAnomalyOnly').checked
  };
}

function syncFilterInputs() {
  const f = app.state.filters;
  $('filterZone').value = f.zone;
  $('filterNode').value = f.nodeId;
  $('filterMetric').value = f.metric;
  $('filterMin').value = f.min;
  $('filterMax').value = f.max;
  $('filterAnomalyOnly').checked = f.anomalyOnly;
  $('intervalSelect').value = String(app.state.intervalMs);
  $('statSelect').value = app.state.basis;
}

function fmtTime(ts) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai'
  });
}

function renderContext() {
  const s = app.state.snapshot;
  const f = s.params.filters;
  const range = (f.min === '' || f.min === null) && (f.max === '' || f.max === null)
    ? '不限' : `${f.min ?? '∞'} ～ ${f.max ?? '∞'}`;
  $('ctxFilters').textContent =
    `分区:${f.zone || '全部'} / 节点:${f.nodeId || '全部'} / 指标:${f.metric ? METRIC_LABEL[f.metric] : '全部'} / 区间:${range} / 仅异常:${f.anomalyOnly ? '是' : '否'}`;
  $('ctxWindow').textContent =
    `${fmtTime(s.params.windowEnd - s.params.windowMs)} ～ ${fmtTime(s.params.windowEnd)}（${s.params.windowMs / 3600000}h）`;
  $('ctxBasis').textContent =
    `${BASIS_LABEL[s.params.basis]} · 每 ${s.params.intervalMs / 60000} 分钟聚合 · 命中 ${s.quality.filteredCount} 条`;
  $('ctxVersion').textContent = `v-${s.version}`;
}

function renderSummary() {
  const s = app.state.snapshot;
  const q = s.quality;
  const st = s.stats;
  const rows = [
    ['数据集', app.state.dataset === 'normal' ? '正常' : app.state.dataset === 'missing' ? '缺失' : '异常'],
    ['原始记录', q.rawCount],
    ['去重删除', `<b class="warn">${q.duplicatesRemoved}</b>`],
    ['补缺点数', `<b class="warn">${q.gapsFilled}</b>`],
    ['聚合后记录', q.aggregatedCount],
    ['筛选命中', q.filteredCount],
    ['覆盖节点', `${st.activeNodes} / ${NODES.length}`],
    ['异常点 / 异常节点', `<b class="bad">${st.anomalyPoints} / ${st.anomalyNodes}</b>`],
    ['关断阀门', app.state.closedEdges.length ? `<b class="bad">${app.state.closedEdges.join(',')}</b>` : '无'],
    ['断供节点', app.state.sim.cutoffNodes.length ? `<b class="bad">${app.state.sim.cutoffNodes.join(',')}</b>` : '无']
  ];
  $('summaryList').innerHTML = rows.map(([k, v]) => `<li><span>${k}</span><span>${v}</span></li>`).join('');
}

function renderMap() {
  const s = app.state.snapshot;
  const sim = app.state.sim;
  const pressureById = new Map();
  for (const n of sim.nodes) pressureById.set(n.id, n.pressure);
  const anomalyNodeIds = new Set(s.anomalies.map((a) => a.nodeId));
  mapView.setData({
    pressureById,
    sim,
    anomalyNodeIds,
    visibleNodeIds: s.nodeIds,
    selectedNode: app.state.selectedNode
  });
}

function renderTable() {
  const s = app.state.snapshot;
  const sim = app.state.sim;
  const tbody = $('nodeTable').querySelector('tbody');
  const visible = NODES.filter((n) => s.nodeIds.includes(n.id));
  const empty = visible.length === 0 || s.records.length === 0;
  $('emptyState').hidden = !empty;
  $('listCount').textContent = `${visible.length} 个节点 / ${s.records.length} 条记录`;
  const lastByNode = new Map();
  const anomalyCount = new Map();
  for (const a of s.anomalies) anomalyCount.set(a.nodeId, (anomalyCount.get(a.nodeId) || 0) + 1);
  for (const r of s.records) {
    const cur = lastByNode.get(r.nodeId) || {};
    if (!cur.ts || r.ts >= cur.ts) { cur.ts = r.ts; cur[r.metric] = r.value; lastByNode.set(r.nodeId, cur); }
  }
  tbody.innerHTML = visible.map((node) => {
    const simNode = sim.nodes.find((n) => n.id === node.id);
    const d = lastByNode.get(node.id) || {};
    const ac = anomalyCount.get(node.id) || 0;
    let tag = '<span class="tag ok">正常</span>';
    if (!simNode.reachable) tag = '<span class="tag cut">无法供水</span>';
    else if (ac > 0) tag = '<span class="tag bad">异常</span>';
    else if (d.pressure !== undefined && d.pressure < 0.2) tag = '<span class="tag warn">偏低</span>';
    return `<tr class="${!simNode.reachable ? 'cutoff' : ''} ${app.state.selectedNode === node.id ? 'selected' : ''}" data-node="${node.id}">
      <td>${node.id}${node.source ? ' ★' : ''}</td><td>${node.zone}</td><td>${tag}</td>
      <td>${simNode.reachable ? (d.pressure ?? '-') : '0.000'}</td>
      <td>${d.flow ?? '-'}</td><td>${d.leakage ?? '-'}</td><td>${ac}</td></tr>`;
  }).join('');
  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      app.selectNode(tr.dataset.node);
      renderAll();
    });
  });
}

function renderChart() {
  $('chartHint').textContent = `数据版本 v-${app.state.snapshot.version}`;
  chartView.render(app.state.snapshot, app.state.selectedNode);
}

function renderNavButtons() {
  $('prevWindow').disabled = !app.canShift(-1);
  $('nextWindow').disabled = !app.canShift(1);
  $('backWindow').disabled = !app.hasPrevious();
}

function renderAll() {
  renderContext();
  renderSummary();
  renderMap();
  renderTable();
  renderChart();
  renderNavButtons();
}

function addExportLog(entry) {
  exportEntries.unshift(entry);
  const s = app.state.snapshot;
  $('exportLog').innerHTML = exportEntries.slice(0, 12).map((e) =>
    `<li><b>${e.format.toUpperCase()}</b> ${e.name}<br><span class="meta">${e.at} · 版本 v-${e.version} · ${e.rows} 条 · 筛选 ${e.filterText}</span></li>`
  ).join('');
}

function currentFilterText() {
  const f = app.state.snapshot.params.filters;
  return `${f.zone || '全分区'}/${f.nodeId || '全节点'}/${f.metric || '全指标'}`;
}

function bindEvents() {
  $('datasetSelect').addEventListener('change', (ev) => {
    app.setDataset(ev.target.value);
    syncFilterInputs();
    renderAll();
  });
  $('windowSize').addEventListener('change', (ev) => {
    app.setWindowSize(Number(ev.target.value));
    renderAll();
  });
  $('prevWindow').addEventListener('click', () => { app.shiftWindow(-1); syncFilterInputs(); renderAll(); });
  $('nextWindow').addEventListener('click', () => { app.shiftWindow(1); syncFilterInputs(); renderAll(); });
  $('backWindow').addEventListener('click', () => { app.goBack(); syncFilterInputs(); renderAll(); });
  $('applyFilter').addEventListener('click', () => {
    app.setFilters(readFilterInputs());
    renderAll();
  });
  $('resetFilter').addEventListener('click', () => {
    app.resetFilters();
    app.state.selectedNode = null;
    syncFilterInputs();
    renderAll();
  });
  $('emptyDemo').addEventListener('click', () => {
    app.emptyDemo();
    syncFilterInputs();
    renderAll();
  });
  $('intervalSelect').addEventListener('change', (ev) => {
    app.state.intervalMs = Number(ev.target.value);
    app.refresh();
    renderAll();
  });
  $('statSelect').addEventListener('change', (ev) => {
    app.state.basis = ev.target.value;
    app.refresh();
    renderAll();
  });
  $('exportCsv').addEventListener('click', () => {
    const entry = exportCsv(app.state.snapshot);
    addExportLog({ ...entry, at: new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }), version: app.state.snapshot.version, filterText: currentFilterText() });
  });
  $('exportHtml').addEventListener('click', () => {
    const entry = exportHtml(app.state.snapshot, $('mapCanvas'), $('chartCanvas'), app.state.sim, app.state.closedEdges);
    addExportLog({ ...entry, at: new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' }), version: app.state.snapshot.version, filterText: currentFilterText() });
  });
}

initStaticOptions();
app.refresh();
syncFilterInputs();
bindEvents();
renderAll();

// 暴露给浏览器控制台与人工验收使用
window.__waterApp = app;
export { app };
