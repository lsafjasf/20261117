import { Store } from './core/store.js';
import { DATASET_LIST } from './data/datasets.js';
import { TIME_WINDOWS } from './core/filters.js';
import { STAT_BASIS } from './core/stats.js';
import { ColumnView } from './ui/columnView.js';
import { CurveView } from './ui/curveView.js';
import { MapView } from './ui/mapView.js';
import { Legend } from './ui/legend.js';
import { DetailPanel, LayerList } from './ui/panels.js';
import { StatsPanel, SummaryPanel } from './ui/statsPanel.js';
import { LogPanel } from './ui/logPanel.js';
import { buildSvg, exportFingerprint, countSvgElements, downloadSvg } from './core/exporter.js';

const store = new Store();

const columnView = new ColumnView(document.getElementById('columnCanvas'), store, (unit) => {
  store.selectUnit(unit);
});
new CurveView(document.getElementById('curveCanvas'), store);
new MapView(document.getElementById('map'), store);
new Legend(document.getElementById('legend'), store);
new DetailPanel(document.getElementById('detail'), store);
new LayerList(document.getElementById('layerList'), store);
new StatsPanel(document.getElementById('stats'), store);
new SummaryPanel(document.getElementById('summary'), store);
new LogPanel(document.getElementById('exportLog'), store);

function fillSelect(el, items, current) {
  el.innerHTML = items.map((it) =>
    `<option value="${it.id}" ${it.id === current ? 'selected' : ''}>${it.label}</option>`).join('');
}

const datasetSel = document.getElementById('datasetSelect');
const windowSel = document.getElementById('windowSelect');
const basisSel = document.getElementById('basisSelect');
fillSelect(datasetSel, DATASET_LIST, store.state.datasetId);
fillSelect(windowSel, TIME_WINDOWS, store.state.windowId);
fillSelect(basisSel, STAT_BASIS, store.state.statsBasis);

datasetSel.addEventListener('change', () => store.setDataset(datasetSel.value));
windowSel.addEventListener('change', () => store.setWindow(windowSel.value));
basisSel.addEventListener('change', () => store.setStatsBasis(basisSel.value));

document.getElementById('resetDepth').addEventListener('click', () => {
  store.setDepthRange(0, null);
});
document.getElementById('applyDepth').addEventListener('click', () => {
  const top = Number(document.getElementById('depthTop').value) || 0;
  const bottomRaw = document.getElementById('depthBottom').value;
  const bottom = bottomRaw === '' ? null : Number(bottomRaw);
  store.setDepthRange(top, bottom);
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const snap = store.snapshot();
  const geometry = columnView.geometry();
  const svg = buildSvg(snap.model, snap.state, geometry);
  const fingerprint = exportFingerprint(snap.model);
  const entry = store.addExportLog({
    datasetId: snap.state.datasetId,
    version: snap.model.version,
    windowLabel: snap.model.filtered.window.label,
    basisLabel: STAT_BASIS.find((b) => b.id === snap.state.statsBasis).label,
    empty: snap.model.filtered.empty,
    elementCount: countSvgElements(svg),
    fingerprint
  });
  const filename = `strat_${snap.state.datasetId}_${snap.state.windowId}_${snap.model.version}.svg`;
  downloadSvg(svg, filename);
  // 控制台同步打印，方便人工核对屏幕与导出文件
  console.info('[export]', filename, entry);
});

// 下拉框等控件状态在数据集/窗口切换后与 store 对齐（快照恢复场景）
store.subscribe((snap) => {
  datasetSel.value = snap.state.datasetId;
  windowSel.value = snap.state.windowId;
  basisSel.value = snap.state.statsBasis;
  const dt = document.getElementById('depthTop');
  const db = document.getElementById('depthBottom');
  if (document.activeElement !== dt) dt.value = snap.view?.depthTop ?? 0;
  if (document.activeElement !== db) db.value = snap.view?.depthBottom ?? '';
});
