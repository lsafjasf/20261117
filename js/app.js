// 应用入口：所有控件变更都走 AppState.buildView()，再统一刷新地图/曲线/列表/面板/导出。

import { buildDataset, WINDOWS } from './data.js';
import { AppState } from './state.js';
import { HabitatMap } from './map.js';
import { HistogramChart, drawLegend } from './chart.js';
import { exportPng } from './export.js';
import {
  renderAggregation, renderExportLog, renderList, renderSelected,
  renderStats, renderStatusBar, renderSummary,
} from './ui-panels.js';

const $ = (id) => document.getElementById(id);

const dataset = buildDataset();
const state = new AppState(dataset);
const map = new HabitatMap($('mapCanvas'), (cellId) => {
  state.patchWindow({ selectedId: cellId });
});
const histogram = new HistogramChart($('histCanvas'));
const exportLogs = [];

function render() {
  const view = state.buildView();
  map.draw(view);
  histogram.draw(view);
  drawLegend($('legendCanvas'), view);
  renderStatusBar(view);
  renderSummary(view, dataset);
  renderStats(view);
  renderSelected(view);
  renderList(view);
  renderAggregation(view);
  renderExportLog(exportLogs);
  syncControls(view);
}

function syncControls(view) {
  $('windowSelect').value = view.windowId;
  for (const key of ['elevation', 'ndvi', 'water']) {
    $(`w_${key}`).value = view.weights[key];
    $(`w_${key}_val`).textContent = view.weights[key].toFixed(2);
  }
  $('scoreRange').value = String(view.filter.scoreMin);
  $('scoreRangeVal').textContent = view.filter.scoreMin.toFixed(2);
  $('elevMin').value = Math.round(view.filter.elevMin);
  $('elevMax').value = Math.round(view.filter.elevMax);
  document.querySelectorAll('.level-check').forEach((cb) => {
    cb.checked = view.filter.levels.includes(cb.value);
  });
  $('statsMode').value = view.statsMode;
  $('aggSelect').value = view.agg;
  $('zoomVal').textContent = `${view.view.zoom.toFixed(1)}×`;
}

function bind() {
  $('windowSelect').addEventListener('change', (e) => render(state.setWindow(e.target.value)));

  for (const key of ['elevation', 'ndvi', 'water']) {
    $(`w_${key}`).addEventListener('input', (e) => {
      state.ws.weights[key] = Number(e.target.value);
      render();
    });
  }

  $('scoreRange').addEventListener('input', (e) => {
    state.patchFilter({ scoreMin: Number(e.target.value) });
  });
  $('elevMin').addEventListener('change', (e) => state.patchFilter({ elevMin: Number(e.target.value) }));
  $('elevMax').addEventListener('change', (e) => state.patchFilter({ elevMax: Number(e.target.value) }));

  document.querySelectorAll('.level-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const levels = [...document.querySelectorAll('.level-check:checked')].map((x) => x.value);
      state.patchFilter({ levels });
    });
  });

  $('statsMode').addEventListener('change', (e) => state.patchWindow({ statsMode: e.target.value }));
  $('aggSelect').addEventListener('change', (e) => state.patchWindow({ agg: e.target.value }));
  $('resetFilter').addEventListener('click', () => state.resetFilter());

  // 一键制造空结果，专门验证“空结果”链路。
  $('emptyTest').addEventListener('click', () => {
    state.patchFilter({ scoreMin: 0.99, scoreMax: 1, levels: ['poor'] });
  });

  $('zoomIn').addEventListener('click', () => {
    const v = state.ws.view;
    state.patchWindow({ view: { ...v, zoom: Math.min(2.4, v.zoom + 0.2) } });
  });
  $('zoomOut').addEventListener('click', () => {
    const v = state.ws.view;
    state.patchWindow({ view: { ...v, zoom: Math.max(0.6, v.zoom - 0.2) } });
  });
  $('zoomReset').addEventListener('click', () => {
    state.patchWindow({ view: { zoom: 1, offsetX: 0, offsetY: 0 } });
  });

  $('listPanel').addEventListener('click', (e) => {
    const row = e.target.closest('.list-row');
    if (row) state.patchWindow({ selectedId: Number(row.dataset.cell) });
  });

  $('exportBtn').addEventListener('click', () => {
    const entry = exportPng(state.buildView());
    exportLogs.unshift(entry);
    render();
  });

  // 让每个会重建 view 的操作都统一刷新。
  for (const method of ['patchWindow', 'patchFilter', 'resetFilter', 'setWindow']) {
    const original = state[method].bind(state);
    state[method] = (...args) => {
      original(...args);
      render();
    };
  }
}

function init() {
  $('windowSelect').innerHTML = WINDOWS
    .map((w) => `<option value="${w.id}">${w.label}</option>`).join('');
  bind();
  render();
}

init();
