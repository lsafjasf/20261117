/* 应用状态：数据集装载与清洗缓存、筛选、窗口、视图、选择状态持久化、导出日志。 */
(function (global) {
  const App = (global.App = global.App || {});
  const { hashString, formatTime } = App.util;
  const { WINDOWS, hoursOfWindow, LINES } = App.network;
  const { DATASETS } = App.generate;
  const { cleanDataset, aggregate, computeRadii, filterSignature } = App.pipeline;

  const STORAGE_KEY = 'bus-hotspot-state-v1';
  const LOG_KEY = 'bus-hotspot-export-log-v1';

  const DEFAULT_FILTERS = { lineId: 'ALL', transferType: 'all' };
  const DEFAULT_VIEW = { scale: 1, offsetX: 0, offsetY: 0 };

  const datasets = {};
  DATASETS.forEach((meta) => {
    const raw = meta.build();
    const result = cleanDataset(raw);
    const versionCore =
      meta.id + '-n' + result.report.cleanCount + '-h' + hashString(raw.map((r) => r.id).join(','));
    datasets[meta.id] = { meta, raw, cleaned: result.cleaned, report: result.report, versionCore };
  });

  function loadPersisted() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* 隐私模式下静默降级 */
    }
  }

  const saved = loadPersisted();
  const state = {
    datasetId: saved.datasetId || 'normal',
    filters: { ...DEFAULT_FILTERS, ...(saved.filters || {}) },
    windowId: saved.windowId || 'w_all',
    view: { ...DEFAULT_VIEW, ...(saved.view || {}) },
    selectedStationId: saved.selectedStationId || null,
    perDataset: saved.perDataset || {},
  };

  function snapshotForCurrent() {
    state.perDataset[state.datasetId] = {
      filters: { ...state.filters },
      windowId: state.windowId,
      view: { ...state.view },
      selectedStationId: state.selectedStationId,
    };
  }

  function restoreDataset(datasetId) {
    const s = state.perDataset[datasetId];
    state.datasetId = datasetId;
    state.filters = s ? { ...s.filters } : { ...DEFAULT_FILTERS };
    state.windowId = s ? s.windowId : 'w_all';
    state.view = s ? { ...s.view } : { ...DEFAULT_VIEW };
    state.selectedStationId = s ? s.selectedStationId : null;
    persist();
  }

  function currentWindow() {
    const win = WINDOWS.find((w) => w.id === state.windowId);
    return { ...win, hours: hoursOfWindow(win) };
  }

  function currentResult() {
    const ds = datasets[state.datasetId];
    const win = currentWindow();
    const agg = aggregate(ds.cleaned, state.filters, win);
    const radii = computeRadii(agg.stations);
    const signature = filterSignature(state.filters, win, state.datasetId);
    const version = ds.versionCore + '-f' + signature;
    return { dataset: ds, window: win, filters: { ...state.filters }, agg, radii, version };
  }

  function setFilters(patch) {
    Object.assign(state.filters, patch);
    persist();
  }

  function setWindow(windowId) {
    state.windowId = windowId;
    persist();
  }

  function setView(patch) {
    Object.assign(state.view, patch);
    persist();
  }

  function setSelected(stationId) {
    state.selectedStationId = stationId;
    persist();
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('app:selection-changed'));
    }
  }

  function switchDataset(datasetId) {
    snapshotForCurrent();
    restoreDataset(datasetId);
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('app:selection-changed'));
    }
  }

  function dataSummary() {
    const ds = datasets[state.datasetId];
    const r = ds.report;
    return {
      datasetName: ds.meta.name,
      description: ds.meta.description,
      rawCount: r.rawCount,
      cleanCount: r.cleanCount,
      duplicatesRemoved: r.duplicatesRemoved,
      invalidCount: r.invalidCount,
      outlierTruncated: r.outlierTruncated,
      filledCount: r.filledCount,
    };
  }

  function caliberText() {
    const f = state.filters;
    const line = f.lineId === 'ALL' ? '全部线路' : LINES.find((l) => l.id === f.lineId).name;
    const transfer = f.transferType === 'all' ? '全部换乘类型' : f.transferType === 'transfer' ? '仅换乘' : '仅非换乘';
    return `口径：${line} / ${transfer} / 站点为物理站点合并量（换乘站不重复计数）`;
  }

  function readLog() {
    try {
      return JSON.parse(localStorage.getItem(LOG_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function appendLog(entry) {
    const log = readLog();
    log.unshift({ time: formatTime(), ...entry });
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 50)));
    } catch (e) {
      /* 忽略写入失败 */
    }
    return log;
  }

  App.state = {
    state,
    datasets,
    currentWindow,
    currentResult,
    setFilters,
    setWindow,
    setView,
    setSelected,
    switchDataset,
    dataSummary,
    caliberText,
    readLog,
    appendLog,
  };
})(typeof window !== 'undefined' ? window : globalThis);
